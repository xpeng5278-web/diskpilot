#!/usr/bin/env node
// Builds a portable Windows x64 zip: official Node.js runtime + DiskPilot app files + launchers.
// Cross-platform (runs on Linux/macOS/Windows), no npm dependencies. WizTree is never bundled.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const DEFAULT_NODE_VERSION = 'v24.21.0';
const NODE_DIST = 'https://nodejs.org/dist';
const LAUNCHER_NAMES = ['启动 DiskPilot.cmd', 'Start-DiskPilot.cmd'];

// Runtime files copied into app/. Tests, docs, CI config and dev tooling stay out of the package.
const APP_ENTRIES = ['src', 'public', 'native', 'samples', 'scripts/desktop.js', 'scripts/build-bridge.js', 'package.json', 'LICENSE', 'README.md'];

function parseArgs(argv) {
  const options = { nodeVersion: process.env.DISKPILOT_NODE_VERSION || DEFAULT_NODE_VERSION, outDir: path.join(root, 'dist'), nodeExe: process.env.DISKPILOT_NODE_EXE || null };
  for (const arg of argv) {
    const [key, value] = arg.split(/=(.*)/s);
    if (key === '--node-version') options.nodeVersion = value;
    else if (key === '--out-dir') options.outDir = path.resolve(value);
    else if (key === '--node-exe') options.nodeExe = path.resolve(value);
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 ${response.status}：${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function resolveNodeVersion(version) {
  if (version !== 'lts') return version.startsWith('v') ? version : `v${version}`;
  const index = JSON.parse((await download(`${NODE_DIST}/index.json`)).toString('utf8'));
  const release = index.find(item => item.lts && item.files.includes('win-x64-exe'));
  if (!release) throw new Error('无法从 nodejs.org 确定最新 LTS 版本');
  return release.version;
}

function expectedHash(shasums, file) {
  const line = shasums.split(/\r?\n/).find(row => row.trim().split(/\s+/)[1] === file);
  if (!line) throw new Error(`SHASUMS256.txt 中没有 ${file}`);
  return line.trim().split(/\s+/)[0].toLowerCase();
}

// Downloads win-x64/node.exe from nodejs.org, verifies it against SHASUMS256.txt and caches it.
async function fetchNodeExe(version, cacheDir) {
  const cached = path.join(cacheDir, `node-${version}-win-x64.exe`);
  const shasums = (await download(`${NODE_DIST}/${version}/SHASUMS256.txt`)).toString('utf8');
  const expected = expectedHash(shasums, 'win-x64/node.exe');
  const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
  if (fs.existsSync(cached)) {
    const data = fs.readFileSync(cached);
    if (sha256(data) === expected) return { data, sha256: expected, cached: true };
  }
  const data = await download(`${NODE_DIST}/${version}/win-x64/node.exe`);
  const actual = sha256(data);
  if (actual !== expected) throw new Error(`node.exe 校验失败：期望 ${expected}，实际 ${actual}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, data);
  return { data, sha256: expected, cached: false };
}

// Batch files stay pure ASCII with CRLF line endings so cmd.exe parses them the same under any code page.
// %~dp0 keeps the package location working from paths containing spaces, parentheses or Chinese characters.
function launcherScript() {
  return [
    '@echo off',
    'setlocal',
    'chcp 65001 >nul',
    'title DiskPilot',
    'set "DP_HOME=%~dp0"',
    'set "DP_NODE=%DP_HOME%runtime\\node.exe"',
    'set "DP_APP=%DP_HOME%app"',
    'if not exist "%DP_NODE%" goto missing',
    'if not exist "%DP_APP%\\scripts\\desktop.js" goto missing',
    'cd /d "%DP_APP%"',
    'echo DiskPilot is starting. Keep this window open while using DiskPilot; close it to quit.',
    'echo.',
    '"%DP_NODE%" "%DP_APP%\\scripts\\desktop.js" --open',
    'set "DP_EXIT=%ERRORLEVEL%"',
    'if "%DP_EXIT%"=="0" goto end',
    'echo.',
    'echo DiskPilot exited with code %DP_EXIT%. See the messages above.',
    'pause',
    'goto end',
    ':missing',
    'echo DiskPilot files are missing next to this launcher.',
    'echo Please extract the WHOLE zip to a folder first, then run this file from that folder.',
    'echo Do not run it directly inside the zip preview window.',
    'set "DP_EXIT=1"',
    'pause',
    ':end',
    'endlocal & exit /b %DP_EXIT%',
    ''
  ].join('\r\n');
}

function portableNotes(version, nodeVersion) {
  return [
    `DiskPilot ${version} 便携版（Windows x64）`,
    '',
    '1. 将整个压缩包解压到任意文件夹（路径可包含空格或中文）。',
    '2. 双击“启动 DiskPilot.cmd”（或 Start-DiskPilot.cmd）。浏览器会自动打开本机页面。',
    '3. 使用期间保持黑色命令行窗口打开；关闭它即退出 DiskPilot。',
    '',
    `已内置 Node.js ${nodeVersion} 官方运行时（runtime\\node.exe），无需另行安装 Node.js。`,
    '桌面助手（选择文件夹）首次启动时用 Windows 自带的 .NET Framework 4 编译，生成到 app\\outputs。',
    '',
    '本压缩包不包含 WizTree。真实扫描需要单独安装免费的 WizTree：',
    '  - 官方网站：https://diskanalyzer.com/download',
    '  - 或在终端运行：winget install AntibodySoftware.WizTree',
    '未安装 WizTree 时，仍可点击“加载示例报告”查看界面。',
    '',
    'DiskPilot 只提供建议，不会删除或迁移任何文件。扫描数据留在本机，不上传。',
    ''
  ].join('\r\n');
}

function collectFiles(entry) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute)) throw new Error(`缺少打包文件：${entry}`);
  if (fs.statSync(absolute).isFile()) return [entry];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(item => collectFiles(path.posix.join(entry, item.name)));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Minimal ZIP writer (deflate, UTF-8 names flagged with bit 11 so Chinese file names survive Windows Explorer).
function createZip(entries, date = new Date()) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const store = compressed.length >= data.length;
    const body = store ? data : compressed;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(store ? 0 : 8, 10); central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  if (offset > 0xffffffff || entries.length > 0xffff) throw new Error('压缩包过大，超出 ZIP 格式限制');
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function packageEntries({ version, nodeVersion, nodeExe }) {
  const base = `DiskPilot-${version}-win-x64`;
  const appFiles = APP_ENTRIES.flatMap(collectFiles).sort();
  const forbidden = appFiles.filter(file => /wiztree[^/]*\.exe$/i.test(file) || /(^|\/)(node_modules|test|outputs|dist)(\/|$)/.test(file));
  if (forbidden.length) throw new Error(`不应打包的文件：${forbidden.join(', ')}`);
  return [
    ...LAUNCHER_NAMES.map(name => ({ name: `${base}/${name}`, data: launcherScript() })),
    { name: `${base}/使用说明.txt`, data: '\ufeff' + portableNotes(version, nodeVersion) },
    { name: `${base}/README.md`, data: fs.readFileSync(path.join(root, 'README.md')) },
    { name: `${base}/LICENSE`, data: fs.readFileSync(path.join(root, 'LICENSE')) },
    { name: `${base}/runtime/node.exe`, data: nodeExe },
    ...appFiles.map(file => ({ name: `${base}/app/${file}`, data: fs.readFileSync(path.join(root, file)) }))
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const nodeVersion = await resolveNodeVersion(options.nodeVersion);
  let nodeExe;
  if (options.nodeExe) {
    nodeExe = fs.readFileSync(options.nodeExe);
    console.log(`使用本地 node.exe（未校验官方哈希）：${options.nodeExe}`);
  } else {
    console.log(`获取 Node.js ${nodeVersion} win-x64 node.exe …`);
    const node = await fetchNodeExe(nodeVersion, path.join(options.outDir, '.cache'));
    nodeExe = node.data;
    console.log(`SHA256 校验通过 ${node.sha256}${node.cached ? '（缓存）' : ''}`);
  }
  const entries = packageEntries({ version: pkg.version, nodeVersion, nodeExe });
  const zip = createZip(entries);
  fs.mkdirSync(options.outDir, { recursive: true });
  const output = path.join(options.outDir, `DiskPilot-${pkg.version}-win-x64.zip`);
  fs.writeFileSync(output, zip);
  console.log(`${output}（${(zip.length / 1024 ** 2).toFixed(1)} MB，${entries.length} 个文件）`);
  return output;
}

if (require.main === module) main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
module.exports = { launcherScript, portableNotes, createZip, crc32, packageEntries, expectedHash, APP_ENTRIES, LAUNCHER_NAMES, DEFAULT_NODE_VERSION };
