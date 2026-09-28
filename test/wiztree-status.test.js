const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wizTreeStatus, findWizTree } = require('../src/wiztree');
const { startServer } = require('../src/server');

function configuredPath(t, value) {
  const previous = process.env.WIZTREE_PATH;
  process.env.WIZTREE_PATH = value;
  t.after(() => {
    if (previous === undefined) delete process.env.WIZTREE_PATH;
    else process.env.WIZTREE_PATH = previous;
  });
}

function temporaryFolder(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'diskpilot-wiztree-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test('WizTree status never throws, including on Linux', () => {
  let status;
  assert.doesNotThrow(() => { status = wizTreeStatus(); });
  assert.equal(status.platform, process.platform);
  assert.equal(status.supported, process.platform === 'win32');
  assert.equal(typeof status.found, 'boolean');
  assert.equal(status.installHint.url, 'https://diskanalyzer.com/download');
});

test('explicit missing WizTree path overrides default detection and find still throws', t => {
  configuredPath(t, path.join(temporaryFolder(t), 'missing.exe'));
  const status = wizTreeStatus();
  assert.equal(status.found, false);
  assert.equal(status.path, null);
  assert.throws(findWizTree, /winget install AntibodySoftware.WizTree/);
});

test('WizTree status finds an existing configured file without executing it', t => {
  const executable = path.join(temporaryFolder(t), 'WizTree.exe');
  fs.writeFileSync(executable, 'fictional executable placeholder');
  configuredPath(t, executable);
  assert.equal(wizTreeStatus().found, true);
  assert.equal(wizTreeStatus().path, executable);
  assert.equal(findWizTree(), executable);
});

test('a directory is not a WizTree executable', t => {
  configuredPath(t, temporaryFolder(t));
  assert.equal(wizTreeStatus().found, false);
});

test('WizTree API returns 200 JSON even when not installed', async t => {
  configuredPath(t, path.join(temporaryFolder(t), 'missing.exe'));
  const server = await startServer(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/wiztree`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), wizTreeStatus());
});
