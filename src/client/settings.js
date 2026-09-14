const pageData = JSON.parse(document.getElementById('page-data-settings').textContent);
const initial = pageData.initial, defaultIcon = pageData.defaultIcon;
const byId = id => document.getElementById(id);
const nameInput = byId('subscriptionName'), pageTitleInput = byId('pageTitle'), iconInput = byId('browserIconURL');
const iconPreview = byId('iconPreview'), tokenInput = byId('subscriptionToken');
let profiles = structuredClone(initial.customConverters || []), activeId = initial.activeCustomConverterId || '';
let savedMode = initial.converterMode, savedActiveId = activeId, selectedMode = savedMode, savingConversion = false;
const selectionChanged = () => selectedMode !== savedMode || activeId !== savedActiveId;
function selectionMessage() { byId('conversionMessage').textContent = selectionChanged() ? '转换选择尚未保存，请点击保存生效' : '已保存'; byId('conversionMessage').className = 'muted'; }
nameInput.value = initial.subscriptionName;
pageTitleInput.value = initial.pageTitle;
iconInput.value = initial.browserIconURL || '';
tokenInput.value = initial.subscriptionToken || '';
document.querySelector('input[name="converterMode"][value="' + initial.converterMode + '"]').checked = true;
function esc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const typeLabel = type => type === 'sublink' ? 'Sublink Worker' : 'Subconverter';
function refreshIcon() { iconPreview.src = iconInput.value.trim() || defaultIcon; }
function syncModes() {
 const custom = savedMode === 'custom';
 document.querySelector('input[name="converterMode"][value="' + selectedMode + '"]').checked = true;
 const active = profiles.find(item => item.id === savedActiveId);
 byId('activeConverterMode').textContent = custom ? '自建 ' + typeLabel(active?.type) : '默认 Subconverter';
 byId('activeConverterValue').textContent = custom ? ((active?.url || '请选择并填写自定义服务') + ' → 失败回退默认') : initial.defaultConverterURLs.join(' → ');
 document.querySelectorAll('.converter-profile').forEach(card => card.classList.toggle('is-active', selectedMode === 'custom' && card.dataset.id === activeId));
 byId('addConverter').disabled = profiles.length >= 10;
 byId('converterCount').textContent = profiles.length + ' / 10';
 byId('saveConverterSelection').disabled = savingConversion || !selectionChanged();
}
function serviceHost(url) { try { return new URL(url).host; } catch { return '地址无效'; } }
async function saveConversion(next, message = byId('conversionMessage'), commitSelection = false) {
 if (savingConversion) return false;
 const preserveSelection = selectionChanged();
 savingConversion = true;
 syncModes();
 document.querySelectorAll('#conversionForm input, #conversionForm button, #converterEditorForm input, #converterEditorForm select, #converterEditorForm button').forEach(el => { el.disabled = true; });
 message.textContent = '正在保存…'; message.className = 'muted';
 try {
  const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'conversion', converterMode: savedMode, customConverters: profiles, activeCustomConverterId: savedActiveId, ...next }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '保存失败');
  profiles = data.settings.customConverters;
  savedActiveId = data.settings.activeCustomConverterId;
  savedMode = data.settings.converterMode;
  if (commitSelection || !preserveSelection) { activeId = savedActiveId; selectedMode = savedMode; }
  else if (!profiles.some(item => item.id === activeId)) activeId = savedActiveId || (selectedMode === 'custom' ? profiles[0]?.id || '' : '');
  message.textContent = '';
  byId('conversionMessage').textContent = selectionChanged() ? '列表已保存；转换选择尚未保存，请点击保存生效' : '已保存';
  byId('conversionMessage').className = 'success';
  return true;
 } catch (error) {
  message.textContent = error.message; message.className = 'message';
  return false;
 } finally {
  savingConversion = false;
  document.querySelectorAll('#conversionForm input, #conversionForm button, #converterEditorForm input, #converterEditorForm select, #converterEditorForm button').forEach(el => { el.disabled = false; });
  renderProfiles();
 }
}
function renderProfiles() {
 byId('customConverterList').innerHTML = profiles.length ? profiles.map(item => {
  const id = esc(item.id), name = esc(item.name || '自建转换');
  return '<div class="converter-profile" data-id="' + id + '" role="listitem"><input type="radio" name="activeCustomConverter" aria-label="启用 ' + name + '" value="' + id + '" ' + (item.id === activeId ? 'checked' : '') + '><div class="converter-summary"><strong title="' + name + '">' + name + '</strong><small>' + esc(typeLabel(item.type)) + ' · ' + esc(serviceHost(item.url)) + '</small></div><div class="converter-actions"><button class="button" type="button" data-edit="' + id + '" aria-label="编辑 ' + name + '">编辑</button><button class="button" type="button" data-remove="' + id + '" aria-label="删除 ' + name + '">删除</button></div></div>';
 }).join('') : '<p class="converter-empty">尚未添加自定义转换服务，点击上方按钮添加。</p>';
 syncModes();
}
const converterDialog = byId('converterDialog'), editorForm = byId('converterEditorForm');
const editorName = byId('converterName'), editorType = byId('converterType'), editorURL = byId('converterURL');
let editingId = '';
function openEditor(id = '') {
 if (savingConversion) return;
 byId('converterEditorMessage').textContent = '';
 const item = profiles.find(value => value.id === id);
 if (!item && profiles.length >= 10) return;
 editingId = item?.id || '';
 editorName.value = item?.name || '';
 editorType.value = item?.type || 'subconverter';
 editorURL.value = item?.url || '';
 editorURL.setCustomValidity('');
 byId('converterDialogTitle').textContent = item ? '编辑转换服务' : '添加转换服务';
 byId('applyConverter').textContent = item ? '保存修改' : '添加并保存';
 converterDialog.showModal();
 editorName.focus();
}
byId('addConverter').addEventListener('click', () => openEditor());
byId('cancelConverter').addEventListener('click', () => { if (!savingConversion) converterDialog.close(); });
converterDialog.addEventListener('cancel', event => { if (savingConversion) event.preventDefault(); });
editorURL.addEventListener('input', () => editorURL.setCustomValidity(''));
editorForm.addEventListener('submit', async event => {
 event.preventDefault();
 let url;
 try {
  url = new URL(editorURL.value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
 } catch {
  editorURL.setCustomValidity('请输入 HTTP 或 HTTPS 地址，访问密钥可放在路径中');
  editorURL.reportValidity(); return;
 }
 url.search = ''; url.hash = '';
 const item = { id: editingId || crypto.randomUUID(), name: editorName.value.trim() || '自建转换', type: editorType.value, url: url.toString().replace(/\/+$/, '') };
 if (!editingId && profiles.length >= 10) return;
 const nextProfiles = editingId ? profiles.map(value => value.id === editingId ? item : value) : [...profiles, item];
 if (await saveConversion({ customConverters: nextProfiles }, byId('converterEditorMessage'))) {
  converterDialog.close();
  byId('addConverter').focus();
 }
});
byId('customConverterList').addEventListener('change', event => {
 if (event.target.name === 'activeCustomConverter') { activeId = event.target.value; selectedMode = 'custom'; syncModes(); selectionMessage(); }
});
byId('customConverterList').addEventListener('click', event => {
 if (savingConversion) return;
 const edit = event.target.closest('[data-edit]');
 if (edit) { openEditor(edit.dataset.edit); return; }
 const button = event.target.closest('[data-remove]');
 if (!button) return;
 const nextProfiles = profiles.filter(item => item.id !== button.dataset.remove);
 void saveConversion({ customConverters: nextProfiles, activeCustomConverterId: savedActiveId === button.dataset.remove ? '' : savedActiveId, converterMode: savedActiveId === button.dataset.remove || !nextProfiles.length ? 'default' : savedMode });
});
function saveSection(form, message, payload, onSaved) {
 const button = form.querySelector('button[type="submit"]');
 button.disabled = true; message.textContent = '正在保存…'; message.className = 'muted';
 fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
 .then(response => response.json().then(data => { if (!response.ok) throw new Error(data.message || '保存失败'); return data; }))
 .then(data => { message.textContent = '已保存'; message.className = 'success'; onSaved?.(data.settings); })
 .catch(error => { message.textContent = error.message; message.className = 'message'; })
 .finally(() => { button.disabled = false; });
}
iconPreview.addEventListener('error', () => { iconPreview.src = defaultIcon; });
iconInput.addEventListener('input', refreshIcon);
document.querySelectorAll('input[name="converterMode"]').forEach(el => el.addEventListener('change', () => {
 selectedMode = el.value;
 if (selectedMode === 'custom' && !activeId) activeId = profiles[0]?.id || '';
 renderProfiles(); selectionMessage();
}));
byId('saveConverterSelection').addEventListener('click', () => {
 void saveConversion({ converterMode: selectedMode, activeCustomConverterId: activeId }, byId('conversionMessage'), true);
});
byId('generateToken').addEventListener('click', () => {
 const bytes = crypto.getRandomValues(new Uint8Array(24));
 tokenInput.value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
});
refreshIcon(); renderProfiles();
byId('displayForm').addEventListener('submit', function(event) {
 event.preventDefault(); saveSection(this, byId('displayMessage'), { section: 'display', subscriptionName: nameInput.value, pageTitle: pageTitleInput.value, browserIconURL: iconInput.value }, settings => {
  document.title = '设置 · ' + settings.pageTitle;
  document.querySelector('link[rel="icon"]').href = settings.browserIconURL || defaultIcon;
 });
});
byId('entryForm').addEventListener('submit', function(event) {
 event.preventDefault(); saveSection(this, byId('entryMessage'), { section: 'entry', subscriptionToken: tokenInput.value });
});
