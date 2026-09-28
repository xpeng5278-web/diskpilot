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
  assert.equal(state.result.root, 'C:\\');
  assert.ok(state.result.allocatedBytes > 100 * 1024 ** 3);
  assert.match(state.status, /示例/);
  const report = await fetch(`${base}/api/report`);
  assert.equal(report.status, 200);
  const plainReport = await report.text();
  assert.match(plainReport, /示例数据（非本机扫描）/);
  const metadata = { root: state.result.root, scannedAt: state.result.scannedAt, selections: [state.result.plans[1].candidates[0].path] };
  const exportReview = (data, origin = base) => fetch(`${base}/api/report`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const annotated = await exportReview(metadata);
  assert.equal(annotated.status, 200);
  assert.match(await annotated.text(), /## 已勾选待复核/);
  assert.equal((await exportReview(metadata, 'https://example.com')).status, 403);
  assert.equal((await exportReview({ ...metadata, scannedAt: 'stale' })).status, 409);
  assert.equal((await exportReview({ ...metadata, root: 'different' })).status, 409);
  assert.equal((await exportReview({ ...metadata, selections: [12] })).status, 400);
  assert.equal((await exportReview(null)).status, 400);
  assert.equal(await (await fetch(`${base}/api/report`)).text(), plainReport);
  assert.deepEqual((await (await fetch(`${base}/api/state`)).json()).result, state.result);
});

test('realistic demo covers all categories and has increasing actionable plans', async () => {
  const result = await analyzeWizTreeCsv(path.join(__dirname, '../samples/demo-report.csv'), 'C:\\', { demo: true });
  assert.deepEqual(result.categories.map(row => row.id).sort(), ['appdata', 'build', 'cache', 'downloads', 'other', 'personal', 'system']);
  assert.ok(result.allocatedBytes > 100 * 1024 ** 3);
  assert.ok(result.allocatedBytes >= 150 * 1024 ** 3 && result.allocatedBytes <= 250 * 1024 ** 3);
  assert.ok(result.fileCount + result.folderCount >= 80 && result.fileCount + result.folderCount <= 150);
  for (const plan of result.plans) assert.ok(plan.candidates.length >= 2, plan.id);
  const amounts = result.plans.map(plan => plan.candidateBytes);
  assert.ok(amounts[0] < amounts[1] && amounts[1] < amounts[2]);
  assert.equal(result.demo, true);
  assert.deepEqual(result.volumes, []);
  for (const folder of result.topFolders) {
    const descendants = result.topFiles.filter(file => file.path.startsWith(folder.path));
    assert.equal(folder.bytes, descendants.reduce((sum, file) => sum + file.bytes, 0), folder.path);
    assert.equal(folder.allocated, descendants.reduce((sum, file) => sum + file.allocated, 0), folder.path);
  }
  assert.equal(result.topFolders.find(folder => folder.path === 'C:\\').allocated, result.allocatedBytes);
});
