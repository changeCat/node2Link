import { DEFAULT_API_PORT, MAX_API_TEMPLATES, optionalTemplatePort, normalizeTemplateReferences } from '../shared/api-templates.js';
import { extendMainNode, mainNodeName } from '../shared/main-subscription.js';
import { applyVariables } from '../shared/template-variables.js';
const pageData = JSON.parse(document.getElementById('page-data-generated-nodes').textContent);
let { settings, nodes, originals } = pageData;
const form = document.getElementById('settingsForm');
const tokenInput = document.getElementById('apiToken');
const nameInput = document.getElementById('nameTemplate');
const templateList = document.getElementById('templateList');
const pickerDialog = document.getElementById('templatePickerDialog');
const pending = new Map();
let templates = normalizeTemplateReferences(settings.sourceTemplates || []);
let pickerLoading = false;
let loadingOriginals = null;
const list = document.getElementById('nodeList');
const originalList = document.getElementById('templateOriginalList');
const searchInput = document.getElementById('templateSearch');
const message = document.getElementById('settingsMessage');
let busy = false;
function esc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function copyText(value) { return navigator.clipboard.writeText(value); }
function showMessage(text, error = false) { message.textContent = text; message.className = 'api-save-state ' + (error ? 'message' : 'muted'); }
function askConfirm(text, title) {
 return new Promise(resolve => {
  const dialog = document.getElementById('confirmDialog');
  const accept = document.getElementById('confirmAccept'), cancel = document.getElementById('confirmCancel');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmText').textContent = text;
  function finish(value) { dialog.close(); dialog.oncancel = null; accept.onclick = null; cancel.onclick = null; resolve(value); }
  accept.onclick = () => finish(true); cancel.onclick = () => finish(false);
  dialog.oncancel = event => { event.preventDefault(); finish(false); };
  dialog.showModal();
 });
}
function randomToken() {
 const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function syncExamples() {
 const endpoint = window.location.origin + '/api/import';
 document.getElementById('addressExample').textContent = endpoint + '?token=' + encodeURIComponent(tokenInput.value) + '&address={{address1}}&port={{port1}}&address={{address2}}&port={{port2}}';
 document.getElementById('directExample').textContent = 'curl -X POST "' + endpoint + '" -H "X-API-Token: ' + tokenInput.value + '" -H "Content-Type: text/plain;charset=UTF-8" --data-binary "{{node1}}\n{{node2}}"';
}
function renderNodes() {
 document.getElementById('nodeCount').textContent = nodes.length + ' 个';
 list.innerHTML = nodes.length ? nodes.map(node => '<article class="node-card"><div class="node-main"><div class="node-head"><span class="node-kind">' + (node.kind === 'raw' ? '完整节点' : '模板生成') + '</span><strong title="' + esc(node.name) + '">' + esc(node.name) + '</strong></div><div class="node-meta">' + (node.address ? esc(node.address) + (node.port ? ':' + node.port : '') : '完整节点') + ' · ' + new Date(node.createdAt).toLocaleString() + '</div><div class="node-content" title="' + esc(node.content) + '">' + esc(node.content) + '</div></div><div class="node-actions"><button class="button" type="button" data-copy-node="' + node.id + '">复制</button><button class="button danger-button" type="button" data-delete="' + node.id + '">删除</button></div></article>').join('') : '<div class="empty-list">尚无节点。请通过 GET 地址接口或 POST 完整节点接口从外部追加。</div>';
}
async function apiCall(method, body) {
 const response = await fetch('/api/generated-nodes', { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
 const data = await response.json();
 if (!response.ok) throw new Error(data.message || '操作失败');
 return data;
}
function filteredOriginals() {
 const query = searchInput.value.trim().toLowerCase();
 return originals.filter(node => !query || (node.name + '\n' + node.protocol + '\n' + node.address).toLowerCase().includes(query));
}
function renderTemplates() {
 const byId = new Map(originals.map(node => [node.id, node]));
 const query = document.getElementById('savedTemplateSearch').value.trim().toLowerCase();
 document.getElementById('templateCount').textContent = templates.length + ' / 20';
 document.getElementById('addTemplate').disabled = busy || templates.length >= MAX_API_TEMPLATES;
 templateList.innerHTML = templates.filter(template => {
  const node = byId.get(template.id);
  return !query || ((node?.name || template.id) + '\n' + (node?.protocol || '') + '\n' + (node?.address || '')).toLowerCase().includes(query);
 }).map(template => {
  const node = byId.get(template.id);
  const error = !node ? '原始节点已删除，请移除此模板。' : node.error;
  const id = esc(template.id);
  return '<article class="api-template-card" data-saved-template="' + id + '"><div class="api-template-heading"><strong title="' + esc(node?.name || template.id) + '">' + esc(node?.name || '原始节点已删除') + '</strong><span class="node-kind">' + esc(node?.protocol || '失效') + '</span></div><small>' + esc(node?.address || template.id) + '</small>' + (error ? '<p class="message">' + esc(error) + '</p>' : '') + '<div class="api-port-field"><label for="port-' + id + '">指定端口</label><input id="port-' + id + '" data-template-port="' + id + '" type="number" min="1" max="65535" step="1" placeholder="可选，跟随 API" value="' + esc(template.port ?? '') + '"' + (busy ? ' disabled' : '') + '></div><div class="api-actions"><button class="button" type="button" data-preview-template="' + id + '"' + (error || busy ? ' disabled' : '') + '>预览</button><button class="button danger-button" type="button" data-remove-template="' + id + '"' + (busy ? ' disabled' : '') + '>移除</button></div></article>';
 }).join('') || '<div class="empty-list">' + (templates.length ? '没有匹配的模板。' : '尚无模板，点击“添加模板”从原始节点中选择。') + '</div>';
}
function markChanged() { showMessage('配置已修改，尚未保存'); }
function renderOriginals() {
 const existing = new Set(templates.map(node => node.id));
 const visible = filteredOriginals();
 document.getElementById('pendingTemplateCount').textContent = '已选择 ' + pending.size + ' 个';
 document.getElementById('confirmAddTemplates').disabled = pickerLoading || !pending.size;
 document.getElementById('selectTemplateResults').disabled = pickerLoading || !visible.some(node => !node.error && !existing.has(node.id));
 if (pickerLoading) { originalList.innerHTML = '<p class="muted">正在读取原始节点…</p>'; return; }
 originalList.innerHTML = visible.map(node => {
  const unavailable = existing.has(node.id) || Boolean(node.error);
  const id = esc(node.id);
  return '<div class="template-choice' + (unavailable ? ' unavailable' : '') + '"><label class="template-original"><input type="checkbox" data-template-id="' + id + '"' + (pending.has(node.id) ? ' checked' : '') + (unavailable ? ' disabled' : '') + '><span><strong>' + esc(node.name) + (existing.has(node.id) ? ' · 已添加' : '') + '</strong><small>' + esc(node.protocol + ' · ' + node.address) + (node.error ? ' · ' + esc(node.error) : '') + '</small></span></label>' + (pending.has(node.id) ? '<div class="api-port-field"><label for="pending-port-' + id + '">指定端口</label><input id="pending-port-' + id + '" data-pending-port="' + id + '" type="number" min="1" max="65535" step="1" placeholder="可选，跟随 API" value="' + esc(pending.get(node.id)) + '"></div>' : '') + '</div>';
 }).join('') || '<div class="empty-list">' + (originals.length ? '没有匹配的原始节点。' : '暂无已保存的原始节点，请先到主订阅添加。<a href="/">前往主订阅</a>') + '</div>';
}
function refreshOriginals() {
 if (loadingOriginals) return loadingOriginals;
 loadingOriginals = apiCall('GET').then(data => {
  originals = data.originals;
  renderTemplates();
 }).finally(() => { loadingOriginals = null; });
 return loadingOriginals;
}
async function loadPicker() {
 pickerLoading = true;
 document.getElementById('retryTemplateOriginals').hidden = true;
 document.getElementById('templateSelectionMessage').textContent = '';
 renderOriginals();
 try { await refreshOriginals(); pickerLoading = false; renderOriginals(); }
 catch (error) {
  // Keep adding disabled until fresh candidates are available.
  originalList.innerHTML = '';
  document.getElementById('templateSelectionMessage').textContent = error.message;
  document.getElementById('retryTemplateOriginals').hidden = false;
 }
}
document.getElementById('addTemplate').addEventListener('click', () => {
 pending.clear(); searchInput.value = ''; pickerDialog.showModal(); searchInput.focus(); loadPicker();
});
function closePicker() { pickerDialog.close(); }
document.getElementById('closeTemplatePicker').addEventListener('click', closePicker);
document.getElementById('cancelTemplatePicker').addEventListener('click', closePicker);
pickerDialog.addEventListener('click', event => { if (event.target === pickerDialog) closePicker(); });
document.getElementById('retryTemplateOriginals').addEventListener('click', loadPicker);
searchInput.addEventListener('input', renderOriginals);
document.getElementById('savedTemplateSearch').addEventListener('input', renderTemplates);
originalList.addEventListener('change', event => {
 const checkbox = event.target.closest('[data-template-id]');
 if (!checkbox) return;
 if (checkbox.checked && pending.size + templates.length >= MAX_API_TEMPLATES) {
  checkbox.checked = false; document.getElementById('templateSelectionMessage').textContent = '最多添加 20 个模板'; return;
 }
 if (checkbox.checked) pending.set(checkbox.dataset.templateId, ''); else pending.delete(checkbox.dataset.templateId);
 document.getElementById('templateSelectionMessage').textContent = '';
 renderOriginals();
});
originalList.addEventListener('input', event => {
 const input = event.target.closest('[data-pending-port]');
 if (input) pending.set(input.dataset.pendingPort, input.value);
});
document.getElementById('selectTemplateResults').addEventListener('click', () => {
 const existing = new Set(templates.map(node => node.id));
 const ids = new Set([...pending.keys(), ...filteredOriginals().filter(node => !node.error && !existing.has(node.id)).map(node => node.id)]);
 if (ids.size + templates.length > MAX_API_TEMPLATES) { document.getElementById('templateSelectionMessage').textContent = '当前结果超过可添加数量，请缩小搜索范围'; return; }
 ids.forEach(id => { if (!pending.has(id)) pending.set(id, ''); });
 renderOriginals();
});
document.getElementById('templatePickerForm').addEventListener('submit', event => {
 event.preventDefault();
 if (pickerLoading || !pending.size) return;
 try {
  const added = normalizeTemplateReferences([...pending].map(([id, port]) => ({ id, port })));
  normalizeTemplateReferences([...templates, ...added]);
  templates.push(...added);
  closePicker(); renderTemplates(); markChanged();
 } catch (error) { document.getElementById('templateSelectionMessage').textContent = error.message; }
});
templateList.addEventListener('input', event => {
 const input = event.target.closest('[data-template-port]');
 if (!input) return;
 templates.find(node => node.id === input.dataset.templatePort).port = input.value;
 markChanged();
});
templateList.addEventListener('click', event => {
 const remove = event.target.closest('[data-remove-template]');
 if (remove) { templates = templates.filter(node => node.id !== remove.dataset.removeTemplate); renderTemplates(); markChanged(); return; }
 const preview = event.target.closest('[data-preview-template]');
 if (!preview) return;
 try {
  const template = templates.find(node => node.id === preview.dataset.previewTemplate);
  const original = originals.find(node => node.id === template.id);
  const port = optionalTemplatePort(template.port) ?? DEFAULT_API_PORT;
  const name = applyVariables(nameInput.value, { name: mainNodeName(original.content), address: 'edge.example.com', port: String(port), type: '域名' }).trim().slice(0, 240);
  document.getElementById('templatePreviewName').textContent = name;
  document.getElementById('templatePreview').value = extendMainNode(original.content, { address: 'edge.example.com', port }, name);
  document.getElementById('templatePreviewDialog').showModal();
 } catch (error) { showMessage(error.message, true); }
});
document.getElementById('closeTemplatePreview').addEventListener('click', () => document.getElementById('templatePreviewDialog').close());
nameInput.addEventListener('input', markChanged);
// Refresh displayed original names/content when returning from the main editor; keep unsaved template edits.
window.addEventListener('focus', () => { if (!busy && !pickerDialog.open) refreshOriginals().catch(error => showMessage(error.message, true)); });
async function copyFeedback(button, text) {
 try { await copyText(text); const previous = button.textContent; button.textContent = '已复制'; setTimeout(() => { button.textContent = previous; }, 1200); }
 catch { showMessage('复制失败，请手动复制', true); }
}
document.getElementById('copyToken').addEventListener('click', function() { copyFeedback(this, tokenInput.value); });
document.getElementById('resetToken').addEventListener('click', async () => {
 if (!await askConfirm('保存重置后的 Token 后，旧 Token 和旧调用 URL 会立即失效。', '重置 API Token')) return;
 tokenInput.value = randomToken(); syncExamples(); showMessage('Token 已重置，尚未保存');
});
document.querySelectorAll('[data-copy-example]').forEach(button => button.addEventListener('click', () => copyFeedback(button, document.getElementById(button.dataset.copyExample).textContent)));
function setBusy(value) {
 busy = value;
 form.querySelectorAll('input, button').forEach(control => { control.disabled = value; });
 renderTemplates();
}
form.addEventListener('submit', async event => {
 event.preventDefault();
 if (busy) return;
 let selection;
 try { selection = normalizeTemplateReferences(templates); }
 catch (error) { showMessage(error.message, true); return; }
 setBusy(true); showMessage('正在保存…');
 try {
  const data = await apiCall('PUT', { token: tokenInput.value, nameTemplate: nameInput.value, templates: selection });
  settings = data.settings; templates = normalizeTemplateReferences(settings.sourceTemplates || []);
  tokenInput.value = settings.token; nameInput.value = settings.nameTemplate;
  syncExamples(); showMessage('配置已保存'); message.className = 'success api-save-state';
 } catch (error) { showMessage(error.message, true); }
 finally { setBusy(false); }
});
list.addEventListener('click', async event => {
 const copy = event.target.closest('[data-copy-node]');
 if (copy) { const node = nodes.find(node => node.id === copy.dataset.copyNode); if (node) copyFeedback(copy, node.content); return; }
 const button = event.target.closest('[data-delete]');
 if (!button || !await askConfirm('删除后，该节点也会从主订阅的动态附加结果中消失。', '删除 API 节点')) return;
 button.disabled = true;
 try { await apiCall('DELETE', { id: button.dataset.delete }); nodes = nodes.filter(node => node.id !== button.dataset.delete); renderNodes(); }
 catch (error) { button.disabled = false; showMessage(error.message, true); }
});
tokenInput.value = settings.token;
nameInput.value = !settings.nodeTemplate && !settings.sourceTemplates ? '{{name}}-{{type}}-{{address}}:{{port}}' : settings.nameTemplate;
syncExamples(); renderNodes(); renderTemplates();
if (!settings.token) {
 setBusy(true);
 apiCall('POST', { action: 'initialize' }).then(data => {
  settings = data.settings; tokenInput.value = settings.token; syncExamples(); setBusy(false);
 }).catch(error => showMessage(error.message + '，请刷新页面重试', true));
}