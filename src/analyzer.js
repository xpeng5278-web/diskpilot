const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const GB = 1024 ** 3;
const MAX_ITEMS = 200;

function csvFields(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields;
}

function cleanPath(value) { return String(value || '').replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase(); }

function classify(value, isDirectory) {
  const p = cleanPath(value);
  const parts = p.split('\\').filter(Boolean);
  const has = name => parts.includes(name);
  if (has('windows') || has('program files') || has('program files (x86)') || has('programdata') || /^(?:[a-z]:\\)?(?:pagefile|swapfile|hiberfil)\.sys$/.test(p))
    return { id: 'system', label: '系统与程序', risk: 'protected', action: '通过 Windows 设置或应用卸载器处理' };
  if (has('node_modules') || has('.next') || has('dist') || has('build') || has('target') || has('__pycache__'))
    return { id: 'build', label: '可重建的构建产物', risk: 'medium', action: '确认项目可重建后清理，再运行依赖安装或构建' };
  if (has('.npm') || has('.pnpm-store') || has('.yarn') || has('.gradle') || has('pip') && has('cache') || has('.cache') || has('cache') && (has('appdata') || has('roaming')))
    return { id: 'cache', label: '开发与应用缓存', risk: 'low', action: '关闭相关程序后使用其内置清理命令' };
  if (has('downloads'))
    return { id: 'downloads', label: '下载与安装包', risk: 'review', action: '逐项确认后迁移到其他磁盘或删除副本' };
  if (has('desktop') || has('documents') || has('pictures') || has('videos') || has('music'))
    return { id: 'personal', label: '个人文件', risk: 'review', action: '确认备份后用 Windows 文件夹位置设置迁移' };
  if (has('appdata') || has('roaming') || has('local'))
    return { id: 'appdata', label: '应用数据', risk: 'high', action: '从应用设置中迁移；不要直接移动整个 AppData' };
  if (isDirectory && /^[a-z]:$/.test(p))
    return { id: 'other', label: '其他', risk: 'review', action: '进一步查看明细' };
  return { id: 'other', label: '其他', risk: 'review', action: '逐项确认用途' };
}

function addTop(list, item, max = MAX_ITEMS) {
  if (!Number.isFinite(item.bytes) || item.bytes <= 0) return;
  if (list.length === max && item.bytes <= list[list.length - 1].bytes) return;
  list.push(item);
  list.sort((a, b) => b.bytes - a.bytes);
  if (list.length > max) list.length = max;
}

function createAccumulator(source, root) {
  const categories = new Map();
  const topFiles = [];
  const topFolders = [];
  let fileCount = 0;
  let folderCount = 0;
  let bytes = 0;
  let allocatedBytes = 0;
  let skipped = 0;
  return {
    add(item) {
      const category = classify(item.path, item.directory);
      const size = Math.max(0, Number(item.bytes) || 0);
      const allocated = Math.max(0, Number(item.allocated ?? size) || 0);
      const record = { path: item.path, bytes: size, allocated, category: category.id, risk: category.risk };
      if (item.directory) {
        folderCount++;
        addTop(topFolders, record);
      } else {
        fileCount++;
        bytes += size;
        allocatedBytes += allocated;
        categories.set(category.id, (categories.get(category.id) || 0) + allocated);
        addTop(topFiles, record);
      }
    },
    skip() { skipped++; },
    result() {
      const categoryRows = [...categories].map(([id, size]) => ({ ...classifyCategory(id), bytes: size })).sort((a, b) => b.bytes - a.bytes);
      return { source, root, scannedAt: new Date().toISOString(), bytes, allocatedBytes, fileCount, folderCount, skipped, categories: categoryRows, topFiles, topFolders, plans: buildPlans(categoryRows, topFolders) };
    }
  };
}

function classifyCategory(id) {
  const samples = {
    system: 'C:\\Windows', build: 'C:\\project\\node_modules', cache: 'C:\\Users\\user\\.cache',
    downloads: 'C:\\Users\\user\\Downloads', personal: 'C:\\Users\\user\\Documents',
    appdata: 'C:\\Users\\user\\AppData', other: 'C:\\Other'
  };
  return classify(samples[id], id !== 'other');
}

function buildPlans(categories, folders) {
  const byId = Object.fromEntries(categories.map(row => [row.id, row.bytes]));
  const candidates = folders.filter(row => ['cache', 'build', 'downloads', 'personal'].includes(row.category)).slice(0, 40);
  return [
    { id: 'light', name: '轻度', detail: '先看缓存和临时内容', candidateBytes: byId.cache || 0, categories: ['cache'] },
    { id: 'medium', name: '中度', detail: '加入可重建的项目产物', candidateBytes: (byId.cache || 0) + (byId.build || 0), categories: ['cache', 'build'] },
    { id: 'heavy', name: '重度', detail: '再审查下载和个人文件的迁移', candidateBytes: (byId.cache || 0) + (byId.build || 0) + (byId.downloads || 0) + (byId.personal || 0), categories: ['cache', 'build', 'downloads', 'personal'] }
  ].map(plan => ({ ...plan, candidates: candidates.filter(row => plan.categories.includes(row.category)) }));
}

function volumeInfo(drive) {
  if (!drive || process.platform !== 'win32') return null;
  try {
    const stat = fs.statfsSync(drive + '\\');
    return { drive, totalBytes: stat.blocks * stat.bsize, freeBytes: stat.bavail * stat.bsize };
  } catch { return null; }
}

async function analyzeWizTreeCsv(filePath, scanRoot, { demo = false } = {}) {
  const accumulator = createAccumulator(demo ? '示例数据（非本机扫描）' : 'WizTree 本机扫描', scanRoot || filePath);
  const handle = await fs.promises.open(filePath, 'r');
  const bom = Buffer.alloc(3);
  await handle.read(bom, 0, 3, 0);
  await handle.close();
  const encoding = bom[0] === 0xff && bom[1] === 0xfe ? 'utf16le' : 'utf8';
  const stream = fs.createReadStream(filePath, { encoding });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let columns;
  let scannedDrive;
  let preambleLines = 0;
  for await (const raw of reader) {
    const line = raw.replace(/^\ufeff/, '');
    if (!line.trim()) continue;
    const values = csvFields(line);
    if (!columns) {
      const header = values.map(value => value.trim().toLowerCase());
      const find = names => header.findIndex(value => names.includes(value));
      const candidate = {
        name: find(['file name', '文件名称', '文件名']),
        size: find(['size', '大小']),
        allocated: find(['allocated', '分配'])
      };
      if (Object.values(candidate).every(index => index >= 0)) columns = candidate;
      else if (++preambleLines > 2) throw new Error('不是支持的 WizTree CSV：缺少文件名、大小或分配列');
      continue;
    }
    const name = values[columns.name];
    if (!scannedDrive) scannedDrive = /^[a-z]:/i.exec(name)?.[0].toUpperCase();
    const size = Number(values[columns.size]);
    const rawAllocated = values[columns.allocated];
    const allocated = Number(rawAllocated);
    if (!name || !Number.isFinite(size) || !Number.isFinite(allocated)) { accumulator.skip(); continue; }
    const directory = name.endsWith('\\');
    const hardlink = !directory && /^0\d/.test(String(rawAllocated));
    accumulator.add({ path: name, directory, bytes: size, allocated: hardlink ? 0 : allocated });
  }
  if (!columns) throw new Error('未找到 WizTree CSV 表头');
  const result = accumulator.result();
  result.root = scanRoot || scannedDrive || filePath;
  result.demo = demo;
  result.volumes = demo ? [] : [volumeInfo(scannedDrive), volumeInfo('D:')].filter(Boolean).filter((item, index, all) => all.findIndex(other => other.drive === item.drive) === index);
  return result;
}

async function scanDirectory(root, progress) {
  const resolved = path.resolve(root);
  const stat = await fs.promises.stat(resolved);
  if (!stat.isDirectory()) throw new Error('请选择文件夹');
  const accumulator = createAccumulator('本机扫描', resolved);
  const stack = [{ path: resolved, parent: null }];
  const folderTotals = new Map();
  while (stack.length) {
    const node = stack.pop();
    const current = node.path;
    let entries;
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
    catch { accumulator.skip(); continue; }
    folderTotals.set(current, { bytes: 0, parent: node.parent });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) { accumulator.skip(); continue; }
      if (entry.isDirectory()) { stack.push({ path: full, parent: current }); continue; }
      try {
        const item = await fs.promises.stat(full);
        if (item.isFile()) {
          accumulator.add({ path: full, directory: false, bytes: item.size, allocated: item.size });
          folderTotals.get(current).bytes += item.size;
        }
      } catch { accumulator.skip(); }
    }
    if (progress && stack.length % 100 === 0) progress(current);
  }
  for (const [folder, info] of [...folderTotals].reverse()) {
    accumulator.add({ path: folder + path.sep, directory: true, bytes: info.bytes, allocated: info.bytes });
    if (info.parent && folderTotals.has(info.parent)) folderTotals.get(info.parent).bytes += info.bytes;
  }
  const result = accumulator.result();
  const sourceDrive = /^[a-z]:/i.exec(resolved)?.[0].toUpperCase();
  result.volumes = [volumeInfo(sourceDrive), volumeInfo('D:')].filter(Boolean).filter((item, index, all) => all.findIndex(other => other.drive === item.drive) === index);
  return result;
}

function formatBytes(bytes) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function markdownReport(result, selections = []) {
  const lines = [
    '# DiskPilot 空间诊断报告', '',
    `- 来源：${result.source}`,
    `- 扫描位置：\`${result.root}\``,
    `- 时间：${result.scannedAt}`,
    `- 文件：${result.fileCount.toLocaleString()}，文件夹：${result.folderCount.toLocaleString()}，无法读取或忽略：${result.skipped.toLocaleString()}`,
    `- 文件总大小：${formatBytes(result.bytes)}；占用估计：${formatBytes(result.allocatedBytes)}`, '',
    ...(result.volumes?.length ? ['## 磁盘空间', '', ...result.volumes.map(item => `${item.drive} 总计 ${formatBytes(item.totalBytes)}，剩余 ${formatBytes(item.freeBytes)}`), ''] : []),
    '## 分类', '', '| 类别 | 占用 | 建议 |', '| --- | ---: | --- |',
    ...result.categories.map(row => `| ${row.label} | ${formatBytes(row.bytes)} | ${row.action} |`), '',
    '## 分级方案', ''
  ];
  for (const plan of result.plans) {
    lines.push(`### ${plan.name}`, '', `${plan.detail}。候选空间上限约 ${formatBytes(plan.candidateBytes)}；实际释放量需在执行前核实。`, '');
    for (const item of plan.candidates.slice(0, 20)) lines.push(`- ${formatBytes(item.bytes)} · \`${item.path}\``);
    lines.push('');
  }
  const selected = new Set(Array.isArray(selections) ? selections.filter(item => typeof item === 'string') : []);
  const candidates = new Map(result.plans.flatMap(plan => plan.candidates).map(item => [item.path, item]));
  const reviewed = [...candidates.values()].filter(item => selected.has(item.path));
  if (reviewed.length) {
    lines.push('## 已勾选待复核', '', '勾选仅表示待你自行核对，不表示已处理或授权执行。仅本机、不上云、不自动删除或迁移。路径可能嵌套，大小不代表可释放空间。', '');
    for (const item of reviewed) {
      const size = Number.isFinite(item.bytes) && item.bytes >= 0 ? formatBytes(item.bytes) : '大小未知';
      const safePath = item.path.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])).replace(/[\r\n]/g, ' ');
      lines.push(`- [x] ${size} · <code>${safePath}</code>`);
    }
    lines.push('');
  }
  lines.push('## 最大文件夹', '', ...result.topFolders.slice(0, 40).map(item => `- ${formatBytes(item.bytes)} · \`${item.path}\``), '', '## 最大文件', '', ...result.topFiles.slice(0, 40).map(item => `- ${formatBytes(item.bytes)} · \`${item.path}\``), '', '扫描结果仅提供建议；系统目录和应用数据应使用官方卸载或迁移方式处理。');
  return lines.join('\n');
}

module.exports = { analyzeWizTreeCsv, scanDirectory, csvFields, classify, formatBytes, markdownReport };
