const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyzeWizTreeCsv, csvFields, classify, scanDirectory } = require('../src/analyzer');

test('WizTree CSV parses quoted names and avoids counting directory summary twice', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'diskpilot-test-'));
  const csv = path.join(folder, 'scan.csv');
  fs.writeFileSync(csv, '\ufeffFile Name,Size,Allocated,Modified,Attributes,Files,Folders\n"C:\\Users\\me\\Downloads\\",300,320,,0,2,0\n"C:\\Users\\me\\Downloads\\a,b.zip",100,128,,0,,\n"C:\\Users\\me\\Downloads\\other.zip",200,192,,0,,\n');
  try {
    const result = await analyzeWizTreeCsv(csv);
    assert.equal(result.bytes, 300);
    assert.equal(result.allocatedBytes, 320);
    assert.equal(result.topFolders[0].bytes, 300);
    assert.equal(result.topFiles[1].path, 'C:\\Users\\me\\Downloads\\a,b.zip');
    assert.equal(result.categories.find(row => row.id === 'downloads').bytes, 320);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('classifier keeps system data protected and identifies build artifacts', () => {
  assert.equal(classify('C:\\Windows\\System32\\a.dll').risk, 'protected');
  assert.equal(classify('C:\\Users\\me\\Downloads\\app\\node_modules\\x.js').id, 'build');
  assert.deepEqual(csvFields('"a,b",2,3'), ['a,b', '2', '3']);
});

test('local scan includes folder totals', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'diskpilot-test-'));
  fs.mkdirSync(path.join(folder, 'nested'));
  fs.writeFileSync(path.join(folder, 'nested', 'sample.bin'), 'abc');
  try {
    const result = await scanDirectory(folder);
    assert.equal(result.bytes, 3);
    assert.equal(result.topFolders[0].bytes, 3);
    assert.equal(result.topFolders[1].bytes, 3);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('localized WizTree export includes a preamble and Chinese headers', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'diskpilot-test-'));
  const csv = path.join(folder, 'scan.csv');
  fs.writeFileSync(csv, '生成由 WizTree 4.33\n文件名称,大小,分配,修改时间,属性,文件,文件夹\n"C:\\Users\\demo\\Downloads\\",150,160,,0,2,0\n"C:\\Users\\demo\\Downloads\\a.zip",100,128,,0,0,0\n"C:\\Users\\demo\\Downloads\\b.zip",50,32,,0,0,0\n');
  try {
    const result = await analyzeWizTreeCsv(csv, 'C:\\Users\\demo\\Downloads');
    assert.equal(result.root, 'C:\\Users\\demo\\Downloads');
    assert.equal(result.bytes, 150);
    assert.equal(result.allocatedBytes, 160);
    assert.equal(result.fileCount, 2);
    assert.equal(result.categories.find(row => row.id === 'downloads').bytes, 160);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
