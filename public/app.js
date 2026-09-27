const $ = selector => document.querySelector(selector);
const bytes = size => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
const isWindows = /Windows/i.test(navigator.userAgent);
let result = null;
let currentPlan = 'light';
let currentView = 'folders';
let pickingFolder = false;
let statusOverride = null;
let busy = false;
let submitting = false;
let fixedDrives = [];
let selectedPaths = new Set();
const scanKey = scan => JSON.stringify([scan.root, scan.scannedAt]);
const selectionKey = scan => `diskpilot.review:${scanKey(scan)}`;
const knownSize = item => Number.isFinite(item.bytes) && item.bytes >= 0;

function reviewItems() {
  return [...new Map(result.plans.flatMap(plan => plan.candidates).map(item => [item.path, item])).values()];
}

function restoreSelection() {
  selectedPaths = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(selectionKey(result)) || '[]');
    if (Array.isArray(saved)) {
      const candidates = new Set(reviewItems().map(item => item.path));
      selectedPaths = new Set(saved.filter(path => candidates.has(path)));
    }
  } catch { /* Storage may be unavailable; the checklist still works in memory. */ }
}

function chooseDefaultPlan() {
  const current = result.plans.find(plan => plan.id === currentPlan);
  if (current?.candidates.length) return;
  const withItems = result.plans.find(plan => plan.candidates.length);
  if (withItems) currentPlan = withItems.id;
}

function renderSelectionSummary() {
  const plan = result.plans.find(item => item.id === currentPlan);
  const items = reviewItems().filter(item => selectedPaths.has(item.path));
  const total = items.reduce((sum, item) => sum + (knownSize(item) ? item.bytes : 0), 0);
  const unknown = items.filter(item => !knownSize(item)).length;
  if (!plan.candidates.length) {
    $('#review-summary').textContent = '这一档暂无可勾建议';
    return;
  }
  $('#review-summary').textContent = items.length
    ? `已选 ${items.length} 项待核对 · 约 ${bytes(total)}${unknown ? ` · ${unknown} 项大小未知` : ''}（跨方案保留；路径重叠时不代表可释放空间）`
    : '还没勾选 · 勾选下方路径，加入导出报告。';
}

function updateControls() {
  const locked = busy || submitting || pickingFolder;
  $('#scan-all').disabled = locked || !isWindows || !fixedDrives.length;
  $('#scan').disabled = locked || !$('#scan-path').value.trim();
  $('#browse').disabled = locked || !isWindows;
  $('#browse').setAttribute('aria-disabled', String($('#browse').disabled));
  $('#demo').disabled = locked;
}

function renderProgress(progress) {
  const host = $('#scan-progress');
  host.classList.toggle('hidden', !progress);
  if (!progress) return;
  const bar = $('#progress-bar');
  $('#cancel-scan').disabled = progress.phase === 'cancelling';
  const step = progress.total ? `${progress.completed + 1} / ${progress.total} 个磁盘` : '';
  $('#progress-count').textContent = step;
  if (progress.phase === 'cancelling') {
    $('#progress-title').textContent = '正在取消扫描';
    $('#progress-detail').textContent = '正在停止 WizTree 并清理临时结果';
    bar.removeAttribute('value');
  } else if (progress.phase === 'discovering') {
    $('#progress-title').textContent = '正在识别本机磁盘';
    $('#progress-detail').textContent = '正在读取 Windows 的固定磁盘列表';
    bar.removeAttribute('value');
  } else if (progress.phase === 'analyzing') {
    const percent = progress.totalBytes ? Math.min(100, Math.round(progress.processedBytes / progress.totalBytes * 100)) : 0;
    $('#progress-title').textContent = `正在分析 ${progress.current}`;
    $('#progress-detail').textContent = `已读取扫描结果 ${percent}%`;
    bar.value = percent;
  } else {
    $('#progress-title').textContent = `正在扫描 ${progress.current}`;
    $('#progress-detail').textContent = 'WizTree 正在扫描；此阶段无法提供准确百分比';
    bar.removeAttribute('value');
  }
}

async function loadDrives() {
  if (!isWindows) {
    $('#drives-hint').textContent = '本机固定磁盘扫描仅支持 Windows';
    return;
  }
  try {
    const response = await fetch('/api/drives');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法识别本机磁盘');
    fixedDrives = data.drives;
    $('#drives-hint').textContent = `将扫描 ${fixedDrives.join('、')}（${fixedDrives.length} 个固定磁盘）`;
  } catch (error) {
    $('#drives-hint').textContent = `${error.message}；仍可扫描指定路径`;
  }
  updateControls();
}

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
  if (!result.categories.length) host.append(node('p', 'empty-inline', '没有可分类的文件占用。可尝试其他文件夹。'));
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
  const amount = node('div', 'plan-amount');
  const emptyPlan = !plan.candidates.length;
  if (emptyPlan) {
    amount.classList.add('plan-empty');
    amount.append(node('strong', '', '这一档暂无可勾建议'), node('p', 'hint', '可切换其他档位，或先看左侧分类与下方明细。'));
  } else {
    amount.append(node('span', 'hint', '可优先查看的空间'), node('strong', '', bytes(plan.candidateBytes)));
  }
  summary.append(amount);
  const detail = node('details', 'plan-detail');
  detail.append(node('summary', '', '这些建议包含什么？'), node('p', '', plan.detail));
  const target = result.volumes?.find(item => item.drive === 'D:');
  const capacityNote = currentPlan === 'heavy' && target && plan.candidateBytes > target.freeBytes * 0.9 ? ' 若全部迁移到 D 盘，现有剩余空间可能不足。' : '';
  const warning = node('p', 'plan-warning', `实际能腾出多少，需逐项核对；嵌套文件夹不要重复计算。${capacityNote}`);
  host.append(summary, detail);
  if (!emptyPlan) host.append(warning);
  const selectionSummary = node('p', 'review-summary');
  selectionSummary.id = 'review-summary';
  selectionSummary.setAttribute('role', 'status');
  host.append(selectionSummary);
  const list = node('div', 'candidate-list');
  host.append(list);
  for (const item of plan.candidates) {
    const row = node('label', 'candidate');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedPaths.has(item.path);
    checkbox.setAttribute('aria-label', `待核对：${item.path}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedPaths.add(item.path);
      else selectedPaths.delete(item.path);
      try { localStorage.setItem(selectionKey(result), JSON.stringify([...selectedPaths])); } catch { /* Memory fallback. */ }
      renderSelectionSummary();
    });
    row.append(checkbox, node('span', 'candidate-path', item.path), node('strong', '', knownSize(item) ? bytes(item.bytes) : '大小未知'));
    row.title = item.path;
    list.append(row);
  }
  renderSelectionSummary();
  document.querySelectorAll('[data-plan]').forEach(button => {
    button.classList.toggle('active', button.dataset.plan === currentPlan);
    button.setAttribute('aria-pressed', String(button.dataset.plan === currentPlan));
  });
}

function renderItems() {
  const host = $('#items');
  host.replaceChildren();
  const items = currentView === 'folders' ? result.topFolders : result.topFiles;
  if (!items.length) {
    const row = node('tr');
    const cell = node('td', 'empty-inline', '暂无路径明细，可切换文件 / 文件夹查看。');
    cell.colSpan = 3; row.append(cell); host.append(row);
  }
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
  chooseDefaultPlan();
  $('#results').classList.remove('hidden');
  $('#empty').classList.add('hidden');
  $('#demo-notice').classList.toggle('hidden', !result.demo);
  $('#download').disabled = false;
  $('#total').textContent = bytes(result.allocatedBytes);
  $('#logical-total').textContent = `文件大小总计 ${bytes(result.bytes)}`;
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
  busy = data.busy;
  if (!data.busy && !data.result && result) {
    result = null;
    selectedPaths.clear();
    $('#results').classList.add('hidden');
    $('#empty').classList.remove('hidden');
    $('#download').disabled = true;
    statusOverride = { message: '本机服务已重启，先前报告已失效，请重新扫描', kind: 'error' };
  }
  updateControls();
  if (pickingFolder) return;
  renderProgress(data.busy ? data.progress : null);
  if (data.busy) setStatus(data.status, 'working');
  else if (statusOverride) setStatus(statusOverride.message, statusOverride.kind);
  else if (data.error) setStatus(data.error, 'error');
  else if (data.result) {
    setStatus(`${data.result.demo ? '示例报告已加载（非本机扫描）' : '分析完成'} · ${new Date(data.result.scannedAt).toLocaleString()}`, 'done');
    if (!result || scanKey(result) !== scanKey(data.result)) { result = data.result; restoreSelection(); render(); }
  } else setStatus(data.status);
}

async function request(url, options) {
  if (busy || submitting || pickingFolder) return;
  submitting = true;
  updateControls();
  try {
    statusOverride = null;
    setStatus('正在启动…', 'working');
    result = null;
    $('#download').disabled = true;
    $('#empty').classList.remove('hidden');
    $('#results').classList.add('hidden');
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败');
    await state();
  } catch (error) {
    statusOverride = { message: error.message, kind: 'error' };
    setStatus(error.message, 'error');
  } finally { submitting = false; updateControls(); }
}

$('#demo').addEventListener('click', () => request('/api/demo', { method: 'POST' }));
$('#scan-all').addEventListener('click', () => request('/api/scan-all', { method: 'POST' }));
$('#cancel-scan').addEventListener('click', async () => {
  $('#cancel-scan').disabled = true;
  try {
    const response = await fetch('/api/cancel', { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).error || '无法取消扫描');
    setStatus('正在取消扫描…', 'working');
  } catch (error) {
    statusOverride = { message: error.message, kind: 'error' };
    setStatus(error.message, 'error');
  } finally { $('#cancel-scan').disabled = false; }
});
$('#scan').addEventListener('click', () => request('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: $('#scan-path').value }) }));
$('#browse').addEventListener('click', async () => {
  if (!isWindows || busy || submitting || pickingFolder) return;
  pickingFolder = true;
  statusOverride = null;
  updateControls();
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
  finally { pickingFolder = false; updateControls(); }
});
$('#scan-path').addEventListener('keydown', event => { if (event.key === 'Enter') $('#scan').click(); });
$('#scan-path').addEventListener('input', updateControls);
$('#download').addEventListener('click', async () => {
  if (!result) return;
  $('#download').disabled = true;
  try {
    const response = await fetch('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: result.root, scannedAt: result.scannedAt, selections: [...selectedPaths] })
    });
    if (!response.ok) throw new Error((await response.json()).error || '导出失败');
    const url = URL.createObjectURL(await response.blob());
    const link = node('a');
    link.href = url;
    link.download = 'diskpilot-report.md';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    statusOverride = { message: error.message, kind: 'error' };
    setStatus(error.message, 'error');
  } finally { $('#download').disabled = !result; }
});
document.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => { currentPlan = button.dataset.plan; renderPlan(); }));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { currentView = button.dataset.view; renderItems(); }));
function refreshState() { state().catch(() => setStatus('无法连接本机服务，请确认 npm start 正在运行。', 'error')); }
if (!isWindows) {
  $('#scan-help').textContent = '文件夹选择器仅支持 Windows 桌面助手；请先加载示例报告，或粘贴完整路径。真实扫描需 Windows 和 WizTree。';
}
updateControls();
loadDrives();
refreshState();
setInterval(refreshState, 1500);
