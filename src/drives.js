const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const query = "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object { $_.Name.Substring(0, 2) } | ConvertTo-Json -Compress";

function parseFixedDrives(output) {
  if (!output.trim()) return [];
  const value = JSON.parse(output);
  const drives = Array.isArray(value) ? value : [value];
  return [...new Set(drives.filter(item => typeof item === 'string' && /^[a-z]:$/i.test(item)).map(item => item.toUpperCase()))].sort();
}

async function listFixedDrives(signal) {
  if (process.platform !== 'win32') throw new Error('本机磁盘扫描目前仅支持 Windows');
  const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, timeout: 15000, signal });
  const drives = parseFixedDrives(stdout);
  if (!drives.length) throw new Error('未找到可扫描的本机固定磁盘');
  return drives;
}

module.exports = { listFixedDrives, parseFixedDrives };
