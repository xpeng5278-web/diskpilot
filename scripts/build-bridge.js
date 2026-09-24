const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const root = path.join(__dirname, '..');
const source = path.join(root, 'native', 'DiskPilotBridge.cs');
const output = path.join(root, 'outputs', 'DiskPilotDesktop.exe');

async function buildBridge() {
  if (process.platform !== 'win32') throw new Error('桌面助手目前仅支持 Windows');
  const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET');
  const candidates = ['Framework64', 'Framework'].map(name => path.join(framework, name, 'v4.0.30319', 'csc.exe'));
  const compiler = candidates.find(candidate => fs.existsSync(candidate));
  if (!compiler) throw new Error('未找到 Windows .NET Framework 4 编译器');
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  const current = await fs.promises.stat(output).catch(() => null);
  const code = await fs.promises.stat(source);
  if (!current || current.mtimeMs < code.mtimeMs) {
    await runFile(compiler, ['/nologo', '/target:winexe', `/out:${output}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Core.dll', source], { windowsHide: true });
  }
  return output;
}

if (require.main === module) buildBridge().then(executable => console.log(executable)).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildBridge };
