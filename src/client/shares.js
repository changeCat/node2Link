import { initializeShareConfirm } from "./share-confirm.js";
import './share-picker.js';
import { loadShareContent, shareContentPayload } from './share-content.js';
import { shareLines, isShareSource } from '../shared/share-content.js';
import { mainNodeName, mainNodeSummary } from '../shared/main-subscription.js';
const pageData = JSON.parse(document.getElementById("page-data-shares").textContent);
var shares = pageData.shares;
var origin = window.location.origin;
var form = document.getElementById("shareForm");
var list = document.getElementById("shareList");
const editor = document.getElementById('shareEditor');
const fields = document.getElementById('shareFields');
const feedback = document.getElementById('shareFeedback');
const message = document.getElementById('formMessage');
const submitButton = document.getElementById('submitShare');
const cancelButton = document.getElementById('cancelEdit');
const closeButton = document.getElementById('closeShareEditor');
const addButton = document.getElementById('addShare');
let editorSession = 0;
const expiryInput = document.getElementById('shareExpiresAt');
expiryInput.addEventListener('click', function(event) {
  if (typeof expiryInput.showPicker !== 'function') return;
  try {
    expiryInput.focus();
    expiryInput.showPicker();
    event.preventDefault();
  } catch { /* Keep native editing available when the browser cannot open its picker. */ }
});
document.getElementById('clearShareExpiry').addEventListener('click', function() {
  expiryInput.value = '';
  expiryInput.dispatchEvent(new Event('input', { bubbles: true }));
});
var copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var qrIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><path d="M15 15h2v2h-2zM19 15h2v6h-6v-2"/></svg>';
var pauseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
var resumeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';
var activeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
var expiredIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function linkOf(id) {
  return origin + "/s/" + id;
}
function render() {
  if (!shares.length) {
    list.innerHTML = '<div class="empty">暂无分享链接</div>';
    return;
  }
  list.innerHTML = shares.map(function(item) {
    var link = linkOf(item.id);
    var counts = item.nodeCount + " 个节点" + (item.sourceCount ? " · " + item.sourceCount + " 个订阅源" : "");
    var state = item.paused ? 'paused' : item.expiresAt && Date.parse(item.expiresAt) <= Date.now() ? 'expired' : 'active';
    var status = state === 'paused' ? '已暂停' : state === 'expired' ? '已到期' : '使用中';
    var statusIcon = state === 'paused' ? pauseIcon : state === 'expired' ? expiredIcon : activeIcon;
    var badge = '<span class="share-status">' + statusIcon + '<span>' + status + '</span></span>';
    var expiry = item.expiresAt ? new Date(item.expiresAt).toLocaleString() : '长期有效';
    var updated = new Date(item.updatedAt).toLocaleString();
    var note = item.note ? '<span class="compact-label">备注：</span>' + esc(item.note) : '';
    return '<article class="share-card" data-state="' + state + '" data-share-id="' + esc(item.id) + '"><div class="share-identity"><h3><button type="button" class="share-view" aria-haspopup="dialog" title="查看订阅 · ' + esc(item.name) + '">' + esc(item.name) + '</button></h3>' + badge + '</div>' +
      '<code class="share-url" title="' + esc(link) + '">' + esc(link) + '</code>' +
      '<div class="share-cell" title="' + esc(counts) + '">' + esc(counts) + '</div>' +
      '<div class="share-cell" title="' + esc(expiry) + '">' + (item.expiresAt ? '<span class="compact-label">到期 </span>' : '') + esc(expiry) + '</div>' +
      '<div class="share-cell share-note" title="' + esc(item.note || '') + '">' + note + '</div>' +
      '<div class="share-cell" title="' + esc(updated) + '"><span class="compact-label">更新于 </span>' + esc(updated) + '</div>' +
      '<div class="share-actions"><button class="share-action copy" type="button" data-copy="' + esc(link) + '">' + copyIcon + '<span>复制</span></button><button class="share-action icon" type="button" data-qr="' + esc(link) + '" aria-label="显示二维码" title="显示二维码">' + qrIcon + '</button><button class="share-action" type="button" data-edit="' + item.id + '">修改</button><button class="share-action danger" type="button" data-delete="' + item.id + '">删除</button></div></article>';
  }).join("");
  addResetButtons();
  list.querySelectorAll('[data-edit]').forEach(function(edit) {
    var item = shares.find(function(share) { return share.id === edit.dataset.edit; });
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'share-action ' + (item.paused ? 'resume' : 'pause');
    toggle.dataset.toggle = item.id;
    toggle.innerHTML = (item.paused ? resumeIcon : pauseIcon) + '<span>' + (item.paused ? '恢复' : '暂停') + '</span>';
    toggle.title = item.paused ? '取消暂停；已到期的链接仍需修改到期时间' : '暂停后停止提供订阅，已下载的节点不受影响';
    edit.before(toggle);
  });
}
async function openEditor(id) {
  const session = ++editorSession;
  form.reset();
  loadShareContent();
  feedback.textContent = '';
  message.className = 'muted';
  message.textContent = id ? '正在读取分享…' : '';
  document.getElementById('shareId').value = id;
  document.getElementById('formTitle').textContent = id ? '修改分享' : '新建分享';
  submitButton.textContent = id ? '保存修改' : '生成订阅链接';
  fields.disabled = submitButton.disabled = Boolean(id);
  editor.showModal();
  const name = document.getElementById('shareName');
  if (id) {
    try {
      const item = await loadShare(id);
      if (editorSession !== session || !editor.open) return;
      name.value = item.name;
      document.getElementById('shareNote').value = item.note || '';
      loadShareContent(item);
      const expiry = item.expiresAt ? new Date(item.expiresAt) : null;
      expiryInput.value = expiry ? new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      fields.disabled = submitButton.disabled = false;
      message.textContent = '';
    } catch (error) {
      if (editorSession === session && editor.open) {
        message.textContent = error.message;
        message.className = 'message';
      }
      return;
    }
  }
  name.focus();
}
addButton.addEventListener('click', () => openEditor(''));
cancelButton.addEventListener('click', () => editor.close());
closeButton.addEventListener('click', () => editor.close());
editor.addEventListener('cancel', event => { if (cancelButton.disabled) event.preventDefault(); });
function call(method, body) {
  return fetch("/api/shares", { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : void 0 }).then(function(response) {
    return response.json().then(function(data) {
      if (!response.ok) throw new Error(data.message || "操作失败");
      return data;
    });
  });
}
function loadShare(id) {
  return fetch("/api/shares?id=" + encodeURIComponent(id)).then(function(response) {
    return response.json().then(function(data) {
      if (!response.ok) throw new Error(data.message || "读取失败");
      return data.share;
    });
  });
}
const details = document.getElementById('shareDetails');
let detailSession = 0;
async function viewShare(id) {
  const session = ++detailSession;
  const status = document.getElementById('shareDetailsStatus');
  const rows = document.getElementById('shareDetailsList');
  const title = document.getElementById('shareDetailsTitle');
  title.textContent = shares.find(item => item.id === id).name;
  rows.replaceChildren();
  status.textContent = '正在读取节点…';
  details.showModal();
  try {
    const share = await loadShare(id);
    if (!details.open || session !== detailSession) return;
    title.textContent = share.name;
    const nodes = [], sources = [];
    for (const line of shareLines(share.content)) (isShareSource(line) ? sources : nodes).push(line);
    status.textContent = nodes.length + ' 个节点 · ' + sources.length + ' 个订阅源';
    for (const [label, lines] of [['已保存节点', nodes], ['订阅源（客户端更新时拉取）', sources]]) {
      if (!lines.length) continue;
      const heading = document.createElement('strong');
      heading.textContent = label;
      const content = document.createElement('pre');
      content.textContent = lines.map(line => {
        if (isShareSource(line)) return line;
        const { protocol, address } = mainNodeSummary(line);
        return mainNodeName(line) + ' · ' + protocol + ' · ' + address;
      }).join('\n');
      rows.append(heading, content);
    }
  } catch (error) {
    if (details.open && session === detailSession) status.textContent = error.message;
  }
}
function showQR(link) {
  var container = document.getElementById("qrcode");
  container.innerHTML = "";
  document.getElementById("qrUrl").textContent = link;
  if (window.QRCode) new QRCode(container, { text: link, width: 220, height: 220, colorDark: "#17211d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.Q });
  else container.textContent = "二维码组件加载失败，请稍后重试。";
  document.getElementById("qrDialog").showModal();
}
form.addEventListener("submit", function(event) {
  event.preventDefault();
  var id = document.getElementById("shareId").value;
  if (submitButton.disabled) return;
  fields.disabled = submitButton.disabled = cancelButton.disabled = closeButton.disabled = true;
  message.className = 'muted';
  message.textContent = "正在保存…";
  var expiry = document.getElementById('shareExpiresAt').value;
  call(id ? "PUT" : "POST", { id, name: document.getElementById("shareName").value, note: document.getElementById("shareNote").value, ...shareContentPayload(), expiresAt: expiry ? new Date(expiry).toISOString() : '' }).then(function(data) {
    var index = shares.findIndex(function(item) {
      return item.id === data.share.id;
    });
    if (index >= 0) shares[index] = data.share;
    else shares.unshift(data.share);
    editor.close();
    render();
    feedback.textContent = id ? '已保存修改' : '已添加分享';
    (id ? list.querySelector('[data-edit="' + id + '"]') : addButton)?.focus();
  }).catch(function(error) {
    message.textContent = error.message;
    message.className = "message";
  }).finally(function() {
    fields.disabled = submitButton.disabled = cancelButton.disabled = closeButton.disabled = false;
  });
});
list.addEventListener("click", function(event) {
  const card = event.target.closest('[data-share-id]');
  if (card && !event.target.closest('.share-actions')) {
    if (event.target.closest('.share-view') || !window.getSelection()?.toString()) viewShare(card.dataset.shareId);
    return;
  }
  var toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    var item = shares.find(function(share) { return share.id === toggle.dataset.toggle; });
    toggle.disabled = true;
    call('PATCH', { id: item.id, action: 'availability', paused: !item.paused }).then(function(data) {
      shares[shares.findIndex(function(share) { return share.id === data.share.id; })] = data.share;
      render();
    }).catch(function(error) { toggle.disabled = false; showShareNotice(error.message, '更新失败'); });
    return;
  }
  var copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    var label = copyButton.querySelector("span");
    navigator.clipboard.writeText(copyButton.dataset.copy).then(function() {
      label.textContent = "已复制";
      setTimeout(function() {
        label.textContent = "复制";
      }, 1200);
    });
    return;
  }
  var qrButton = event.target.closest("[data-qr]");
  if (qrButton) {
    showQR(qrButton.dataset.qr);
    return;
  }
  var editButton = event.target.closest("[data-edit]");
  if (editButton) {
    openEditor(editButton.dataset.edit);
    return;
  }
  var deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    askShareConfirm("删除后，这个订阅链接将失效，KV 同步可能有短暂延迟。", "删除分享").then(function(accepted) {
      if (!accepted) return;
      deleteButton.disabled = true;
      call("DELETE", { id: deleteButton.dataset.delete }).then(function() {
        shares = shares.filter(function(item) {
          return item.id !== deleteButton.dataset.delete;
        });
        render();
      }).catch(function(error) {
        deleteButton.disabled = false;
        showShareNotice(error.message, "删除失败");
      });
    });
  }
});
document.getElementById("closeQR").addEventListener("click", function() {
  document.getElementById("qrDialog").close();
});
document.getElementById("qrDialog").addEventListener("click", function(event) {
  if (event.target === this) this.close();
});
const { askShareConfirm, showShareNotice, addResetButtons } = initializeShareConfirm({
  list,
  call,
  onReset(oldId, share) {
    const index = shares.findIndex((item) => item.id === oldId);
    if (index >= 0) shares[index] = share;
    const input = document.getElementById("shareId");
    if (input.value === oldId) input.value = share.id;
    render();
  }
});
render();
if (new URLSearchParams(location.search).get('new') === '1') {
  history.replaceState(history.state, '', location.pathname);
  openEditor('');
}
