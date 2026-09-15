import { extendMainNode, mainNodeName } from '../shared/main-subscription.js';
import { applyVariables } from '../shared/template-variables.js';
const pageData = JSON.parse(document.getElementById('page-data-generated-nodes').textContent);
let { settings, nodes, originals } = pageData;
const form = document.getElementById('settingsForm');
const tokenInput = document.getElementById('apiToken');
const nameInput = document.getElementById('nameTemplate');
const templateInput = document.getElementById('nodeTemplate');
const list = document.getElementById('nodeList');
const originalList = document.getElementById('templateOriginalList');
const searchInput = document.getElementById('templateSearch');
const selected = new Set((settings.sourceTemplates || []).map(node => node.id));
const message = document.getElementById('settingsMessage');
let busy = false;
function esc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function copyText(value) { return navigator.clipboard.writeText(value); }
function showMessage(text, error = false) { message.textContent = text; message.className = error ? 'message' : 'muted'; }
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
function renderPreview() {
 const byId = new Map(originals.map(node => [node.id, node]));
 const previews = [...selected].map(id => byId.get(id)).filter(node => node && !node.error).map(node => {
  try {
   const name = applyVariables(nameInput.value, { name: mainNodeName(node.content), address: 'edge.example.com', port: '443', type: '域名' }).trim().slice(0, 240);
   const content = extendMainNode(node.content, { address: 'edge.example.com', port: 443 }, name);
   return '<div class="example-box"><b>' + esc(name) + '</b><code>' + esc(content) + '</code></div>';
  } catch (error) { return '<p class="message">' + esc(error.message) + '</p>'; }
 });
 document.getElementById('templatePreview').innerHTML = previews.join('') || '<p class="muted">选择原始节点后显示生成预览。</p>';
}
function renderOriginals() {
 document.getElementById('templateCount').textContent = '已选 ' + selected.size + ' / 20';
 const missing = [...selected].filter(id => !originals.some(node => node.id === id));
 const visible = filteredOriginals();
 originalList.innerHTML = visible.map(node => '<label class="template-original' + (node.error ? ' unavailable' : '') + '"><input type="checkbox" data-template-id="' + esc(node.id) + '"' + (selected.has(node.id) ? ' checked' : '') + (node.error && !selected.has(node.id) ? ' disabled' : '') + '><span><strong>' + esc(node.name) + '</strong><small>' + esc(node.protocol + ' · ' + node.address) + (node.error ? ' · 无法生成模板：' + esc(node.error) : '') + '</small></span></label>').join('') + missing.map(id => {
  const snapshot = settings.sourceTemplates?.find(node => node.id === id);
  return '<label class="template-original unavailable"><input type="checkbox" data-template-id="' + esc(id) + '" checked><span><strong>' + esc(snapshot ? mainNodeName(snapshot.content) : id) + '</strong><small>原始节点已删除，请取消勾选后重新选择。</small></span></label>';
 }).join('');
 if (!visible.length && !missing.length) originalList.innerHTML = '<div class="empty-list">' + (originals.length ? '没有匹配的原始节点。' : '暂无已保存的原始节点，请先到主订阅添加。<a href="/">前往主订阅</a>') + '</div>';
 document.getElementById('selectTemplateResults').disabled = busy || !visible.some(node => !node.error);
 document.getElementById('clearTemplateSelection').disabled = busy || !selected.size;
 document.getElementById('legacyTemplateSection').hidden = !settings.nodeTemplate;
 renderPreview();
}
function selectionChanged() {
 document.getElementById('templateSelectionMessage').textContent = '';
 showMessage('选择已修改，尚未保存'); renderOriginals();
}
originalList.addEventListener('change', event => {
 const checkbox = event.target.closest('[data-template-id]');
 if (!checkbox) return;
 if (checkbox.checked && selected.size >= 20) { checkbox.checked = false; document.getElementById('templateSelectionMessage').textContent = '最多选择 20 个原始节点'; return; }
 if (checkbox.checked) selected.add(checkbox.dataset.templateId); else selected.delete(checkbox.dataset.templateId);
 selectionChanged();
});
searchInput.addEventListener('input', renderOriginals);
nameInput.addEventListener('input', () => { renderPreview(); showMessage('名称格式已修改，尚未保存'); });
document.getElementById('selectTemplateResults').addEventListener('click', () => {
 const ids = new Set([...selected, ...filteredOriginals().filter(node => !node.error).map(node => node.id)]);
 if (ids.size > 20) { document.getElementById('templateSelectionMessage').textContent = '当前结果超过 20 个，请缩小搜索范围后再选择'; return; }
 ids.forEach(id => selected.add(id)); selectionChanged();
});
document.getElementById('clearTemplateSelection').addEventListener('click', () => { selected.clear(); selectionChanged(); });
document.getElementById('reloadTemplateOriginals').addEventListener('click', async function() {
 this.disabled = true;
 try { const data = await apiCall('GET'); originals = data.originals; renderOriginals(); showMessage('原始节点已刷新，保存后更新 API 模板'); }
 catch (error) { showMessage(error.message, true); }
 finally { this.disabled = false; }
});
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
 form.querySelectorAll('input, textarea, button').forEach(control => { control.disabled = value; });
 renderOriginals();
 if (value) originalList.querySelectorAll('input').forEach(control => { control.disabled = true; });
}
form.addEventListener('submit', async event => {
 event.preventDefault();
 if (busy) return;
 if (!selected.size && !settings.nodeTemplate) { showMessage('请至少选择一个原始节点', true); return; }
 const payload = { token: tokenInput.value, nameTemplate: nameInput.value, ...(selected.size ? { originalIds: [...selected] } : { nodeTemplate: settings.nodeTemplate }) };
 setBusy(true); showMessage('正在保存…');
 try {
  const data = await apiCall('PUT', payload); settings = data.settings;
  tokenInput.value = settings.token; nameInput.value = settings.nameTemplate; templateInput.value = settings.nodeTemplate;
  syncExamples(); showMessage('配置已保存'); message.className = 'success';
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
templateInput.value = settings.nodeTemplate;
syncExamples(); renderNodes(); renderOriginals();
if (!settings.token) {
 setBusy(true);
 apiCall('POST', { action: 'initialize' }).then(data => {
  settings = data.settings; tokenInput.value = settings.token; syncExamples(); setBusy(false);
 }).catch(error => showMessage(error.message + '，请刷新页面重试', true));
}