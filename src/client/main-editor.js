import { compileMainConfig, legacyMainConfig, mainId, mainLines, mainNodeName, mainNodeSummary, isMainNode, isMainSource, originalText, normalizeMainAddress, normalizeMainConfig, MAIN_HTTPS_PORTS, MAIN_HTTP_PORTS, reconcileMainEndpoints } from '../shared/main-subscription.js';

export function initializeMainEditor(pageData, { showToast, askMainConfirm, copyText }) {
 const el = id => document.getElementById(id);
 const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
 const textarea = el('content');
 const saveButton = el('saveButton');
 let config = structuredClone(pageData.mainConfig || legacyMainConfig(textarea.defaultValue));
 let revision = pageData.revision;
 let saved = snapshot(config);
 let timer, pending = false, compiled = null;
 let originalLimit = 100, previewLimit = 100, endpointLimit = 50, targetLimit = 100;
 let editingOriginal = '', editingEndpoint = '', selectedTargets = new Set();
 let endpointInitialValue = '', originalInitialValue = '', saving = false;
 const selectedOriginals = new Set();
 const draftKey = 'node2link:draft:' + location.host + location.pathname;
 const state = (message, kind = '') => { el('saveStatus').textContent = message; el('saveStatus').className = 'save-state ' + kind; };
 // Compare configuration values, never the textarea's browser-normalized whitespace
 // or the property insertion order of stored/server-returned objects.
 function snapshot(value = config) {
  const normalized = {
   version: value.version,
   originals: value.originals.map(({ id, content }) => ({ id, content })),
   endpoints: value.endpoints.map(({ id, address, port, label, enabled, originalIds }) => ({ id, address, port, label, enabled, originalIds }))
  };
  return JSON.stringify({ config: normalized, text: originalText(normalized) });
 }
 function parseDraft(draft) {
  let value; try { value = JSON.parse(draft); } catch { value = legacyMainConfig(draft); }
  return normalizeMainConfig(value.config || value, { allowIncomplete: true });
 }
 function syncText() { textarea.value = originalText(config); }
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
  textarea.value = originalText(config);
  render(); dirty(message);
 }
 function filteredOriginals() {
  const query = el('originalSearch').value.trim().toLowerCase();
  return config.originals.map((node, index) => ({ ...node, name: mainNodeName(node.content, `主订阅节点 ${index + 1}`) })).filter(node => (node.name + '\n' + node.content).toLowerCase().includes(query));
 }
 function renderOriginals() {
  const ids = new Set(config.originals.map(node => node.id));
  for (const id of selectedOriginals) if (!ids.has(id)) selectedOriginals.delete(id);
  const nodes = filteredOriginals();
  el('originalList').innerHTML = nodes.slice(0, originalLimit).map(node => `<article class="main-node-row"><div class="node-heading"><input type="checkbox" data-select-original="${esc(node.id)}" aria-label="选择 ${esc(node.name)}" ${selectedOriginals.has(node.id) ? 'checked' : ''}><div>${summary(node.content, isMainSource(node.content) ? '订阅源' : node.name)}</div></div><div class="main-row-actions"><button type="button" class="tool-button" data-view-original="${esc(node.id)}">查看</button><button type="button" class="tool-button" data-edit-original="${esc(node.id)}">编辑</button><button type="button" class="tool-button" data-delete-original="${esc(node.id)}">删除</button></div></article>`).join('') || '<p class="main-empty">没有匹配的节点，可点击“批量添加”添加节点或订阅源。</p>';
  updateOriginalSelection();
  el('originalProgress').textContent = `${Math.min(originalLimit, nodes.length)} / ${nodes.length} 项`;
  el('moreOriginals').hidden = nodes.length <= originalLimit;
 }
 function updateOriginalSelection() {
  el('originalSelectionCount').textContent = `已选 ${selectedOriginals.size} 项（含筛选外）`;
  el('deleteOriginals').disabled = !selectedOriginals.size;
  const nodes = filteredOriginals();
  const allSelected = nodes.length > 0 && nodes.every(node => selectedOriginals.has(node.id));
  el('selectOriginals').disabled = !nodes.length;
  el('selectOriginals').textContent = allSelected ? '取消全选' : '全选筛选结果';
  el('selectOriginals').setAttribute('aria-pressed', String(allSelected));
  el('selectOriginals').title = allSelected ? '取消当前筛选结果的选择，保留筛选外的选择' : '选择全部筛选结果，包括尚未显示的节点';
 }
 async function removeOriginals(ids) {
  await publishOriginals(config.originals.filter(node => !ids.has(node.id)));
 }
 function summary(content, name) {
  const info = mainNodeSummary(content);
  return `<strong title="${esc(name)}">${esc(name)}</strong><small><span class="main-badge">${esc(info.protocol)}</span> ${esc(info.address)}</small>`;
 }
 function viewNode(content) { el('nodeViewValue').value = content; el('nodeViewDialog').showModal(); }
 function renderEndpoints() {
  const names = new Map(config.originals.map((node, index) => [node.id, mainNodeName(node.content, `主订阅节点 ${index + 1}`)]));
  el('endpointList').innerHTML = config.endpoints.slice(0, endpointLimit).map(endpoint => {
   const label = endpoint.label || endpoint.address;
   const address = (endpoint.address.includes(':') ? '[' + endpoint.address + ']' : endpoint.address) + ':' + endpoint.port;
   const association = '应用到 ' + endpoint.originalIds.length + ' 个节点：' + endpoint.originalIds.map(id => names.get(id) || '【原始节点已移除，请重新选择】').join('、');
   return `<article class="main-node-row main-endpoint-row"><div><div class="endpoint-card-heading"><strong title="${esc(label)}">${esc(label)}</strong><span class="main-badge">${endpoint.enabled ? '启用' : '停用'}</span></div><small title="${esc(address)}">${esc(address)}</small><p title="${esc(association)}">${esc(association)}</p></div><div class="main-row-actions"><button type="button" class="tool-button" data-edit-endpoint="${esc(endpoint.id)}">编辑关联</button><button type="button" class="tool-button" data-toggle-endpoint="${esc(endpoint.id)}">${endpoint.enabled ? '停用' : '启用'}</button><button type="button" class="tool-button" data-delete-endpoint="${esc(endpoint.id)}">删除</button></div></article>`;
  }).join('') || '<p class="main-empty">添加优选域名或 IP，并勾选要应用的原始节点。</p>';
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
  el('mainPreviewNote').textContent = problem || `预览：${compiled.nodes.filter(node => node.kind === 'original').length} 个原始节点 + ${compiled.nodes.filter(node => node.kind === 'extension').length} 个扩展节点。基于已生效原始节点生成；优选修改保存后发布。导出当前预览，不受筛选影响。`;
  renderPreview();
 }
 function updateMetadata(metadata) {
  el('lastSaved').textContent = metadata?.savedAt ? `${new Date(metadata.savedAt).toLocaleString()} · ${metadata.lines || 0} 行输出` : '尚无保存记录';
 }
 function download(text, extension, kind = 'config') {
  const url = URL.createObjectURL(new Blob([text], { type: extension === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `node2link-main-${kind}-${new Date().toISOString().slice(0, 10)}.${extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
 }
 function updateSaveButton() {
  saveButton.disabled = saving;
  el('originalSection').querySelectorAll('button').forEach(button => { if (saving) { button.dataset.wasDisabled = String(button.disabled); button.disabled = true; } else if (button.dataset.wasDisabled !== undefined) { button.disabled = button.dataset.wasDisabled === 'true'; delete button.dataset.wasDisabled; } });
  for (const id of ['originalForm', 'batchForm']) el(id).querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = saving; });
  if (!saving) updateOriginalSelection();
  saveButton.querySelector('span').textContent = saving ? '保存中' : '保存全部并生效';
  saveButton.setAttribute('aria-busy', String(saving));
 }
 async function saveContent() {
  if (saving) return;
  flush(); syncText();
  if (snapshot() === saved) { state('已同步'); return; }
  try { compileMainConfig(config); } catch (error) { state(error.message, 'error'); showToast(error.message); return; }
  saving = true; updateSaveButton(); state('正在保存…');
  try {
   const response = await fetch(location.href, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Node2Link-Action': 'save-endpoints', 'X-Node2Link-Revision': revision }, body: JSON.stringify({ endpoints: config.endpoints }), cache: 'no-store' });
   const data = await response.json();
   if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
   saved = snapshot(data.config); revision = data.metadata.revision; updateMetadata(data.metadata);
   flush(); syncText(); persistDraft();
   state(snapshot() === saved ? '刚刚已保存' : '保存期间有新修改，请再次保存', snapshot() === saved ? '' : 'dirty');
   showToast('优选配置已保存，扩展节点已生效');
  } catch (error) { state('保存失败：' + error.message, 'error'); showToast(error.message); }
  finally { saving = false; updateSaveButton(); }
 }
 async function publishOriginals(originals, { historyRevision } = {}) {
  if (saving) { showToast('正在保存，请稍后重试'); return false; }
  const previous = structuredClone(config.originals);
  saving = true; updateSaveButton(); el('originalSaveStatus').textContent = '正在保存原始节点…';
  try {
   const response = await fetch(location.href, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Node2Link-Action': historyRevision ? 'restore-originals' : 'save-originals', 'X-Node2Link-Revision': revision }, body: JSON.stringify(historyRevision ? { revision: historyRevision } : { originals }), cache: 'no-store' });
   const data = await response.json(); if (!response.ok) throw new Error(data.message || '保存失败');
   config = { ...data.config, endpoints: reconcileMainEndpoints(config.endpoints, data.config.originals, previous) };
   saved = snapshot(data.config);
   revision = data.metadata.revision; syncText(); render(); persistDraft(); updateMetadata(data.metadata);
   state(snapshot() === saved ? '已同步' : '优选配置有未保存更改', snapshot() === saved ? '' : 'dirty');
   el('originalSaveStatus').textContent = '原始节点已保存'; showToast('原始节点已生效，已发布的扩展节点同步更新');
   return true;
  } catch (error) { el('originalSaveStatus').textContent = '保存失败：' + error.message; showToast(error.message); return false; }
  finally { saving = false; updateSaveButton(); }
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
  renderTargets(); endpointInitialValue = endpointSnapshot(); el('endpointDialog').showModal();
 }
 function addEndpointRow(endpoint = {}) {
  const row = document.createElement('div'); row.className = 'endpoint-input-row';
  const port = Number(endpoint.port || 443);
  const customPort = ![...MAIN_HTTPS_PORTS, ...MAIN_HTTP_PORTS].includes(port);
  const portOptions = (ports, label) => `<optgroup label="${label}">${ports.map(value => `<option value="${value}" ${value === port ? 'selected' : ''}>${value}</option>`).join('')}</optgroup>`;
  row.innerHTML = `<label>域名 / IP<input data-address required spellcheck="false" placeholder="cf.example.com" value="${esc(endpoint.address || '')}"></label><div class="endpoint-port-field"><label>端口<select data-port-preset>${portOptions(MAIN_HTTPS_PORTS, 'Cloudflare HTTPS')}${portOptions(MAIN_HTTP_PORTS, 'Cloudflare HTTP')}<option value="custom" ${customPort ? 'selected' : ''}>自定义</option></select></label><input data-port aria-label="自定义端口" type="number" min="1" max="65535" step="1" ${customPort ? 'required' : 'hidden'} value="${esc(port)}"></div><label>备注<input data-label maxlength="160" placeholder="可选" value="${esc(endpoint.label || '')}"></label><button type="button" class="tool-button" data-remove-endpoint-row>移除</button>`;
  el('endpointRows').append(row);
  for (const button of el('endpointRows').querySelectorAll('[data-remove-endpoint-row]')) button.hidden = editingEndpoint !== '' || el('endpointRows').children.length === 1;
 }
 el('endpointRows').addEventListener('change', event => {
  if (!event.target.matches('[data-port-preset]')) return;
  const input = event.target.closest('.endpoint-port-field').querySelector('[data-port]');
  const custom = event.target.value === 'custom';
  input.hidden = !custom; input.required = custom;
  if (custom) input.focus(); else input.value = event.target.value;

 });
 el('addEndpointRow').addEventListener('click', () => { addEndpointRow(); });
 el('endpointRows').addEventListener('click', event => {
  if (!event.target.closest('[data-remove-endpoint-row]')) return;
  event.target.closest('.endpoint-input-row').remove();
  if (el('endpointRows').children.length === 1) el('endpointRows').querySelector('[data-remove-endpoint-row]').hidden = true;
 });
 function endpointSnapshot() {
  return JSON.stringify({
   rows: [...el('endpointRows').children].map(row => ['address', 'port', 'label'].map(field => row.querySelector('[data-' + field + ']').value)),
   enabled: el('endpointEnabled').checked,
   originalIds: [...selectedTargets].sort()
  });
 }
 const endpointHasChanges = () => el('endpointDialog').open && endpointSnapshot() !== endpointInitialValue;
 async function closeEndpoint() {
  if (endpointHasChanges() && !await askMainConfirm('放弃本次优选地址编辑？已加入主页面的配置不受影响。', '放弃编辑')) return;
  el('endpointDialog').close();
 }
 el('addEndpoint').addEventListener('click', () => openEndpoint());
 el('endpointForm').addEventListener('submit', event => {
  event.preventDefault(); el('endpointError').textContent = '';
  try {
   const added = [...el('endpointRows').children].map(row => ({ id: editingEndpoint || mainId(), address: normalizeMainAddress(row.querySelector('[data-address]').value), port: Number(row.querySelector('[data-port]').value), label: row.querySelector('[data-label]').value.trim(), enabled: el('endpointEnabled').checked, originalIds: [...selectedTargets] }));
   const next = { ...config, endpoints: editingEndpoint ? config.endpoints.map(endpoint => endpoint.id === editingEndpoint ? added[0] : endpoint) : [...config.endpoints, ...added] };
   normalizeMainConfig({ ...config, endpoints: added });
   normalizeMainConfig(next, { allowIncomplete: true });
   config = next; changed('优选地址已加入，尚未保存'); el('endpointDialog').close();
  } catch (error) { el('endpointError').textContent = error.message; }
 });
 for (const id of ['closeEndpoint', 'cancelEndpoint']) el(id).addEventListener('click', closeEndpoint);
 el('endpointDialog').addEventListener('cancel', event => { event.preventDefault(); closeEndpoint(); });
 el('targetSearch').addEventListener('input', () => { targetLimit = 100; renderTargets(); });
 el('moreTargets').addEventListener('click', () => { targetLimit += 100; renderTargets(); });
 el('selectTargets').addEventListener('click', () => { renderTargets().forEach(node => selectedTargets.add(node.id)); renderTargets(); });
 el('clearTargets').addEventListener('click', () => { selectedTargets.clear(); renderTargets(); });
 el('endpointTargets').addEventListener('change', event => {
  if (!event.target.matches('input[type="checkbox"]')) return;
  if (event.target.checked) selectedTargets.add(event.target.value); else selectedTargets.delete(event.target.value);
   renderTargets();
 });
 el('endpointList').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.editEndpoint) return openEndpoint(button.dataset.editEndpoint);
  const id = button.dataset.deleteEndpoint || button.dataset.toggleEndpoint;
  if (button.dataset.deleteEndpoint && !await askMainConfirm('删除此优选地址？保存后会移除它生成的全部扩展节点。', '删除优选地址')) return;
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
   editingOriginal = id; originalInitialValue = node.content; el('originalValue').value = node.content; el('originalError').textContent = ''; el('originalDialog').showModal(); return;
  }
  const count = config.endpoints.filter(endpoint => endpoint.originalIds.includes(id)).length;
  if (!await askMainConfirm(`删除此原始节点？它关联 ${count} 条优选地址，立即移除对应扩展节点；没有剩余关联的地址会停用。`, '删除原始节点')) return;
  removeOriginals(new Set([id]));
 });
 el('originalList').addEventListener('change', event => {
  const id = event.target.dataset.selectOriginal;
  if (!id) return;
  if (event.target.checked) selectedOriginals.add(id); else selectedOriginals.delete(id);
  updateOriginalSelection();
 });
 el('selectOriginals').addEventListener('click', () => {
  const nodes = filteredOriginals();
  const allSelected = nodes.every(node => selectedOriginals.has(node.id));
  nodes.forEach(node => { if (allSelected) selectedOriginals.delete(node.id); else selectedOriginals.add(node.id); });
  renderOriginals();
 });
 el('deleteOriginals').addEventListener('click', async () => {
  const ids = new Set(selectedOriginals);
  if (!ids.size) return;
  const associations = config.endpoints.reduce((sum, endpoint) => sum + endpoint.originalIds.filter(id => ids.has(id)).length, 0);
  if (!await askMainConfirm(`删除所选 ${ids.size} 项（含筛选外已选节点）及 ${associations} 个优选关联？没有剩余关联的地址会停用。删除后立即生效。`, '批量删除原始节点')) return;
  removeOriginals(ids);
 });
 el('originalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const value = el('originalValue').value.trim();
  if (!value || /[\r\n\0]/.test(value)) { el('originalError').textContent = '请填写一条完整链接'; return; }
  if (await publishOriginals(config.originals.map(node => node.id === editingOriginal ? { ...node, content: value } : node))) el('originalDialog').close();
  else el('originalError').textContent = '保存未完成，输入已保留。请根据提示修正后重试。';
 });
 const originalHasChanges = () => el('originalDialog').open && el('originalValue').value !== originalInitialValue;
 async function closeOriginal() {
  if (saving) return;
  if (originalHasChanges() && !await askMainConfirm('放弃本次原始节点编辑？已应用的节点和优选关联不受影响。', '放弃节点编辑')) return;
  el('originalDialog').close();
 }
 for (const id of ['closeOriginal', 'cancelOriginal']) el(id).addEventListener('click', closeOriginal);
 el('originalDialog').addEventListener('cancel', event => { event.preventDefault(); closeOriginal(); });
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
  if (saving) return;
  if (el('batchValue').value.trim() && !await askMainConfirm('放弃本次输入的节点？', '放弃批量添加')) return;
  el('batchDialog').close();
 }
 el('closeBatch').addEventListener('click', closeBatch);
 el('batchDialog').addEventListener('cancel', event => { event.preventDefault(); closeBatch(); });
 el('batchForm').addEventListener('submit', async event => {
  event.preventDefault(); el('batchError').textContent = '';
  const lines = mainLines(el('batchValue').value);
  const replace = event.submitter?.value === 'replace';
  if (!lines.length) { el('batchError').textContent = '请至少填写一条节点或订阅源，不能用空内容覆盖列表'; return; }
  const byContent = new Map();
  config.originals.forEach(node => { if (!byContent.has(node.content)) byContent.set(node.content, []); byContent.get(node.content).push(node); });
  const originals = replace ? lines.map(content => byContent.get(content)?.shift() || { id: mainId(), content }) : [...config.originals, ...lines.map(content => ({ id: mainId(), content }))];
  const ids = new Set(originals.map(node => node.id));
  const removed = config.originals.filter(node => !ids.has(node.id)).length;
  const associations = config.endpoints.reduce((count, endpoint) => count + endpoint.originalIds.filter(id => !ids.has(id)).length, 0);
  if (replace && !await askMainConfirm(`覆盖后保留 ${originals.length} 项，移除 ${removed} 个旧节点及 ${associations} 个优选关联。没有剩余关联的地址会停用。修改名称或 UUID 请取消并使用逐条编辑。是否覆盖？`, '覆盖原始节点')) return;
  if (await publishOriginals(originals)) el('batchDialog').close();
  else el('batchError').textContent = '保存未完成，输入已保留。请根据提示修正后重试。';
 });
 el('restoreInput').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
   if (!file.name.toLowerCase().endsWith('.txt')) throw new Error('请选择 TXT 格式的原始节点文件');
   if (file.size > 20 * 1024 * 1024) throw new Error('TXT 文件不能超过 20 MB');
   const lines = mainLines(await file.text()); if (!lines.length) throw new Error('TXT 文件中没有节点');
   if (!await askMainConfirm('从 TXT 覆盖原始节点并立即生效？相同链接保留关联，被移除节点的关联会清理。', '导入原始节点')) return;
   const byContent = new Map();
   config.originals.forEach(node => { if (!byContent.has(node.content)) byContent.set(node.content, []); byContent.get(node.content).push(node); });
   await publishOriginals(lines.map(content => byContent.get(content)?.shift() || { id: mainId(), content }));
  } catch (error) { showToast(error.message); }
 });
 let historyVersion = null, historyRequest = 0;
 async function historyRequestJSON(action, body = {}) {
  const response = await fetch(location.href, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Node2Link-Action': action }, body: JSON.stringify(body), cache: 'no-store' });
  const data = await response.json(); if (!response.ok) throw new Error(data.message || '读取失败'); return data;
 }
 async function loadHistoryVersion() {
  const serial = ++historyRequest; el('originalHistoryMessage').className = 'main-help';
  historyVersion = null; el('restoreOriginalVersion').disabled = true; el('downloadOriginalVersion').disabled = true;
  el('originalHistoryContent').value = ''; el('originalHistoryMessage').textContent = '正在读取版本…';
  try {
   const selected = el('originalHistorySelect').value;
   const data = await historyRequestJSON('get-original-version', { revision: selected });
   if (serial !== historyRequest) return;
   historyVersion = { ...data, revision: selected };
   el('originalHistoryContent').value = originalText({ originals: data.originals });
   el('originalHistoryMessage').textContent = data.originals.length + ' 项原始节点 / 订阅源';
   el('restoreOriginalVersion').disabled = JSON.stringify(data.originals) === JSON.stringify(config.originals);
   el('downloadOriginalVersion').disabled = false;
  } catch (error) { if (serial === historyRequest) { el('originalHistoryMessage').className = 'main-error'; el('originalHistoryMessage').textContent = error.message; } }
 }
 el('originalHistorySelect').addEventListener('change', loadHistoryVersion);
 el('closeOriginalHistory').addEventListener('click', () => el('originalHistoryDialog').close());
 el('downloadOriginalVersion').addEventListener('click', () => { if (historyVersion) download(originalText({ originals: historyVersion.originals }), 'txt', 'originals-' + historyVersion.metadata.savedAt.replace(/[^0-9]/g, '')); });
 el('restoreOriginalVersion').addEventListener('click', async () => {
  const version = historyVersion; if (!version) return;
  if (!await askMainConfirm('将原始节点还原为所选版本并立即生效？当前优选配置保留，失效关联会清理。', '还原原始节点')) return;
  if (await publishOriginals(null, { historyRevision: version.revision })) el('originalHistoryDialog').close();
 });
 Object.assign(window, {
  saveContent,
  async openOriginalHistory() {
   ++historyRequest; el('originalHistoryMessage').className = 'main-help';
   el('originalHistorySelect').innerHTML = ''; el('originalHistoryContent').value = '';
   el('originalHistoryMessage').textContent = '正在读取历史版本…';
   historyVersion = null; el('restoreOriginalVersion').disabled = true; el('downloadOriginalVersion').disabled = true;
   el('originalHistoryDialog').showModal();
   try {
    const data = await historyRequestJSON('list-original-history');
    el('originalHistoryHelp').textContent = '最近 ' + data.limit + ' 个保存版本（包含最新版本），可在设置中调整。';
    el('originalHistorySelect').innerHTML = data.versions.map((version, index) => '<option value="' + esc(version.revision) + '">' + (index === 0 ? '最新 · ' : '') + esc(new Date(version.savedAt).toLocaleString()) + ' · ' + version.count + ' 项</option>').join('');
    if (data.versions.length) await loadHistoryVersion(); else el('originalHistoryMessage').textContent = '暂无保存版本';
   } catch (error) { el('originalHistoryMessage').textContent = error.message; }
  },
  openDedupePreview() {
   flush(); const lines = mainLines(textarea.value);
   el('previewBefore').textContent = lines.length; el('previewDuplicates').textContent = lines.length - new Set(lines).size; el('previewAfter').textContent = new Set(lines).size;
   el('applyDedupeButton').disabled = [...new Set(lines)].join('\n') === textarea.value; el('toolDialog').showModal();
  },
  closeToolDialog() { el('toolDialog').close(); },
  async applyDedupe() {
   const keep = new Map();
   config.originals.forEach(node => { if (!keep.has(node.content)) keep.set(node.content, node); });
   if (await publishOriginals([...keep.values()])) el('toolDialog').close();
  }
 });
 document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!document.querySelector('dialog[open]')) saveContent(); } });
 window.addEventListener('pagehide', flush);
 document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
 window.addEventListener('beforeunload', event => { flush(); if (saving || snapshot() !== saved || originalHasChanges() || endpointHasChanges() || el('batchDialog').open && el('batchValue').value.trim()) { event.preventDefault(); event.returnValue = ''; } });
 updateMetadata(pageData.savedMetadata); render(); updateSaveButton();
 syncText();
 {
  try {
   const draft = localStorage.getItem(draftKey);
   const draftConfig = draft ? parseDraft(draft) : null;
   if (draftConfig && snapshot(draftConfig) !== saved) {
    askMainConfirm('恢复本地优选草稿？原始节点以已生效列表为准；如旧草稿包含不同的原始节点，将下载为 TXT 供导入。', '恢复本地草稿').then(accepted => {
     if (!accepted) { localStorage.removeItem(draftKey); return; }
     try {
      if (JSON.stringify(draftConfig.originals) !== JSON.stringify(config.originals)) download(originalText(draftConfig), 'txt', 'recovered-originals');
      config.endpoints = reconcileMainEndpoints(draftConfig.endpoints, config.originals, draftConfig.originals); changed('已恢复优选草稿，尚未保存'); }
     catch (error) { showToast('草稿载入失败：' + error.message); }
    });
   } else if (draft) localStorage.removeItem(draftKey);
  } catch { /* No local draft support. */ }
 }
}
