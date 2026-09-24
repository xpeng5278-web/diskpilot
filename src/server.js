const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { markdownReport, analyzeWizTreeCsv } = require('./analyzer');
const { scanWithWizTree } = require('./wiztree');
const { chooseFolder } = require('./folder-picker');

const publicDir = path.join(__dirname, '..', 'public');
const state = { busy: false, status: '等待扫描', result: null, error: null };
let choosingFolder = false;

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function body(request, limit = 64 * 1024) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > limit) throw new Error('请求内容过大');
  }
  return JSON.parse(text);
}

function begin(task) {
  state.busy = true;
  state.error = null;
  state.result = null;
  Promise.resolve().then(task).then(result => {
    state.result = result;
    state.status = result.demo ? '示例报告已加载（非本机扫描）' : '分析完成';
  }).catch(error => {
    state.error = error.message;
    state.status = '分析失败';
  }).finally(() => { state.busy = false; });
}

async function handler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!host || !/^((localhost|127\.0\.0\.1):\d+)$/.test(host)) return json(response, 403, { error: '只接受本机页面的请求' });
  if (request.method === 'POST' && origin !== `http://${host}`) return json(response, 403, { error: '只接受本机页面的请求' });
  try {
    if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, state);
    if (request.method === 'GET' && url.pathname === '/api/report') {
      if (!state.result) return json(response, 404, { error: '还没有报告' });
      response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="diskpilot-report.md"', 'Cache-Control': 'no-store' });
      return response.end(markdownReport(state.result));
    }
    if (request.method === 'POST' && url.pathname === '/api/demo') {
      if (state.busy) return json(response, 409, { error: '已有分析正在运行' });
      state.status = '正在加载示例报告…';
      begin(() => analyzeWizTreeCsv(path.join(__dirname, '..', 'test', 'fixtures', 'wiztree-sample.csv'), 'C:\\Users\\demo\\Downloads', { demo: true }));
      return json(response, 202, { accepted: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/scan') {
      if (state.busy) return json(response, 409, { error: '已有扫描正在运行' });
      const input = await body(request);
      if (typeof input.path !== 'string' || !input.path.trim()) return json(response, 400, { error: '请输入要扫描的文件夹路径' });
      const target = input.path.trim();
      state.status = `WizTree 正在扫描 ${target}`;
      begin(() => scanWithWizTree(target));
      return json(response, 202, { accepted: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/choose-folder') {
      if (choosingFolder) return json(response, 409, { error: '请先完成或取消当前文件夹选择' });
      choosingFolder = true;
      try { return json(response, 200, { path: await chooseFolder() }); }
      finally { choosingFolder = false; }
    }
    if (request.method !== 'GET') return json(response, 404, { error: '未找到接口' });
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
    const name = files[url.pathname];
    if (!name) return json(response, 404, { error: '页面不存在' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    response.writeHead(200, { 'Content-Type': `${types[path.extname(name)]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(publicDir, name)).pipe(response);
  } catch (error) { return json(response, 400, { error: error.message }); }
}

const startPort = Number(process.env.PORT || 4173);
function startServer(port = startPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', error => {
      if (error.code === 'EADDRINUSE' && port !== 0 && port < startPort + 20) resolve(startServer(port + 1));
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
if (require.main === module) startServer().then(server => console.log(`DiskPilot: http://127.0.0.1:${server.address().port}`)).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { startServer };
