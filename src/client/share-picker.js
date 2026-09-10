const pageData = JSON.parse(document.getElementById('page-data-share-picker').textContent);
const dialog = document.getElementById('nodePickerDialog');
const pickerList = document.getElementById('nodePickerList');
const searchInput = document.getElementById('nodeSearch');
const sourceSelect = document.getElementById('nodeSource');
const status = document.getElementById('nodePickerStatus');
const retryButton = document.getElementById('retryNodePicker');
const moreButton = document.getElementById('morePickerNodes');
const selectButton = document.getElementById('selectVisibleNodes');
const selected = new Set();
let availableNodes = [];
let candidatesLoaded = false;
let loading;
let searchTimer;
let visibleLimit = 100;
function esc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function visibleNodes() {
 const query = searchInput.value.trim().toLowerCase();
 return availableNodes.filter(node => (sourceSelect.value === 'all' || node.source === sourceSelect.value) && (!query || node.searchText.includes(query)));
}
function updateSelectedCount() {
 document.getElementById('selectedNodeCount').textContent = '已选择 ' + selected.size + ' 个';
 document.getElementById('addSelectedNodes').disabled = !selected.size;
}
function renderPicker() {
 clearTimeout(searchTimer);
 const visible = visibleNodes();
 pickerList.innerHTML = visible.length ? visible.slice(0, visibleLimit).map(node =>
  '<label class="picker-node"><input type="checkbox" data-node-id="' + esc(node.id) + '"' + (selected.has(node.selectionKey) ? ' checked' : '') + '><span><strong>' + esc(node.name) + '<span class="source-tag">' + esc(node.sourceName) + '</span></strong><small title="' + esc(node.content) + '">' + esc(node.content) + '</small></span></label>'
 ).join('') : '<div class="picker-empty">没有符合条件的节点</div>';
 document.getElementById('nodePickerProgress').textContent = '显示 ' + Math.min(visibleLimit, visible.length) + ' / ' + visible.length + ' 个结果';
 moreButton.hidden = visible.length <= visibleLimit;
 updateSelectedCount();
}
function applyNodes(nodes, retainLoaded = false) {
 const merged = new Map(retainLoaded ? availableNodes.map(node => [node.selectionKey, node]) : []);
 for (const node of nodes) merged.set(node.source + '\n' + node.content, node);
 availableNodes = [...merged.values()].map((node, index) => ({ ...node, id: 'picker-' + index, searchText: (node.name + '\n' + node.content).toLowerCase(), selectionKey: node.source + '\n' + node.content }));
 const keys = new Set(availableNodes.map(node => node.selectionKey));
 for (const key of selected) if (!keys.has(key)) selected.delete(key);
 selectButton.disabled = false;
 renderPicker();
}
async function fetchCandidates(suffix = '') {
 const response = await fetch('/api/node-candidates' + suffix, { cache: 'no-store' });
 const data = await response.json();
 if (!response.ok) throw new Error(data.message || '读取节点失败');
 return data;
}
function loadCandidates() {
 if (loading) return loading;
 if (candidatesLoaded) { renderPicker(); return Promise.resolve(); }
 retryButton.hidden = true;
 selectButton.disabled = !availableNodes.length;
 status.textContent = '正在读取' + pageData.sourceLabel + '节点…';
 loading = (async () => {
  const local = await fetchCandidates('?source=local');
  applyNodes(local.nodes, local.hasUpstream);
  if (local.hasUpstream) {
   status.textContent = '本地节点已就绪，正在补充上游节点，可先选择本地节点…';
   const full = await fetchCandidates();
   applyNodes(full.nodes, Boolean(full.upstreamFailures));
   candidatesLoaded = !full.upstreamFailures;
   status.textContent = full.upstreamFailures ? '部分上游读取失败，已保留本地及可用节点。' : '节点已加载；选择当前结果会选中全部筛选结果。';
   retryButton.hidden = candidatesLoaded;
  } else {
   candidatesLoaded = true;
   status.textContent = '节点已加载；选择当前结果会选中全部筛选结果。';
  }
 })().catch(error => {
  status.textContent = error.message + (availableNodes.length ? '，已保留已加载的节点。' : '，请重试。');
  retryButton.hidden = false;
 }).finally(() => { loading = null; });
 return loading;
}
function closePicker() { dialog.close(); }
document.getElementById('openNodePicker').addEventListener('click', () => {
 selected.clear();
 searchInput.value = '';
 sourceSelect.value = 'all';
 visibleLimit = 100;
 renderPicker();
 dialog.showModal();
 searchInput.focus();
 loadCandidates();
});
searchInput.addEventListener('input', () => {
 visibleLimit = 100;
 clearTimeout(searchTimer);
 searchTimer = setTimeout(renderPicker, 150);
});
sourceSelect.addEventListener('change', () => { visibleLimit = 100; renderPicker(); });
moreButton.addEventListener('click', () => { visibleLimit += 100; renderPicker(); });
retryButton.addEventListener('click', loadCandidates);
pickerList.addEventListener('change', event => {
 const checkbox = event.target.closest('[data-node-id]');
 if (!checkbox) return;
 const node = availableNodes.find(node => node.id === checkbox.dataset.nodeId);
 if (!node) return;
 if (checkbox.checked) selected.add(node.selectionKey); else selected.delete(node.selectionKey);
 updateSelectedCount();
});
selectButton.addEventListener('click', () => {
 visibleNodes().forEach(node => selected.add(node.selectionKey));
 renderPicker();
});
document.getElementById('addSelectedNodes').addEventListener('click', () => {
 const textarea = document.getElementById('shareContent');
 const current = textarea.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
 const seen = new Set(current);
 let added = 0;
 availableNodes.forEach(node => {
  if (selected.has(node.selectionKey) && !seen.has(node.content)) { current.push(node.content); seen.add(node.content); added++; }
 });
 textarea.value = current.join('\n');
 textarea.dispatchEvent(new Event('input', { bubbles: true }));
 closePicker();
 const message = document.getElementById('formMessage');
 message.textContent = added ? '已加入 ' + added + ' 个节点，尚未保存' : '所选节点已在内容中';
 message.className = added ? 'success' : 'muted';
});
document.getElementById('closeNodePicker').addEventListener('click', closePicker);
document.getElementById('cancelNodePicker').addEventListener('click', closePicker);
dialog.addEventListener('click', event => { if (event.target === dialog) closePicker(); });
updateSelectedCount();
