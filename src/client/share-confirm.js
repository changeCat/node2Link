// Keep confirmation actions and page state in one bundle with explicit dependencies.
export function initializeShareConfirm({ list, call, onReset }) {
 const dialog = document.createElement('dialog');
 dialog.className = 'share-prompt';
 dialog.innerHTML = '<div class="dialog-head"><strong id="sharePromptTitle">请确认操作</strong><button class="dialog-close" id="sharePromptClose" type="button" aria-label="关闭">×</button></div><div class="dialog-body"><p id="sharePromptText" style="margin:0;color:var(--muted);line-height:1.7"></p><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="button" id="sharePromptCancel" type="button">取消</button><button class="button primary" id="sharePromptAccept" type="button">确认</button></div></div>';
 document.body.appendChild(dialog);
 const title = dialog.querySelector('#sharePromptTitle');
 const text = dialog.querySelector('#sharePromptText');
 const accept = dialog.querySelector('#sharePromptAccept');
 const cancel = dialog.querySelector('#sharePromptCancel');
 const close = dialog.querySelector('#sharePromptClose');
 function askShareConfirm(message, heading) {
  return new Promise(resolve => {
   title.textContent = heading || '请确认操作';
   text.textContent = message;
   cancel.hidden = false;
   accept.textContent = '确认';
   const finish = value => { dialog.close(); resolve(value); };
   accept.onclick = () => finish(true);
   cancel.onclick = close.onclick = () => finish(false);
   dialog.showModal();
  });
 }
 function showShareNotice(message, heading) {
  title.textContent = heading || '操作提示';
  text.textContent = message;
  cancel.hidden = true;
  accept.textContent = '知道了';
  accept.onclick = close.onclick = () => dialog.close();
  dialog.showModal();
 }
 dialog.addEventListener('cancel', event => { event.preventDefault(); if (cancel.hidden) dialog.close(); else cancel.click(); });
 function addResetButtons() {
  list.querySelectorAll('[data-edit]').forEach(edit => {
   const button = document.createElement('button');
   button.className = 'share-action';
   button.type = 'button';
   button.dataset.reset = edit.dataset.edit;
   button.textContent = '重置链接';
   edit.after(button);
  });
 }
 list.addEventListener('click', async event => {
  const button = event.target.closest('[data-reset]');
  if (!button) return;
  if (!await askShareConfirm('重置后，当前订阅链接将失效，已使用旧链接的客户端需要更新。KV 同步可能有短暂延迟。', '重置分享链接')) return;
  button.disabled = true;
  try {
   const data = await call('PATCH', { id: button.dataset.reset });
   onReset(button.dataset.reset, data.share);
   showShareNotice('订阅链接已重置，请复制新的链接。');
  } catch (error) { button.disabled = false; showShareNotice(error.message, '重置失败'); }
 });
 return { askShareConfirm, showShareNotice, addResetButtons };
}
