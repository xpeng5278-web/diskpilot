const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { analyzeWizTreeCsv, markdownReport } = require('../src/analyzer');

test('review report annotates only candidate paths once across tiers without changing result', async () => {
  const result = await analyzeWizTreeCsv(path.join(__dirname, 'fixtures/wiztree-sample.csv'), 'C:\\demo', { demo: true });
  const candidate = result.plans[1].candidates[0];
  const before = JSON.stringify(result);
  const report = markdownReport(result, [candidate.path, candidate.path, 'unrecognized-path', null]);
  const section = report.split('## 已勾选待复核')[1].split('## 最大文件夹')[0];
  assert.equal((section.match(/- \[x\]/g) || []).length, 1);
  assert.ok(section.includes(candidate.path));
  assert.match(section, /3.9 KB/);
  assert.match(section, /不自动删除或迁移/);
  assert.ok(!report.includes('unrecognized-path'));
  assert.equal(JSON.stringify(result), before);
  assert.equal(markdownReport(result, []), markdownReport(result));
  assert.equal(markdownReport(result, null), markdownReport(result));
});

test('review metadata handles unknown sizes and renders markup-like paths as text', async () => {
  const result = await analyzeWizTreeCsv(path.join(__dirname, 'fixtures/wiztree-sample.csv'), 'C:\\demo');
  const candidate = { path: 'C:\\<img>\\`name`&file\nnext', bytes: null };
  result.plans[0].candidates.push(candidate);
  const section = markdownReport(result, [candidate.path]).split('## 已勾选待复核')[1].split('## 最大文件夹')[0];
  assert.match(section, /大小未知/);
  assert.ok(section.includes('<code>C:\\&lt;img&gt;\\`name`&amp;file next</code>'));
});
