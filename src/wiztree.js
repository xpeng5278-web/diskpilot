const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { analyzeWizTreeCsv, mergeScanResults } = require('./analyzer');
const { listFixedDrives } = require('./drives');

function findWizTree() {
  const configured = process.env.WIZTREE_PATH;
  const candidates = configured ? [configured] : [
    path.resolve(__dirname, '..', '..', '..', '..', 'Tools', 'WizTree', 'WizTree64.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WizTree', 'WizTree64.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WizTree', 'WizTree64.exe')
  ];
  const executable = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!executable) throw new Error('未找到 WizTree64.exe；请安装 WizTree，或设置 WIZTREE_PATH 指向它');
  return executable;
}

async function scanWithWizTree(input, onProgress, signal) {
  signal?.throwIfAborted();
  if (process.platform !== 'win32') throw new Error('WizTree 扫描目前仅支持 Windows');
  const root = /^[a-z]:$/i.test(input) ? input + '\\' : path.resolve(input);
  const info = await fs.promises.stat(root);
  if (!info.isDirectory()) throw new Error('请选择文件夹或磁盘根目录');
  const executable = findWizTree();
  const outputDir = path.join(__dirname, '..', 'outputs');
  await fs.promises.mkdir(outputDir, { recursive: true });
  const csv = path.join(outputDir, `wiztree-${randomUUID()}.csv`);
  try {
    onProgress?.({ phase: 'scanning', current: root });
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [root, `/export=${csv}`, '/admin=0'], { cwd: path.dirname(executable), windowsHide: true, signal });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`WizTree 扫描失败（退出码 ${code}）`)));
    });
    if (!(await fs.promises.stat(csv).catch(() => null))?.size) throw new Error('WizTree 未生成扫描结果');
    onProgress?.({ phase: 'analyzing', current: root, processedBytes: 0, totalBytes: (await fs.promises.stat(csv)).size });
    return await analyzeWizTreeCsv(csv, root, { signal, onProgress: progress => onProgress?.({ phase: 'analyzing', current: root, ...progress }) });
  } finally {
    await fs.promises.unlink(csv).catch(() => {});
  }
}

async function scanAllFixedDrives(onProgress, signal) {
  onProgress?.({ phase: 'discovering', completed: 0, total: 0 });
  const drives = await listFixedDrives(signal);
  return scanFixedDrives(drives, scanWithWizTree, onProgress, signal);
}

async function scanFixedDrives(drives, scan, onProgress, signal) {
  const results = [];
  for (const [index, drive] of drives.entries()) {
    signal?.throwIfAborted();
    const result = await scan(`${drive}\\`, progress => onProgress?.({ ...progress, completed: index, total: drives.length, drives }), signal);
    results.push(result);
  }
  return mergeScanResults(results, drives);
}

module.exports = { findWizTree, scanWithWizTree, scanAllFixedDrives, scanFixedDrives };
