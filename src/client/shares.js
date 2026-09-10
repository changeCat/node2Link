import { initializeShareConfirm } from "./share-confirm.js";
const pageData = JSON.parse(document.getElementById("page-data-shares").textContent);
var shares = pageData.shares;
var origin = window.location.origin;
var form = document.getElementById("shareForm");
var list = document.getElementById("shareList");
var shareIcon = '<span class="share-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 3-1.4 3.6L7 8l3.6 1.4L12 13l1.4-3.6L17 8l-3.6-1.4L12 3Z"/><path d="m5 14-.9 2.1L2 17l2.1.9L5 20l.9-2.1L8 17l-2.1-.9L5 14Z"/><path d="m19 13-1 2.5-2.5 1L18 17.5l1 2.5 1-2.5 2.5-1-2.5-1L19 13Z"/></svg></span>';
var copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var qrIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><path d="M15 15h2v2h-2zM19 15h2v6h-6v-2"/></svg>';
function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function linkOf(id) {
  return origin + "/s/" + id;
}
function render() {
  if (!shares.length) {
    list.innerHTML = '<div class="panel empty">还没有分享链接，请先创建一组。</div>';
    return;
  }
  list.innerHTML = shares.map(function(item) {
    var link = linkOf(item.id);
    var counts = item.nodeCount + " 个节点" + (item.sourceCount ? " · " + item.sourceCount + " 个订阅源" : "");
    return '<article class="share-card"><div class="share-identity">' + shareIcon + '<div class="share-title"><h3 title="' + esc(item.name) + '">' + esc(item.name) + '</h3><div class="share-meta">' + counts + " · " + new Date(item.updatedAt).toLocaleString() + '</div></div></div><div class="share-actions"><button class="share-action copy" type="button" data-copy="' + esc(link) + '">' + copyIcon + '<span>复制</span></button><button class="share-action icon" type="button" data-qr="' + esc(link) + '" aria-label="显示二维码" title="显示二维码">' + qrIcon + '</button><button class="share-action" type="button" data-edit="' + item.id + '">修改</button><button class="share-action danger" type="button" data-delete="' + item.id + '">删除</button></div></article>';
  }).join("");
  addResetButtons();
}
function reset() {
  form.reset();
  document.getElementById("shareId").value = "";
  document.getElementById("formTitle").textContent = "新建分享";
  document.getElementById("submitShare").textContent = "生成订阅链接";
  document.getElementById("cancelEdit").hidden = true;
}
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
  var button = document.getElementById("submitShare");
  var message = document.getElementById("formMessage");
  button.disabled = true;
  message.textContent = "正在保存…";
  call(id ? "PUT" : "POST", { id, name: document.getElementById("shareName").value, content: document.getElementById("shareContent").value }).then(function(data) {
    var index = shares.findIndex(function(item) {
      return item.id === data.share.id;
    });
    if (index >= 0) shares[index] = data.share;
    else shares.unshift(data.share);
    render();
    reset();
    message.textContent = "已保存，订阅链接可直接使用";
    message.className = "success";
  }).catch(function(error) {
    message.textContent = error.message;
    message.className = "message";
  }).finally(function() {
    button.disabled = false;
  });
});
list.addEventListener("click", function(event) {
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
    editButton.disabled = true;
    loadShare(editButton.dataset.edit).then(function(item) {
      document.getElementById("shareId").value = item.id;
      document.getElementById("shareName").value = item.name;
      document.getElementById("shareContent").value = item.content;
      document.getElementById("formTitle").textContent = "修改分享";
      document.getElementById("submitShare").textContent = "保存修改";
      document.getElementById("cancelEdit").hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }).catch(function(error) {
      showShareNotice(error.message, "读取失败");
    }).finally(function() {
      editButton.disabled = false;
    });
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
document.getElementById("cancelEdit").addEventListener("click", reset);
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
