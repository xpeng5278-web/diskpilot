const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseFixedDrives, listFixedDrives } = require('../src/drives');
const { analyzeWizTreeCsv, mergeScanResults, formatBytes } = require('../src/analyzer');
const { scanFixedDrives } = require('../src/wiztree');
const { startServer } = require('../src/server');

test('fixed-drive parser normalizes and rejects non-drive values', () => {
  assert.deepEqual(parseFixedDrives('"c:"'), ['C:']);
  assert.deepEqual(parseFixedDrives('["d:","C:","d:","\\\\server"]'), ['C:', 'D:']);
  assert.deepEqual(parseFixedDrives(''), []);
});

test('sub-kilobyte sizes retain their actual byte count', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(461), '461 B');
  assert.equal(formatBytes(1024), '1.0 KB');
});

test('CSV analysis reports actual parsing progress', async () => {
  const updates = [];
  await analyzeWizTreeCsv(path.join(__dirname, 'fixtures/wiztree-sample.csv'), 'C:\\', { demo: true, onProgress: value => updates.push(value) });
  assert.ok(updates.length);
  assert.equal(updates.at(-1).processedBytes, updates.at(-1).totalBytes);
  assert.ok(updates.at(-1).totalBytes > 0);
});

test('CSV analysis respects cancellation before reading', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeWizTreeCsv(path.join(__dirname, 'fixtures/wiztree-sample.csv'), 'C:\\', { signal: controller.signal }), { name: 'AbortError' });
});

test('multi-drive results combine counts, categories, candidates and volumes', async () => {
  const sample = await analyzeWizTreeCsv(path.join(__dirname, 'fixtures/wiztree-sample.csv'), 'C:\\Users\\demo', { demo: true });
  const first = { ...sample, demo: false, volumes: [{ drive: 'C:', totalBytes: 100, freeBytes: 20 }] };
  const second = { ...sample, demo: false, volumes: [{ drive: 'D:', totalBytes: 200, freeBytes: 90 }] };
  const result = mergeScanResults([first, second], ['C:', 'D:']);
  assert.equal(result.allocatedBytes, sample.allocatedBytes * 2);
  assert.equal(result.fileCount, sample.fileCount * 2);
  assert.equal(result.categories.find(row => row.id === 'build').bytes, 8192);
  assert.deepEqual(result.volumes.map(volume => volume.drive), ['C:', 'D:']);
  assert.deepEqual(result.drives, ['C:', 'D:']);
  assert.equal(result.plans[1].candidateBytes, 8192);
});

test('fixed drives scan sequentially and report the active drive', async () => {
  const sample = await analyzeWizTreeCsv(path.join(__dirname, 'fixtures/wiztree-sample.csv'), 'C:\\', { demo: true });
  const calls = [];
  const updates = [];
  const result = await scanFixedDrives(['C:', 'D:'], async (root, progress) => {
    calls.push(root);
    progress({ phase: 'scanning', current: root });
    return { ...sample, root, demo: false, volumes: [] };
  }, progress => updates.push(progress));
  assert.deepEqual(calls, ['C:\\', 'D:\\']);
  assert.deepEqual(updates.map(item => item.completed), [0, 1]);
  assert.equal(result.fileCount, sample.fileCount * 2);
});

test('fixed-drive failure never returns a partial report', async () => {
  let calls = 0;
  await assert.rejects(scanFixedDrives(['C:', 'D:'], async () => {
    if (++calls === 2) throw new Error('D: failed');
    return { categories: [], topFiles: [], topFolders: [], volumes: [], bytes: 0, allocatedBytes: 0, fileCount: 0, folderCount: 0, skipped: 0 };
  }), /D: failed/);
  assert.equal(calls, 2);
});

test('drive API reports fixed disks without starting a scan', { skip: process.platform !== 'win32' }, async t => {
  const server = await startServer(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/drives`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).drives, await listFixedDrives());
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/cancel`, { method: 'POST', headers: { Origin: `http://127.0.0.1:${server.address().port}` } })).status, 409);
});
