const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { launcherScript, createZip, crc32, packageEntries, expectedHash, LAUNCHER_NAMES } = require('../scripts/package-win');

test('Windows launcher is ASCII, CRLF and quotes every package-relative path', () => {
  const script = launcherScript();
  assert.match(script, /^[\x00-\x7f]*$/);
  assert.ok(script.split('\n').slice(0, -1).every(line => line.endsWith('\r')));
  assert.match(script, /set "DP_HOME=%~dp0"/);
  assert.match(script, /chcp 65001/);
  assert.match(script, /"%DP_NODE%" "%DP_APP%\\scripts\\desktop\.js" --open/);
  assert.match(script, /cd \/d "%DP_APP%"/);
  assert.doesNotMatch(script, /\([^)]*%DP_/, 'no parenthesized blocks that break on paths like "Program Files (x86)"');
});

test('package contains launchers, runtime and app files but never WizTree or tests', () => {
  const entries = packageEntries({ version: '9.9.9', nodeVersion: 'v24.0.0', nodeExe: Buffer.from('MZ') });
  const names = entries.map(entry => entry.name);
  for (const launcher of LAUNCHER_NAMES) assert.ok(names.includes(`DiskPilot-9.9.9-win-x64/${launcher}`));
  for (const file of ['runtime/node.exe', 'app/src/server.js', 'app/public/index.html', 'app/native/DiskPilotBridge.cs', 'app/scripts/desktop.js', 'app/package.json', 'LICENSE', 'README.md']) {
    assert.ok(names.includes(`DiskPilot-9.9.9-win-x64/${file}`), file);
  }
  assert.ok(names.some(name => /\/app\/samples\/.+\.csv$/.test(name)), 'demo sample data is shipped');
  assert.equal(names.filter(name => /wiztree[^/]*\.exe$/i.test(name) || /\/(test|node_modules|outputs)\//.test(name)).length, 0);
});

test('zip writer produces valid UTF-8 flagged deflate entries', () => {
  const data = Buffer.from('DiskPilot 磁盘'.repeat(50));
  const zip = createZip([{ name: 'a/启动 DiskPilot.cmd', data }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
  const nameLength = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30, 30 + nameLength).toString('utf8'), 'a/启动 DiskPilot.cmd');
  const body = zip.subarray(30 + nameLength, 30 + nameLength + zip.readUInt32LE(18));
  assert.deepEqual(zlib.inflateRawSync(body), data);
  assert.equal(zip.readUInt32LE(14), crc32(data));
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

test('SHASUMS256 lookup matches the exact file name', () => {
  const sums = 'aaa  win-x64/node.exe.sig\nBBB  win-x64/node.exe\n';
  assert.equal(expectedHash(sums, 'win-x64/node.exe'), 'bbb');
  assert.throws(() => expectedHash(sums, 'win-x86/node.exe'));
});
