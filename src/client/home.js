import { initializeMainEditor } from './main-editor.js';
const pageData = JSON.parse(document.getElementById('page-data-home').textContent);
let toastTimer, mainConfirmResolver;
function initializeIcons() {
	if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function showToast(message) {
	var toast = document.getElementById("toast");
	document.getElementById("toastText").textContent = message;
	toast.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2200);
}

function askMainConfirm(message, title) {
	var dialog = document.getElementById("mainConfirmDialog");
	document.getElementById("mainConfirmTitle").textContent = title || "请确认操作";
	document.getElementById("mainConfirmText").textContent = message;
	return new Promise(function (resolve) { mainConfirmResolver = resolve; dialog.showModal(); });
}

function resolveMainConfirm(accepted) {
	var dialog = document.getElementById("mainConfirmDialog");
	if (dialog.open) dialog.close();
	if (mainConfirmResolver) { var resolve = mainConfirmResolver; mainConfirmResolver = null; resolve(Boolean(accepted)); }
}

function localizeRequestTimes() {
	document.querySelectorAll("[data-request-time]").forEach(function (element) {
		var value = element.dataset.requestTime;
		if (value) element.textContent = new Date(value).toLocaleString();
	});
}

function copyText(text) {
	if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
	var helper = document.createElement("textarea");
	helper.value = text;
	helper.style.position = "fixed";
	helper.style.opacity = "0";
	document.body.appendChild(helper);
	helper.select();
	var copied = document.execCommand("copy");
	helper.remove();
	return copied ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}

function copySubscription(button) {
	copyText(button.dataset.url).then(function () {
		showToast("订阅地址已复制");
		button.querySelector("span").textContent = "已复制";
		setTimeout(function () { button.querySelector("span").textContent = "复制"; }, 1600);
	}).catch(function () { showToast("复制失败，请手动选择链接"); });
}

function showQRCode(button) {
	var text = button.dataset.url;
	var container = document.getElementById("qrcode");
	container.textContent = "正在生成二维码…";
	document.getElementById("qrUrl").textContent = text;
	var dialog = document.getElementById("qrDialog");
	if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
	window.loadQRCode().then(function () {
		container.innerHTML = "";
		new QRCode(container, { text: text, width: 220, height: 220, colorDark: "#17211d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.Q });
	}).catch(function () { container.textContent = "二维码组件加载失败"; });
}

function closeQR() {
	var dialog = document.getElementById("qrDialog");
	if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
}


Object.assign(window, { showQRCode, copySubscription, closeQR, resolveMainConfirm });
document.addEventListener('DOMContentLoaded', () => {
 initializeIcons(); localizeRequestTimes();
 initializeMainEditor(pageData, { showToast, askMainConfirm, copyText });
 for (const button of document.querySelectorAll('[data-converter-url]')) {
  button.addEventListener('click', () => {
   copyText(button.dataset.converterUrl).then(() => showToast('转换后端完整地址已复制')).catch(() => showToast('复制失败，请展开地址后手动复制'));
  });
 }
 const qrDialog = document.getElementById('qrDialog');
 qrDialog.addEventListener('click', event => { if (event.target === qrDialog) closeQR(); });
 const confirm = document.getElementById('mainConfirmDialog');
 confirm.addEventListener('click', event => { if (event.target === confirm) resolveMainConfirm(false); });
 confirm.addEventListener('cancel', event => { event.preventDefault(); resolveMainConfirm(false); });
 const tools = document.getElementById('toolDialog');
 tools.addEventListener('click', event => { if (event.target === tools) tools.close(); });
});
