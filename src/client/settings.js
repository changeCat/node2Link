const pageData = JSON.parse(document.getElementById('page-data-settings').textContent);
const initial = pageData.initial, defaultIcon = pageData.defaultIcon;
const byId = id => document.getElementById(id);
const nameInput = byId('subscriptionName'), pageTitleInput = byId('pageTitle'), iconInput = byId('browserIconURL');
const iconPreview = byId('iconPreview'), tokenInput = byId('subscriptionToken'), ruleURLInput = byId('customSubConfigURL');
let profiles = structuredClone(initial.customConverters || []), activeId = initial.activeCustomConverterId || '';
nameInput.value = initial.subscriptionName;
pageTitleInput.value = initial.pageTitle;
iconInput.value = initial.browserIconURL || '';
tokenInput.value = initial.subscriptionToken || '';
ruleURLInput.value = initial.customSubConfigURL || '';
const mode = name => document.querySelector('input[name="' + name + '"]:checked').value;
document.querySelector('input[name="converterMode"][value="' + initial.converterMode + '"]').checked = true;
document.querySelector('input[name="ruleMode"][value="' + initial.ruleMode + '"]').checked = true;
function esc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const typeLabel = type => type === 'sublink' ? 'Sublink Worker' : 'Subconverter';
function refreshIcon() { iconPreview.src = iconInput.value.trim() || defaultIcon; }
function syncModes() {
 const custom = mode('converterMode') === 'custom', customRule = mode('ruleMode') === 'custom';
 const active = profiles.find(item => item.id === activeId);
 ruleURLInput.disabled = !customRule;
 ruleURLInput.required = customRule;
 byId('activeConverterMode').textContent = custom ? '自建 ' + typeLabel(active?.type) : '默认 Subconverter';
 byId('activeConverterValue').textContent = custom ? ((active?.url || '请选择并填写自定义服务') + ' → 失败回退默认') : initial.defaultConverterURLs.join(' → ');
 byId('activeRuleMode').textContent = customRule ? '自建' : '默认';
 byId('activeRuleValue').textContent = customRule ? (ruleURLInput.value.trim() || '尚未填写') : initial.defaultSubConfig;
 document.querySelectorAll('.converter-profile').forEach(card => card.classList.toggle('is-active', custom && card.dataset.id === activeId));
 byId('addConverter').disabled = profiles.length >= 10;
 byId('converterCount').textContent = profiles.length + ' / 10';
}
function serviceHost(url) { try { return new URL(url).host; } catch { return '地址无效'; } }
function changed(message = '转换配置已修改，请点击保存') {
 byId('conversionMessage').textContent = message;
 byId('conversionMessage').className = 'muted';
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
 const item = profiles.find(value => value.id === id);
 if (!item && profiles.length >= 10) return;
 editingId = item?.id || '';
 editorName.value = item?.name || '';
 editorType.value = item?.type || 'subconverter';
 editorURL.value = item?.url || '';
 editorURL.setCustomValidity('');
 byId('converterDialogTitle').textContent = item ? '编辑转换服务' : '添加转换服务';
 byId('applyConverter').textContent = item ? '应用修改' : '添加到列表';
 converterDialog.showModal();
 editorName.focus();
}
byId('addConverter').addEventListener('click', () => openEditor());
byId('cancelConverter').addEventListener('click', () => converterDialog.close());
editorURL.addEventListener('input', () => editorURL.setCustomValidity(''));
editorForm.addEventListener('submit', event => {
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
 if (editingId) profiles = profiles.map(value => value.id === editingId ? item : value);
 else {
  if (profiles.length >= 10) return;
  profiles.push(item);
  if (!activeId) activeId = item.id;
 }
 renderProfiles();
 converterDialog.close();
 changed(editingId ? '已修改列表，请点击保存' : '已添加到列表，请点击保存');
 byId('addConverter').focus();
});
byId('customConverterList').addEventListener('change', event => {
 if (event.target.name === 'activeCustomConverter') { activeId = event.target.value; syncModes(); changed(); }
});
byId('customConverterList').addEventListener('click', event => {
 const edit = event.target.closest('[data-edit]');
 if (edit) { openEditor(edit.dataset.edit); return; }
 const button = event.target.closest('[data-remove]');
 if (!button) return;
 profiles = profiles.filter(item => item.id !== button.dataset.remove);
 if (activeId === button.dataset.remove) activeId = profiles[0]?.id || '';
 renderProfiles(); changed();
 byId('addConverter').focus();
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
ruleURLInput.addEventListener('input', syncModes);
document.querySelectorAll('input[name="converterMode"],input[name="ruleMode"]').forEach(el => el.addEventListener('change', () => {
 syncModes(); changed();
}));
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
byId('conversionForm').addEventListener('submit', function(event) {
 event.preventDefault(); saveSection(this, byId('conversionMessage'), { section: 'conversion', converterMode: mode('converterMode'), customConverters: profiles, activeCustomConverterId: activeId, ruleMode: mode('ruleMode'), customSubConfigURL: ruleURLInput.value });
});
