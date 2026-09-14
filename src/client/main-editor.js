import { compileMainConfig, legacyMainConfig, mainId, mainLines, mainNodeName, mainNodeSummary, isMainNode, isMainSource, originalText, normalizeMainAddress, normalizeMainConfig, MAIN_HTTPS_PORTS, MAIN_HTTP_PORTS } from '../shared/main-subscription.js';

export function initializeMainEditor(pageData, { showToast, askMainConfirm, copyText }) {
 const el = id => document.getElementById(id);
 const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
 const textarea = el('content');
 let config = structuredClone(pageData.mainConfig || legacyMainConfig(textarea.defaultValue));
 let revision = pageData.revision;
 let saved = JSON.stringify({ config, text: textarea.defaultValue });
 let lastText = textarea.defaultValue, timer, pending = false, compiled = null;
 let originalLimit = 100, previewLimit = 100, endpointLimit = 50, targetLimit = 100;
 let editingOriginal = '', editingEndpoint = '', selectedTargets = new Set();
 let endpointDirty = false;
 const undo = [];
 const draftKey = 'node2link:draft:' + location.host + location.pathname;
 const state = (message, kind = '') => { el('saveStatus').textContent = message; el('saveStatus').className = 'save-state ' + kind; };
 const snapshot = () => JSON.stringify({ config, text: textarea.value });
 function syncText() {
  if (lastText === textarea.value) return;
  // Match exact content only. Editing a row explicitly keeps its identity; a bulk replacement
  // cannot safely infer whether a changed line is an edit or a different node.
  const byContent = new Map();
  for (const node of config.originals) {
   if (!byContent.has(node.content)) byContent.set(node.content, []);
   byContent.get(node.content).push(node);
  }
  config.originals = mainLines(textarea.value).map(content => byContent.get(content)?.shift() || { id: mainId(), content });
  lastText = textarea.value;
 }
 function remember() { syncText(); undo.push(snapshot()); if (undo.length > 10) undo.shift(); el('undoButton').disabled = false; }
 function persistDraft() {
  try { const current = snapshot(); if (current === saved) localStorage.removeItem(draftKey); else localStorage.setItem(draftKey, current); }
  catch { /* Editing remains available when local storage is full or disabled. */ }
 }
 function flush() {
  if (!pending) return;
  clearTimeout(timer); pending = false; syncText(); render(); persistDraft();
 }
 function dirty(message = '有未保存更改') {
  state(message, 'dirty'); pending = true; clearTimeout(timer); timer = setTimeout(flush, 250);
 }
 function changed(message) {
  textarea.value = originalText(config); lastText = textarea.value;
  render(); dirty(message);
 }
 function restore(value) {
  const next = typeof value === 'string' ? JSON.parse(value) : value;
  const nextConfig = normalizeMainConfig(next.config || next, { allowIncomplete: true });
  config = nextConfig;
  textarea.value = typeof next.text === 'string' ? next.text : originalText(config);
  lastText = originalText(config); syncText(); render(); dirty('已载入，尚未保存');
 }
 function renderOriginals() {
  const query = el('originalSearch').value.trim().toLowerCase();
  const nodes = config.originals.map((node, index) => ({ ...node, name: mainNodeName(node.content, `主订阅节点 ${index + 1}`) })).filter(node => (node.name + '\n' + node.content).toLowerCase().includes(query));
  el('originalList').innerHTML = nodes.slice(0, originalLimit).map(node => `<article class="main-node-row"><div>${summary(node.content, isMainSource(node.content) ? '订阅源' : node.name)}</div><div class="main-row-actions"><button type="button" class="tool-button" data-view-original="${esc(node.id)}">查看</button><button type="button" class="tool-button" data-edit-original="${esc(node.id)}">编辑</button><button type="button" class="tool-button" data-delete-original="${esc(node.id)}">删除</button></div></article>`).join('') || '<p class="main-empty">点击“批量添加”粘贴节点或订阅源。</p>';
  el('originalProgress').textContent = `${Math.min(originalLimit, nodes.length)} / ${nodes.length} 项`;
  el('moreOriginals').hidden = nodes.length <= originalLimit;
 }
 function summary(content, name) {
  const info = mainNodeSummary(content);
  return `<strong title="${esc(name)}">${esc(name)}</strong><small><span class="main-badge">${esc(info.protocol)}</span> ${esc(info.address)}</small>`;
 }
 function viewNode(content) { el('nodeViewValue').value = content; el('nodeViewDialog').showModal(); }
 function renderEndpoints() {
  const names = new Map(config.originals.map((node, index) => [node.id, mainNodeName(node.content, `主订阅节点 ${index + 1}`)]));
  el('endpointList').innerHTML = config.endpoints.slice(0, endpointLimit).map(endpoint => `<article class="main-endpoint-row"><div><strong>${esc(endpoint.label || endpoint.address)} <span class="main-badge">${endpoint.enabled ? '启用' : '停用'}</span></strong><small>${esc(endpoint.address.includes(':') ? `[${endpoint.address}]:${endpoint.port}` : `${endpoint.address}:${endpoint.port}`)}</small><p>应用到 ${endpoint.originalIds.length} 个节点：${esc(endpoint.originalIds.map(id => names.get(id) || '【原始节点已移除，请重新选择】').join('、'))}</p></div><div class="main-row-actions"><button type="button" class="tool-button" data-edit-endpoint="${esc(endpoint.id)}">编辑关联</button><button type="button" class="tool-button" data-toggle-endpoint="${esc(endpoint.id)}">${endpoint.enabled ? '停用' : '启用'}</button><button type="button" class="tool-button" data-delete-endpoint="${esc(endpoint.id)}">删除</button></div></article>`).join('') || '<p class="main-empty">添加优选域名或 IP，并勾选要应用的原始节点。</p>';
  el('endpointProgress').textContent = `${Math.min(endpointLimit, config.endpoints.length)} / ${config.endpoints.length} 条`;
  el('moreEndpoints').hidden = config.endpoints.length <= endpointLimit;
 }
 function renderPreview() {
  const query = el('previewSearch').value.trim().toLowerCase();
  const kind = el('previewKind').value;
  const nodes = (compiled?.nodes || []).filter(node => (kind === 'all' || node.kind === kind) && (node.name + '\n' + node.content).toLowerCase().includes(query));
  el('mainPreview').innerHTML = nodes.slice(0, previewLimit).map(node => `<article class="main-node-row"><div>${summary(node.content, node.name)}</div><div class="main-row-actions"><span class="main-badge">${node.kind === 'original' ? '原始' : '扩展'}</span><button type="button" class="tool-button" data-view-main="${esc(node.id)}">查看</button><button type="button" class="tool-button" data-copy-main="${esc(node.id)}">复制</button></div></article>`).join('') || `<p class="main-empty">${compiled ? '没有符合条件的节点' : '请先修正配置问题，再预览生成结果'}</p>`;
  el('previewProgress').textContent = `${Math.min(previewLimit, nodes.length)} / ${nodes.length} 个`;
  el('morePreview').hidden = nodes.length <= previewLimit;
  el('exportMain').disabled = !compiled;
  el('exportExtensions').disabled = !compiled;
 }
 function render() {
  renderOriginals(); renderEndpoints();
  const nodes = config.originals.filter(node => isMainNode(node.content));
  el('lineCount').textContent = config.originals.length;
  el('nodeCount').textContent = nodes.length;
  el('sourceCount').textContent = config.originals.filter(node => isMainSource(node.content)).length;
  const protocols = {};
  nodes.forEach(node => { const protocol = node.content.split(':')[0].toUpperCase(); protocols[protocol] = (protocols[protocol] || 0) + 1; });
  el('protocolBreakdown').textContent = Object.entries(protocols).map(([key, count]) => `${key} ${count}`).join(' · ') || '暂无节点';
  let problem = '';
  try { compiled = compileMainConfig(config); } catch (error) { compiled = null; problem = error.message; }
  el('duplicateCount').textContent = compiled ? compiled.nodes.filter(node => node.kind === 'extension').length : '—';
  el('issueCount').textContent = problem ? 1 : 0;
  el('validationStatus').classList.toggle('has-issues', Boolean(problem));
  el('validationStatus').querySelector('span').textContent = problem ? '配置需要修正' : '配置检查通过';
  el('validationIssues').textContent = problem;
  el('mainPreviewNote').textContent = problem || `预览：${compiled.nodes.filter(node => node.kind === 'original').length} 个原始节点 + ${compiled.nodes.filter(node => node.kind === 'extension').length} 个扩展节点。保存并生效后用于订阅和分享选择。`;
  renderPreview();
 }
 function updateMetadata(metadata) {
  el('lastSaved').textContent = metadata?.savedAt ? `${new Date(metadata.savedAt).toLocaleString()} · ${metadata.lines || 0} 行输出` : '尚无保存记录';
 }
 function download(text, extension, kind = 'config') {
  const url = URL.createObjectURL(new Blob([text], { type: extension === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `node2link-main-${kind}-${new Date().toISOString().slice(0, 10)}.${extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
 }
 async function saveContent() {
  const button = el('saveButton');
  if (button.disabled) return;
  flush(); syncText();
  if (snapshot() === saved) { state('已同步'); return; }
  try { compileMainConfig(config); } catch (error) { state(error.message, 'error'); showToast(error.message); return; }
  const saving = snapshot();
  button.disabled = true; button.querySelector('span').textContent = '保存中'; state('正在保存…');
  try {
   const response = await fetch(location.href, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Node2Link-Action': 'save-config', 'X-Node2Link-Revision': revision }, body: JSON.stringify(config), cache: 'no-store' });
   const data = await response.json();
   if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
   saved = saving; revision = data.metadata.revision; updateMetadata(data.metadata);
   flush(); syncText(); persistDraft();
   state(snapshot() === saved ? '刚刚已保存' : '保存期间有新修改，请再次保存', snapshot() === saved ? '' : 'dirty');
   showToast('主订阅已保存，原始与扩展节点已生效');
  } catch (error) { state('保存失败：' + error.message, 'error'); showToast(error.message); }
  finally { button.disabled = false; button.querySelector('span').textContent = '保存并生效'; }
 }
 function renderTargets() {
  const query = el('targetSearch').value.trim().toLowerCase();
  const nodes = config.originals.filter(node => isMainNode(node.content)).map((node, index) => ({ ...node, name: mainNodeName(node.content, `主订阅节点 ${index + 1}`) })).filter(node => (node.name + '\n' + node.content).toLowerCase().includes(query));
  el('endpointTargets').innerHTML = nodes.slice(0, targetLimit).map(node => `<label class="main-target"><input type="checkbox" value="${esc(node.id)}" ${selectedTargets.has(node.id) ? 'checked' : ''}><span><strong>${esc(node.name)}</strong><small>${esc(node.content)}</small></span></label>`).join('') || '<p class="main-empty">没有可选的原始节点</p>';
  el('targetCount').textContent = `已选 ${selectedTargets.size} 个 · 显示 ${Math.min(targetLimit, nodes.length)} / ${nodes.length}`;
  el('moreTargets').hidden = nodes.length <= targetLimit;
  return nodes;
 }
 function openEndpoint(id = '') {
  flush(); syncText(); editingEndpoint = id;
  const endpoint = config.endpoints.find(item => item.id === id);
  const existingIds = new Set(config.originals.filter(node => isMainNode(node.content)).map(node => node.id));
  selectedTargets = new Set((endpoint?.originalIds || []).filter(id => existingIds.has(id)));
  el('endpointTitle').textContent = endpoint ? '编辑优选地址与关联' : '添加优选地址';
  el('endpointRows').innerHTML = '';
  addEndpointRow(endpoint);
  el('addEndpointRow').hidden = Boolean(endpoint);
  el('endpointEnabled').checked = endpoint?.enabled ?? true;
  el('endpointError').textContent = ''; el('targetSearch').value = ''; targetLimit = 100;
  renderTargets(); endpointDirty = false; el('endpointDialog').showModal();
 }
 function addEndpointRow(endpoint = {}) {
  const row = document.createElement('div'); row.className = 'endpoint-input-row';
  row.innerHTML = `<label>域名 / IP<input data-address required spellcheck="false" placeholder="cf.example.com" value="${esc(endpoint.address || '')}"></label><label>端口<input data-port type="number" min="1" max="65535" step="1" list="endpointPorts" required value="${esc(endpoint.port || 443)}"></label><label>备注<input data-label maxlength="160" placeholder="可选" value="${esc(endpoint.label || '')}"></label><button type="button" class="tool-button" data-remove-endpoint-row>移除</button>`;
  el('endpointRows').append(row);
  for (const button of el('endpointRows').querySelectorAll('[data-remove-endpoint-row]')) button.hidden = editingEndpoint !== '' || el('endpointRows').children.length === 1;
 }
 el('addEndpointRow').addEventListener('click', () => { addEndpointRow(); endpointDirty = true; });
 el('endpointRows').addEventListener('click', event => {
  if (!event.target.closest('[data-remove-endpoint-row]')) return;
  event.target.closest('.endpoint-input-row').remove(); endpointDirty = true;
  if (el('endpointRows').children.length === 1) el('endpointRows').querySelector('[data-remove-endpoint-row]').hidden = true;
 });
 async function closeEndpoint() {
  if (endpointDirty && !await askMainConfirm('放弃本次优选地址编辑？已加入主页面的配置不受影响。', '放弃编辑')) return;
  el('endpointDialog').close();
 }
 el('addEndpoint').addEventListener('click', () => openEndpoint());
 el('endpointForm').addEventListener('input', () => { endpointDirty = true; });
 el('endpointForm').addEventListener('submit', event => {
  event.preventDefault(); el('endpointError').textContent = '';
  try {
   const added = [...el('endpointRows').children].map(row => ({ id: editingEndpoint || mainId(), address: normalizeMainAddress(row.querySelector('[data-address]').value), port: Number(row.querySelector('[data-port]').value), label: row.querySelector('[data-label]').value.trim(), enabled: el('endpointEnabled').checked, originalIds: [...selectedTargets] }));
   const next = { ...config, endpoints: editingEndpoint ? config.endpoints.map(endpoint => endpoint.id === editingEndpoint ? added[0] : endpoint) : [...config.endpoints, ...added] };
   normalizeMainConfig({ ...config, endpoints: added });
   normalizeMainConfig(next, { allowIncomplete: true });
   remember(); config = next; changed('优选地址已加入，尚未保存'); el('endpointDialog').close();
  } catch (error) { el('endpointError').textContent = error.message; }
 });
 for (const id of ['closeEndpoint', 'cancelEndpoint']) el(id).addEventListener('click', closeEndpoint);
 el('endpointDialog').addEventListener('cancel', event => { event.preventDefault(); closeEndpoint(); });
 el('targetSearch').addEventListener('input', () => { targetLimit = 100; renderTargets(); });
 el('moreTargets').addEventListener('click', () => { targetLimit += 100; renderTargets(); });
 el('selectTargets').addEventListener('click', () => { renderTargets().forEach(node => selectedTargets.add(node.id)); endpointDirty = true; renderTargets(); });
 el('clearTargets').addEventListener('click', () => { selectedTargets.clear(); endpointDirty = true; renderTargets(); });
 el('endpointTargets').addEventListener('change', event => {
  if (!event.target.matches('input[type="checkbox"]')) return;
  if (event.target.checked) selectedTargets.add(event.target.value); else selectedTargets.delete(event.target.value);
  endpointDirty = true; renderTargets();
 });
 el('endpointList').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.editEndpoint) return openEndpoint(button.dataset.editEndpoint);
  const id = button.dataset.deleteEndpoint || button.dataset.toggleEndpoint;
  if (button.dataset.deleteEndpoint && !await askMainConfirm('删除此优选地址？保存后会移除它生成的全部扩展节点。', '删除优选地址')) return;
  remember();
  if (button.dataset.deleteEndpoint) config.endpoints = config.endpoints.filter(item => item.id !== id);
  else { const endpoint = config.endpoints.find(item => item.id === id); if (endpoint) endpoint.enabled = !endpoint.enabled; }
  changed();
 });
 el('originalList').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  const id = button.dataset.editOriginal || button.dataset.deleteOriginal || button.dataset.viewOriginal;
  const node = config.originals.find(item => item.id === id); if (!node) return;
  if (button.dataset.viewOriginal) return viewNode(node.content);
  if (button.dataset.editOriginal) {
   editingOriginal = id; el('originalValue').value = node.content; el('originalError').textContent = ''; el('originalDialog').showModal(); return;
  }
  const count = config.endpoints.filter(endpoint => endpoint.originalIds.includes(id)).length;
  if (!await askMainConfirm(`删除此原始节点？它关联 ${count} 条优选地址，保存后将移除对应扩展节点；没有剩余关联的地址会停用。`, '删除原始节点')) return;
  remember(); config.originals = config.originals.filter(item => item.id !== id);
  config.endpoints.forEach(endpoint => { endpoint.originalIds = endpoint.originalIds.filter(item => item !== id); if (!endpoint.originalIds.length) endpoint.enabled = false; });
  changed();
 });
 el('originalForm').addEventListener('submit', event => {
  event.preventDefault();
  const value = el('originalValue').value.trim();
  if (!value || /[\r\n\0]/.test(value)) { el('originalError').textContent = '请填写一条完整链接'; return; }
  remember(); const node = config.originals.find(item => item.id === editingOriginal);
  if (node) node.content = value;
  changed('原始节点已修改，关联关系已保留，尚未保存'); el('originalDialog').close();
 });
 for (const id of ['closeOriginal', 'cancelOriginal']) el(id).addEventListener('click', () => el('originalDialog').close());
 el('mainPreview').addEventListener('click', event => {
  const button = event.target.closest('[data-copy-main], [data-view-main]');
  const node = compiled?.nodes.find(node => node.id === (button?.dataset.copyMain || button?.dataset.viewMain));
  if (node && button.dataset.viewMain) return viewNode(node.content);
  if (node) copyText(node.content).then(() => showToast('节点已复制')).catch(() => showToast('复制失败'));
 });
 for (const id of ['previewSearch', 'previewKind']) el(id).addEventListener('input', () => { previewLimit = 100; renderPreview(); });
 el('originalSearch').addEventListener('input', () => { originalLimit = 100; renderOriginals(); });
 el('moreOriginals').addEventListener('click', () => { originalLimit += 100; renderOriginals(); });
 el('moreEndpoints').addEventListener('click', () => { endpointLimit += 50; renderEndpoints(); });
 el('morePreview').addEventListener('click', () => { previewLimit += 100; renderPreview(); });
 el('exportMain').addEventListener('click', () => { flush(); if (compiled) download(compiled.content, 'txt', 'all'); });
 el('exportOriginals').addEventListener('click', () => { flush(); download(originalText(config), 'txt', 'originals'); });
 el('exportExtensions').addEventListener('click', () => { flush(); if (compiled) download(compiled.nodes.filter(node => node.kind === 'extension').map(node => node.content).join('\n'), 'txt', 'extensions'); });
 el('closeNodeView').addEventListener('click', () => el('nodeViewDialog').close());
 el('copyNodeView').addEventListener('click', () => copyText(el('nodeViewValue').value).then(() => showToast('节点已复制')).catch(() => showToast('复制失败')));
 el('addOriginals').addEventListener('click', () => { flush(); el('batchValue').value = ''; el('batchError').textContent = ''; el('batchDialog').showModal(); });
 async function closeBatch() {
  if (el('batchValue').value.trim() && !await askMainConfirm('放弃本次输入的节点？', '放弃批量添加')) return;
  el('batchDialog').close();
 }
 el('closeBatch').addEventListener('click', closeBatch);
 el('batchDialog').addEventListener('cancel', event => { event.preventDefault(); closeBatch(); });
 el('batchForm').addEventListener('submit', async event => {
  event.preventDefault(); el('batchError').textContent = '';
  const lines = mainLines(el('batchValue').value);
  const replace = event.submitter?.value === 'replace';
  if (!lines.length && !replace) { el('batchError').textContent = '请至少填写一条节点或订阅源'; return; }
  const byContent = new Map();
  config.originals.forEach(node => { if (!byContent.has(node.content)) byContent.set(node.content, []); byContent.get(node.content).push(node); });
  const originals = replace ? lines.map(content => byContent.get(content)?.shift() || { id: mainId(), content }) : [...config.originals, ...lines.map(content => ({ id: mainId(), content }))];
  const ids = new Set(originals.map(node => node.id));
  const removed = config.originals.filter(node => !ids.has(node.id)).length;
  const associations = config.endpoints.reduce((count, endpoint) => count + endpoint.originalIds.filter(id => !ids.has(id)).length, 0);
  if (replace && !await askMainConfirm(`覆盖后保留 ${originals.length} 项，移除 ${removed} 个旧节点及 ${associations} 个优选关联。没有剩余关联的地址会停用。修改名称或 UUID 请取消并使用逐条编辑。是否覆盖？`, '覆盖原始节点')) return;
  const endpoints = config.endpoints.map(endpoint => { const originalIds = endpoint.originalIds.filter(id => ids.has(id)); return { ...endpoint, originalIds, enabled: endpoint.enabled && originalIds.length > 0 }; });
  try {
   const next = normalizeMainConfig({ ...config, originals, endpoints: replace ? endpoints : config.endpoints }, { allowIncomplete: true });
   remember(); config = next; changed('批量修改已应用，尚未保存'); el('batchDialog').close();
  } catch (error) { el('batchError').textContent = error.message; }
 });
 el('restoreInput').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
   if (file.size > 24 * 1024 * 1024) throw new Error('备份文件不能超过 24 MB');
   const text = await file.text();
   const next = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : { config: legacyMainConfig(text), text };
   normalizeMainConfig(next.config || next, { allowIncomplete: true });
   if (!await askMainConfirm('将备份载入编辑器？JSON 恢复完整配置；文本文件载入为原始节点并清空优选配置。可撤销，保存后生效。', '载入备份')) return;
   remember(); restore(next);
  } catch (error) { showToast(error.message); }
 });
 Object.assign(window, {
  saveContent,
  downloadBackup() { flush(); syncText(); download(snapshot(), 'json'); showToast('主订阅配置备份已下载'); },
  async loadLastSavedVersion() {
   try {
    const response = await fetch(location.href, { method: 'POST', headers: { 'X-Node2Link-Action': 'get-backup' }, cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.message);
    if (!await askMainConfirm('载入上次保存的完整主订阅配置？当前内容可以撤销恢复，保存后生效。', '载入上次版本')) return;
    remember(); restore({ config: data.config || legacyMainConfig(data.content), text: data.config ? originalText(data.config) : data.content });
   } catch (error) { showToast(error.message); }
  },
  undoLastChange() { if (!undo.length) return; const previous = undo.pop(); restore(previous); el('undoButton').disabled = !undo.length; },
  openDedupePreview() {
   flush(); const lines = mainLines(textarea.value);
   el('previewBefore').textContent = lines.length; el('previewDuplicates').textContent = lines.length - new Set(lines).size; el('previewAfter').textContent = new Set(lines).size;
   el('applyDedupeButton').disabled = [...new Set(lines)].join('\n') === textarea.value; el('toolDialog').showModal();
  },
  closeToolDialog() { el('toolDialog').close(); },
  applyDedupe() {
   remember(); const keep = new Map(), replacements = new Map();
   config.originals.forEach(node => { if (keep.has(node.content)) replacements.set(node.id, keep.get(node.content).id); else keep.set(node.content, node); });
   config.originals = [...keep.values()];
   config.endpoints.forEach(endpoint => { endpoint.originalIds = [...new Set(endpoint.originalIds.map(id => replacements.get(id) || id))]; });
   changed('整理结果尚未保存'); el('toolDialog').close();
  }
 });
 textarea.addEventListener('input', () => dirty());
 document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!document.querySelector('dialog[open]')) saveContent(); } });
 window.addEventListener('pagehide', flush);
 document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
 window.addEventListener('beforeunload', event => { flush(); if (snapshot() !== saved || endpointDirty && el('endpointDialog').open || el('batchDialog').open && el('batchValue').value.trim()) { event.preventDefault(); event.returnValue = ''; } });
 el('endpointPorts').innerHTML = [...MAIN_HTTPS_PORTS, ...MAIN_HTTP_PORTS].map(port => `<option value="${port}">${MAIN_HTTPS_PORTS.includes(port) ? 'HTTPS' : 'HTTP'}</option>`).join('');
 updateMetadata(pageData.savedMetadata); render(); el('saveButton').disabled = false;
 if (textarea.value !== textarea.defaultValue) dirty();
 else {
  try {
   const draft = localStorage.getItem(draftKey);
   if (draft && draft !== saved && draft !== textarea.value) {
    askMainConfirm('发现尚未保存的主订阅草稿，是否恢复？', '恢复本地草稿').then(accepted => {
     if (!accepted) { localStorage.removeItem(draftKey); return; }
     try { let value; try { value = JSON.parse(draft); } catch { value = { config: legacyMainConfig(draft), text: draft }; } restore(value); }
     catch (error) { showToast('草稿载入失败：' + error.message); }
    });
   }
  } catch { /* No local draft support. */ }
 }
}
