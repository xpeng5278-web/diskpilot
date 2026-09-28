const { spawn } = require('node:child_process');
const { buildBridge } = require('./build-bridge');
const { startServer } = require('../src/server');

const openBrowser = process.argv.includes('--open');

// rundll32 hands the URL to the default browser without going through cmd.exe quoting rules.
function open(url) {
  if (process.platform !== 'win32') return;
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => console.log(`无法自动打开浏览器，请手动访问 ${url}`));
  child.unref();
}

async function start() {
  let executable = null;
  try { executable = await buildBridge(); }
  catch (error) {
    console.warn(`桌面助手未启动：${error.message}`);
    console.warn('网页仍可使用：可手动输入路径扫描，或加载示例报告；“选择文件夹”按钮将不可用。');
  }
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}`;
  if (executable) {
    const helper = spawn(executable, []);
    helper.once('error', error => { console.error(error); server.close(); });
    helper.once('close', () => server.close());
    process.once('SIGINT', () => { helper.kill(); server.close(); });
  } else process.once('SIGINT', () => server.close());
  console.log(`DiskPilot: ${url}`);
  if (openBrowser) open(url);
}

start().catch(error => { console.error(error); process.exitCode = 1; });
