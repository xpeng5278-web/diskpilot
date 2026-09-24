const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { analyzeWizTreeCsv, markdownReport } = require('../src/analyzer');
const { startServer } = require('../src/server');

test('sample analysis includes accurate categories, plans and paths without local volumes', async () => {
  const result = await analyzeWizTreeCsv(path.join(__dirname, 'fixtures/wiztree-sample.csv'), 'C:\\Users\\demo\\Downloads', { demo: true });
  assert.equal(result.bytes, 5000);
  assert.equal(result.allocatedBytes, 8192);
  assert.equal(result.fileCount, 2);
  assert.equal(result.folderCount, 3);
  assert.deepEqual(Object.fromEntries(result.categories.map(c => [c.id, c.bytes])), { build: 4096, downloads: 4096 });
  assert.deepEqual(result.plans.map(p => p.candidateBytes), [0, 4096, 8192]);
  assert.equal(result.plans[0].candidates.length, 0);
  assert.equal(result.plans[1].candidates.length, 1);
  assert.equal(result.topFiles[0].bytes, 4000);
  assert.equal(result.topFolders[0].bytes, 5000);
  assert.deepEqual(result.volumes, []);
  assert.equal(result.demo, true);
  assert.match(markdownReport(result), /示例数据（非本机扫描）/);
});

test('demo API accepts local requests and exports a labeled sample report', async t => {
  const server = await startServer(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/demo`, { method: 'POST', headers: { Origin: 'https://example.com' } })).status, 403);
  const response = await fetch(`${base}/api/demo`, { method: 'POST', headers: { Origin: base } });
  assert.equal(response.status, 202);
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(`${base}/api/state`)).json();
    if (!state.busy) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(state.busy, false);
  assert.equal(state.error, null);
  assert.equal(state.result.demo, true);
  assert.match(state.status, /示例/);
  const report = await fetch(`${base}/api/report`);
  assert.equal(report.status, 200);
  assert.match(await report.text(), /示例数据（非本机扫描）/);
});
