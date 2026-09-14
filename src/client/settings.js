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
}
function renderProfiles() {
 byId('customConverterList').innerHTML = profiles.length ? profiles.map((item, index) => {
  const id = esc(item.id);
  return '<article class="converter-profile" data-id="' + id + '"><div class="converter-profile-head"><label><input type="radio" name="activeCustomConverter" value="' + id + '" ' + (item.id === activeId ? 'checked' : '') + '>启用此配置</label><button class="button" type="button" data-remove="' + id + '" aria-label="删除转换配置 ' + (index + 1) + '">删除</button></div><div class="profile-fields"><div class="field"><label for="name-' + id + '">名称</label><input id="name-' + id + '" data-field="name" maxlength="60" placeholder="例如 VPS 转换" value="' + esc(item.name) + '"></div><div class="field"><label for="type-' + id + '">类型</label><select id="type-' + id + '" data-field="type"><option value="subconverter" ' + (item.type === 'subconverter' ? 'selected' : '') + '>Subconverter</option><option value="sublink" ' + (item.type === 'sublink' ? 'selected' : '') + '>Sublink Worker</option></select></div></div><div class="field"><label for="url-' + id + '">服务地址</label><input id="url-' + id + '" data-field="url" type="url" maxlength="2048" required placeholder="https://sub.example.com" value="' + esc(item.url) + '"></div></article>';
 }).join('') : '<p class="muted">尚未添加自定义转换服务。</p>';
 syncModes();
}
function addProfile() {
 if (profiles.length >= 10) return;
 const id = crypto.randomUUID();
 profiles.push({ id, name: '', type: 'subconverter', url: '' });
 if (!activeId) activeId = id;
 renderProfiles();
 byId('name-' + id).focus();
}
byId('addConverter').addEventListener('click', addProfile);
byId('customConverterList').addEventListener('input', event => {
 const card = event.target.closest('[data-id]');
 const item = profiles.find(value => value.id === card?.dataset.id);
 if (item && event.target.dataset.field) item[event.target.dataset.field] = event.target.value;
 syncModes();
});
byId('customConverterList').addEventListener('change', event => {
 if (event.target.name === 'activeCustomConverter') { activeId = event.target.value; syncModes(); }
});
byId('customConverterList').addEventListener('click', event => {
 const button = event.target.closest('[data-remove]');
 if (!button) return;
 profiles = profiles.filter(item => item.id !== button.dataset.remove);
 if (activeId === button.dataset.remove) activeId = profiles[0]?.id || '';
 renderProfiles();
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
 if (mode('converterMode') === 'custom' && !profiles.length) addProfile();
 syncModes();
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
