import { DEFAULT_API_PORT, MAX_API_TEMPLATES, optionalTemplatePort, normalizeTemplateReferences } from '../shared/api-templates.js';
import { extendMainNode, mainNodeName, MAIN_HTTPS_PORTS, MAIN_HTTP_PORTS } from '../shared/main-subscription.js';
import { applyVariables } from '../shared/template-variables.js';
const pageData = JSON.parse(document.getElementById('page-data-generated-nodes').textContent);
let { settings, nodes, originals } = pageData;
const form = document.getElementById('settingsForm');
const apiSettingsForm = document.getElementById('apiSettingsForm');
const apiSettingsMessage = document.getElementById('apiSettingsMessage');
const tokenInput = document.getElementById('apiToken');
const nameInput = document.getElementById('nameTemplate');
const templateList = document.getElementById('templateList');
const pickerDialog = document.getElementById('templatePickerDialog');
const pending = new Map();
let pickerStep = 1;
let editingTemplateId = null;
let bulkPort = portDraft(null);
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
function showAPIMessage(text, error = false) { apiSettingsMessage.textContent = text; apiSettingsMessage.className = 'api-save-state ' + (error ? 'message' : 'muted'); }
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
 list.innerHTML = nodes.length ? nodes.map(node => '<article class="node-card"><div class="node-main"><div class="node-head"><span class="node-kind">' + (node.kind === 'raw' ? '完整节点' : '模板生成') + '</span><strong title="' + esc(node.name) + '">' + esc(node.name) + '</strong></div><div class="node-meta">' + (node.address ? esc(node.address) + (node.port ? ':' + node.port : '') : '完整节点') + ' · ' + new Date(node.createdAt).toLocaleString() + '</div></div><div class="node-footer"><div class="node-content" title="' + esc(node.content) + '">' + esc(node.content) + '</div><div class="node-actions"><button class="button" type="button" data-copy-node="' + node.id + '">复制</button><button class="button danger-button" type="button" data-delete="' + node.id + '">删除</button></div></div></article>').join('') : '<div class="empty-list">尚无节点。请通过 GET 地址接口或 POST 完整节点接口从外部追加。</div>';
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
  return '<article class="api-template-card" data-saved-template="' + id + '"><div class="api-template-heading"><strong title="' + esc(node?.name || template.id) + '">' + esc(node?.name || '原始节点已删除') + '</strong><span class="node-kind">' + esc(node?.protocol || '失效') + '</span></div><small>' + esc(node?.address || template.id) + '</small>' + (error ? '<p class="message">' + esc(error) + '</p>' : '') + '<div class="api-template-footer"><div class="api-template-port-status">端口 <strong data-template-port-status="' + id + '">' + (template.port === null ? '跟随 API' : esc(template.port)) + '</strong></div><div class="api-actions"><button class="button" type="button" data-edit-template="' + id + '"' + (error || busy ? ' disabled' : '') + '>编辑</button><button class="button" type="button" data-preview-template="' + id + '"' + (error || busy ? ' disabled' : '') + '>预览</button><button class="button danger-button" type="button" data-remove-template="' + id + '"' + (busy ? ' disabled' : '') + '>移除</button></div></div></article>';
 }).join('') || '<div class="empty-list">' + (templates.length ? '没有匹配的模板。' : '尚无模板，点击“添加模板”从原始节点中选择。') + '</div>';
}
function markChanged() { showMessage('模板已修改，尚未保存'); }
function renderOriginals() {
 const existing = new Set(templates.map(node => node.id));
 const visible = filteredOriginals();
 document.getElementById('pendingTemplateCount').textContent = '已选择 ' + pending.size + ' 个';
 document.getElementById('nextTemplateStep').disabled = pickerLoading || !pending.size;
 document.getElementById('selectTemplateResults').disabled = pickerLoading || !visible.some(node => !node.error && !existing.has(node.id));
 if (pickerLoading) { originalList.innerHTML = '<p class="muted">正在读取原始节点…</p>'; return; }
 originalList.innerHTML = visible.map(node => {
  const unavailable = existing.has(node.id) || Boolean(node.error);
  const id = esc(node.id);
  return '<div class="template-choice' + (unavailable ? ' unavailable' : '') + '"><label class="template-original"><input type="checkbox" data-template-id="' + id + '"' + (pending.has(node.id) ? ' checked' : '') + (unavailable ? ' disabled' : '') + '><span><strong>' + esc(node.name) + (existing.has(node.id) ? ' · 已添加' : '') + '</strong><small>' + esc(node.protocol + ' · ' + node.address) + (node.error ? ' · ' + esc(node.error) : '') + '</small></span></label></div>';
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
 pending.clear(); editingTemplateId = null; bulkPort = portDraft(null); searchInput.value = '';
 document.getElementById('templatePickerTitle').textContent = '添加节点模板';
 document.getElementById('templateWizardSteps').hidden = false;
 document.getElementById('confirmAddTemplates').textContent = '添加模板';
 setPickerStep(1); pickerDialog.showModal(); searchInput.focus(); loadPicker();
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
 if (checkbox.checked) pending.set(checkbox.dataset.templateId, portDraft(null)); else pending.delete(checkbox.dataset.templateId);
 document.getElementById('templateSelectionMessage').textContent = '';
 renderOriginals();
});
document.getElementById('selectTemplateResults').addEventListener('click', () => {
 const existing = new Set(templates.map(node => node.id));
 const ids = new Set([...pending.keys(), ...filteredOriginals().filter(node => !node.error && !existing.has(node.id)).map(node => node.id)]);
 if (ids.size + templates.length > MAX_API_TEMPLATES) { document.getElementById('templateSelectionMessage').textContent = '当前结果超过可添加数量，请缩小搜索范围'; return; }
 ids.forEach(id => { if (!pending.has(id)) pending.set(id, portDraft(null)); });
 renderOriginals();
});
function portDraft(port) {
 const preset = port === null ? '' : [...MAIN_HTTPS_PORTS, ...MAIN_HTTP_PORTS].includes(Number(port)) ? String(port) : 'custom';
 return { preset, custom: preset === 'custom' ? String(port) : '' };
}
function portValue(draft) {
 if (draft.preset === 'custom') {
  if (!draft.custom.trim()) throw new Error('请输入自定义端口，或选择“跟随 API”');
  return optionalTemplatePort(draft.custom);
 }
 return optionalTemplatePort(draft.preset);
}
function portSelector(key, draft) {
 const groups = (ports, label) => '<optgroup label="' + label + '">' + ports.map(port => '<option value="' + port + '"' + (String(port) === draft.preset ? ' selected' : '') + '>' + port + '</option>').join('') + '</optgroup>';
 return '<div class="api-port-control" data-api-port-key="' + esc(key) + '"><label for="preset-' + esc(key) + '">端口</label><select id="preset-' + esc(key) + '" data-api-port-preset aria-label="端口"><option value=""' + (!draft.preset ? ' selected' : '') + '>跟随 API</option>' + groups(MAIN_HTTPS_PORTS, 'Cloudflare HTTPS') + groups(MAIN_HTTP_PORTS, 'Cloudflare HTTP') + '<option value="custom"' + (draft.preset === 'custom' ? ' selected' : '') + '>自定义</option></select><input data-api-port-custom aria-label="自定义端口" type="number" min="1" max="65535" step="1" placeholder="1–65535" value="' + esc(draft.custom) + '"' + (draft.preset === 'custom' ? ' required' : ' hidden disabled') + '></div>';
}
function renderPortReview() {
 const originalsById = new Map(originals.map(node => [node.id, node]));
 document.getElementById('bulkTemplatePort').innerHTML = portSelector('bulk:port', bulkPort);
 document.getElementById('templateBulkPort').hidden = editingTemplateId !== null || pending.size < 2;
 document.getElementById('templatePortReview').innerHTML = [...pending].map(([id, draft]) => {
  const original = originalsById.get(id);
  return '<div class="api-port-review-row" data-review-template="' + esc(id) + '"><div><strong>' + esc(original?.name || id) + '</strong><small>' + esc(original ? original.protocol + ' · ' + original.address : '原始节点已不存在') + '</small></div>' + portSelector(id, draft) + '</div>';
 }).join('');
}
function setPickerStep(step) {
 pickerStep = step;
 const selecting = step === 1;
 for (const [id, active] of [['templateSelectStep', selecting], ['templatePortStep', !selecting]]) {
  const fieldset = document.getElementById(id); fieldset.hidden = !active; fieldset.disabled = !active;
 }
 document.getElementById('templateSelectStepLabel').setAttribute('aria-current', selecting ? 'step' : 'false');
 document.getElementById('templatePortStepLabel').setAttribute('aria-current', selecting ? 'false' : 'step');
 document.getElementById('previousTemplateStep').hidden = selecting || editingTemplateId !== null;
 document.getElementById('nextTemplateStep').hidden = !selecting;
 document.getElementById('confirmAddTemplates').hidden = selecting;
 document.getElementById('templateSelectionMessage').textContent = '';
 document.getElementById('pendingTemplateCount').textContent = editingTemplateId === null ? '已选择 ' + pending.size + ' 个' : '修改后需保存模板';
 if (!selecting) renderPortReview();
}
function nextPickerStep() {
 if (pickerLoading || !pending.size) return;
 setPickerStep(2);
 document.getElementById('templatePortReview').querySelector('select')?.focus();
}
document.getElementById('nextTemplateStep').addEventListener('click', nextPickerStep);
document.getElementById('previousTemplateStep').addEventListener('click', () => { setPickerStep(1); renderOriginals(); searchInput.focus(); });
pickerDialog.addEventListener('change', event => {
 const select = event.target.closest('[data-api-port-preset]');
 if (!select) return;
 const control = select.closest('[data-api-port-key]');
 const draft = control.dataset.apiPortKey === 'bulk:port' ? bulkPort : pending.get(control.dataset.apiPortKey);
 draft.preset = select.value;
 document.getElementById('templateSelectionMessage').textContent = '';
 const input = control.querySelector('[data-api-port-custom]');
 input.hidden = input.disabled = select.value !== 'custom'; input.required = !input.hidden;
 if (!input.hidden) input.focus();
});
pickerDialog.addEventListener('input', event => {
 const input = event.target.closest('[data-api-port-custom]');
 if (!input) return;
 const key = input.closest('[data-api-port-key]').dataset.apiPortKey;
 (key === 'bulk:port' ? bulkPort : pending.get(key)).custom = input.value;
 document.getElementById('templateSelectionMessage').textContent = '';
});
document.getElementById('applyBulkTemplatePort').addEventListener('click', () => {
 try {
  const port = portValue(bulkPort);
  for (const id of pending.keys()) pending.set(id, portDraft(port));
  renderPortReview(); document.getElementById('templateSelectionMessage').textContent = '已应用到全部 ' + pending.size + ' 个模板';
 } catch (error) { document.getElementById('templateSelectionMessage').textContent = error.message; }
});
document.getElementById('templatePickerForm').addEventListener('submit', event => {
 event.preventDefault();
 if (pickerStep === 1) { nextPickerStep(); return; }
 if (pickerLoading || !pending.size) return;
 try {
  const added = normalizeTemplateReferences([...pending].map(([id, draft]) => ({ id, port: portValue(draft) })));
  const next = editingTemplateId === null ? [...templates, ...added] : templates.map(template => template.id === editingTemplateId ? added[0] : template);
  templates = normalizeTemplateReferences(next);
  closePicker(); renderTemplates(); markChanged();
 } catch (error) { document.getElementById('templateSelectionMessage').textContent = error.message; }
});
templateList.addEventListener('click', event => {
 const edit = event.target.closest('[data-edit-template]');
 if (edit) {
  const template = templates.find(node => node.id === edit.dataset.editTemplate);
  editingTemplateId = template.id; pending.clear(); pending.set(template.id, portDraft(template.port));
  pickerLoading = false;
  document.getElementById('templatePickerTitle').textContent = '编辑模板端口';
  document.getElementById('templateWizardSteps').hidden = true;
  document.getElementById('retryTemplateOriginals').hidden = true;
  document.getElementById('confirmAddTemplates').textContent = '应用修改';
  setPickerStep(2); pickerDialog.showModal();
  document.getElementById('templatePortReview').querySelector('select')?.focus();
  return;
 }
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
nameInput.addEventListener('input', () => showAPIMessage('API 配置已修改，尚未保存'));
// Refresh displayed original names/content when returning from the main editor; keep unsaved template edits.
window.addEventListener('focus', () => { if (!busy && !pickerDialog.open) refreshOriginals().catch(error => showMessage(error.message, true)); });
async function copyFeedback(button, text, reportError = showMessage) {
 try { await copyText(text); const previous = button.textContent; button.textContent = '已复制'; setTimeout(() => { button.textContent = previous; }, 1200); }
 catch { reportError('复制失败，请手动复制', true); }
}
document.getElementById('copyToken').addEventListener('click', function() { copyFeedback(this, tokenInput.value, showAPIMessage); });
document.getElementById('resetToken').addEventListener('click', async () => {
 if (!await askConfirm('保存重置后的 Token 后，旧 Token 和旧调用 URL 会立即失效。', '重置 API Token')) return;
 tokenInput.value = randomToken(); syncExamples(); showAPIMessage('Token 已重置，尚未保存');
});
document.querySelectorAll('[data-copy-example]').forEach(button => button.addEventListener('click', () => copyFeedback(button, document.getElementById(button.dataset.copyExample).textContent, showAPIMessage)));
function setBusy(value) {
 busy = value;
 for (const section of [form, apiSettingsForm]) section.querySelectorAll('input, button').forEach(control => { control.disabled = value; });
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
  const data = await apiCall('PUT', { templates: selection });
  settings = data.settings; templates = normalizeTemplateReferences(settings.sourceTemplates || []);
  showMessage('模板已保存'); message.className = 'success api-save-state';
 } catch (error) { showMessage(error.message, true); }
 finally { setBusy(false); }
});
apiSettingsForm.addEventListener('submit', async event => {
 event.preventDefault();
 if (busy) return;
 const payload = { token: tokenInput.value, nameTemplate: nameInput.value };
 setBusy(true); showAPIMessage('正在保存…');
 try {
  const data = await apiCall('PUT', payload);
  settings = data.settings;
  tokenInput.value = settings.token; nameInput.value = settings.nameTemplate;
  syncExamples(); showAPIMessage('API 配置已保存'); apiSettingsMessage.className = 'success api-save-state';
 } catch (error) { showAPIMessage(error.message, true); }
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
nameInput.value = settings.nameTemplate;
syncExamples(); renderNodes(); renderTemplates();
if (!settings.token) {
 setBusy(true);
 apiCall('POST', { action: 'initialize' }).then(data => {
  settings = data.settings; tokenInput.value = settings.token; syncExamples(); setBusy(false);
 }).catch(error => showAPIMessage(error.message + '，请刷新页面重试', true));
}