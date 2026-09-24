const $ = selector => document.querySelector(selector);
const bytes = size => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${(size / 1024).toFixed(1)} KB`;
let result = null;
let currentPlan = 'light';
let currentView = 'folders';
let pickingFolder = false;
let statusOverride = null;

function node(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = value;
  return item;
}

function setStatus(message, kind = '') {
  const status = $('#status');
  status.className = `status ${kind}`;
  status.lastElementChild.textContent = message;
}

function renderCategories() {
  const host = $('#categories');
  host.replaceChildren();
  const max = Math.max(...result.categories.map(item => item.bytes), 1);
  for (const item of result.categories) {
    const row = node('div', 'category-row');
    const header = node('div', 'category-header');
    header.append(node('strong', '', item.label), node('span', '', bytes(item.bytes)));
    const track = node('div', 'bar-track');
    const fill = node('div', `bar-fill ${item.id}`);
    fill.style.width = `${Math.max(1, item.bytes / max * 100)}%`;
    track.append(fill);
    const advice = node('p', '', item.action);
    row.append(header, track, advice);
    host.append(row);
  }
}

function renderPlan() {
  const plan = result.plans.find(item => item.id === currentPlan);
  const host = $('#plan');
  host.replaceChildren();
  const summary = node('div', 'plan-summary');
  summary.append(node('strong', '', bytes(plan.candidateBytes)), node('p', '', plan.detail));
  const target = result.volumes?.find(item => item.drive === 'D:');
  const capacityNote = currentPlan === 'heavy' && target && plan.candidateBytes > target.freeBytes * 0.9 ? ' 若全部迁移到 D 盘，现有剩余空间可能不足。' : '';
  const warning = node('p', 'plan-warning', `这是候选空间上限，实际可释放量需逐项确认。${capacityNote}`);
  host.append(summary, warning);
  if (!plan.candidates.length) host.append(node('p', 'empty-inline', '没有找到对应的大文件夹。'));
  for (const item of plan.candidates.slice(0, 8)) {
    const row = node('div', 'candidate');
    row.append(node('span', 'candidate-path', item.path), node('strong', '', bytes(item.bytes)));
    row.title = item.path;
    host.append(row);
  }
  document.querySelectorAll('[data-plan]').forEach(button => button.classList.toggle('active', button.dataset.plan === currentPlan));
}

function renderItems() {
  const host = $('#items');
  host.replaceChildren();
  const items = currentView === 'folders' ? result.topFolders : result.topFiles;
  for (const item of items.slice(0, 50)) {
    const row = node('tr');
    const pathCell = node('td', 'path-cell', item.path);
    pathCell.title = item.path;
    const category = result.categories.find(entry => entry.id === item.category);
    row.append(pathCell, node('td', 'kind-cell', category?.label || '其他'), node('td', 'number', bytes(item.bytes)));
    host.append(row);
  }
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === currentView));
}

function render() {
  if (!result) return;
  $('#results').classList.remove('hidden');
  $('#download').disabled = false;
  $('#total').textContent = bytes(result.allocatedBytes);
  $('#files').textContent = result.fileCount.toLocaleString();
  $('#folders').textContent = result.folderCount.toLocaleString();
  $('#skipped').textContent = result.skipped.toLocaleString();
  $('#meta').textContent = `${result.source} · ${result.root}`;
  const volumes = $('#volumes');
  volumes.replaceChildren();
  for (const volume of result.volumes || []) volumes.append(node('span', 'volume-item', `${volume.drive} 剩余 ${bytes(volume.freeBytes)} / ${bytes(volume.totalBytes)}`));
  renderCategories();
  renderPlan();
  renderItems();
}

async function state() {
  const response = await fetch('/api/state');
  const data = await response.json();
  $('#scan').disabled = data.busy || pickingFolder || !$('#scan-path').value.trim();
  $('#browse').disabled = data.busy || pickingFolder;
  if (pickingFolder) return;
  if (data.busy) setStatus(data.status, 'working');
  else if (statusOverride) setStatus(statusOverride.message, statusOverride.kind);
  else if (data.error) setStatus(data.error, 'error');
  else if (data.result) {
    setStatus(`分析完成 · ${new Date(data.result.scannedAt).toLocaleString()}`, 'done');
    if (result?.scannedAt !== data.result.scannedAt) { result = data.result; render(); }
  }
}

async function request(url, options) {
  try {
    statusOverride = null;
    setStatus('正在分析…', 'working');
    result = null;
    $('#results').classList.add('hidden');
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败');
    await state();
  } catch (error) {
    statusOverride = { message: error.message, kind: 'error' };
    setStatus(error.message, 'error');
  }
}

$('#scan').addEventListener('click', () => request('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: $('#scan-path').value }) }));
$('#browse').addEventListener('click', async () => {
  pickingFolder = true;
  statusOverride = null;
  $('#browse').disabled = true;
  setStatus('等待选择文件夹…', 'working');
  try {
    const response = await fetch('/api/choose-folder', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法选择文件夹');
    if (data.path) {
      $('#scan-path').value = data.path;
      $('#scan-path').title = data.path;
      $('#scan').disabled = false;
      statusOverride = { message: `已选择 ${data.path}`, kind: '' };
    } else statusOverride = { message: '已取消选择', kind: '' };
    setStatus(statusOverride.message, statusOverride.kind);
  } catch (error) {
    statusOverride = { message: error.message, kind: 'error' };
    setStatus(error.message, 'error');
  }
  finally { pickingFolder = false; $('#browse').disabled = false; }
});
$('#scan-path').addEventListener('keydown', event => { if (event.key === 'Enter') $('#scan').click(); });
$('#scan-path').addEventListener('input', event => { $('#scan').disabled = !event.target.value.trim(); });
$('#download').addEventListener('click', () => { window.location.href = '/api/report'; });
document.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => { currentPlan = button.dataset.plan; renderPlan(); }));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { currentView = button.dataset.view; renderItems(); }));
state();
setInterval(state, 1500);
