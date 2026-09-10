const pageData = JSON.parse(document.getElementById('page-data-home').textContent);
var savedRevision = pageData.revision;
var toastTimer;
var editorTimer;
var editorWorkPending = false;
					var originalContent = "";
					var undoStack = [];
					var pendingDedupeContent = "";
					var mainConfirmResolver = null;
					var savedMetadata = pageData.savedMetadata;
					var draftStorageKey = "node2link:draft:" + window.location.host + window.location.pathname;

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

					function escapeClientHTML(value) {
						return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
					}

					function analyzeContent(value) {
						var lines = value ? value.split(/\r?\n/) : [];
						var supportedProtocols = pageData.supportedProtocols;
						var seen = new Set();
						var protocols = {};
						var result = { lines: lines.length, nodes: 0, sources: 0, duplicates: 0, blank: 0, issues: [], protocols: protocols };
						lines.forEach(function (line, index) {
							var trimmed = line.trim();
							if (!trimmed) { result.blank += 1; return; }
							if (seen.has(trimmed)) result.duplicates += 1;
							else seen.add(trimmed);
							if (/^https?:\/\//i.test(trimmed)) { result.sources += 1; return; }
							var match = trimmed.match(/^([a-z0-9+.-]+):\/\//i);
							var protocol = match ? match[1].toLowerCase() : "";
							if (supportedProtocols.includes(protocol)) {
								result.nodes += 1;
								protocols[protocol] = (protocols[protocol] || 0) + 1;
							} else {
								result.issues.push({ line: index + 1, value: trimmed, reason: match ? "不支持的协议 " + protocol : "无法识别链接格式" });
							}
						});
						return result;
					}

					function updateEditorInsights() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						var analysis = analyzeContent(textarea.value);
						document.getElementById("lineCount").textContent = analysis.lines;
						document.getElementById("nodeCount").textContent = analysis.nodes;
						document.getElementById("sourceCount").textContent = analysis.sources;
						document.getElementById("duplicateCount").textContent = analysis.duplicates;
						document.getElementById("issueCount").textContent = analysis.issues.length;
						var protocolText = Object.keys(analysis.protocols).sort().map(function (protocol) { return protocol.toUpperCase() + " " + analysis.protocols[protocol]; }).join(" · ");
						document.getElementById("protocolBreakdown").textContent = protocolText || "暂无节点协议";
						var status = document.getElementById("validationStatus");
						var issues = document.getElementById("validationIssues");
						if (analysis.issues.length) {
							status.classList.add("has-issues");
							status.querySelector("span").textContent = "发现 " + analysis.issues.length + " 个格式问题";
							issues.innerHTML = analysis.issues.slice(0, 4).map(function (issue) { return "第 " + issue.line + " 行：" + escapeClientHTML(issue.reason); }).join("<br>");
							if (analysis.issues.length > 4) issues.innerHTML += "<br>另有 " + (analysis.issues.length - 4) + " 项";
						} else {
							status.classList.remove("has-issues");
							status.querySelector("span").textContent = "格式检查通过";
							issues.textContent = "";
						}
					}

					function updateLineCount() { updateEditorInsights(); }

					function buildDedupeContent(value) {
						var lines = value ? value.split(/\r?\n/) : [];
						var seen = new Set();
						var unique = [];
						var duplicates = 0;
						lines.forEach(function (line) {
							var trimmed = line.trim();
							if (!trimmed) return;
							if (seen.has(trimmed)) { duplicates += 1; return; }
							seen.add(trimmed);
							unique.push(trimmed);
						});
						return { content: unique.join("\n"), before: lines.length, duplicates: duplicates, after: unique.length };
					}

					function openDedupePreview() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						var preview = buildDedupeContent(textarea.value);
						pendingDedupeContent = preview.content;
						document.getElementById("previewBefore").textContent = preview.before;
						document.getElementById("previewDuplicates").textContent = preview.duplicates;
						document.getElementById("previewAfter").textContent = preview.after;
						document.getElementById("applyDedupeButton").disabled = preview.content === textarea.value;
						var dialog = document.getElementById("toolDialog");
						if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
					}

					function closeToolDialog() {
						var dialog = document.getElementById("toolDialog");
						if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
					}

					function pushUndoSnapshot(value) {
						if (undoStack[undoStack.length - 1] !== value) undoStack.push(value);
						if (undoStack.length > 10) undoStack.shift();
						document.getElementById("undoButton").disabled = undoStack.length === 0;
					}

					function storeLocalDraft(value) {
						try { window.localStorage.setItem(draftStorageKey, value); }
						catch (error) { console.warn("无法保存本地草稿:", error); }
					}

					function clearLocalDraft() {
						clearTimeout(editorTimer);
						editorWorkPending = false;
						try { window.localStorage.removeItem(draftStorageKey); }
						catch (error) { console.warn("无法清除本地草稿:", error); }
					}

					function restoreLocalDraft(textarea) {
						try {
							var draft = window.localStorage.getItem(draftStorageKey);
							if (draft === null || draft === originalContent) return;
							askMainConfirm("发现尚未保存的本地草稿，是否恢复到编辑器？", "恢复本地草稿").then(function (accepted) {
							if (accepted) {
								textarea.value = draft;
								updateEditorInsights();
								setSaveState("已恢复本地草稿，尚未保存", "dirty");
							} else {
								clearLocalDraft();
							}
							});
						} catch (error) {
							console.warn("无法读取本地草稿:", error);
						}
					}

					function flushEditorWork() {
						if (!editorWorkPending) return;
						clearTimeout(editorTimer);
						editorWorkPending = false;
						updateEditorInsights();
						var textarea = document.getElementById("content");
						if (textarea.value !== originalContent) storeLocalDraft(textarea.value);
						else clearLocalDraft();
					}

					function markEditorDirty(message) {
						setSaveState(message || "有未保存更改", "dirty");
						editorWorkPending = true;
						clearTimeout(editorTimer);
						editorTimer = setTimeout(flushEditorWork, 250);
					}

					function applyDedupe() {
						var textarea = document.getElementById("content");
						if (!textarea || pendingDedupeContent === textarea.value) { closeToolDialog(); return; }
						pushUndoSnapshot(textarea.value);
						textarea.value = pendingDedupeContent;
						markEditorDirty("整理结果尚未保存");
						closeToolDialog();
						showToast("已整理，可撤销或保存");
					}

					function undoLastChange() {
						var textarea = document.getElementById("content");
						if (!textarea || !undoStack.length) return;
						textarea.value = undoStack.pop();
						document.getElementById("undoButton").disabled = undoStack.length === 0;
						markEditorDirty("已撤销，尚未保存");
						showToast("已恢复上一个版本");
					}

					function downloadBackup() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						var blob = new Blob([textarea.value], { type: "text/plain;charset=utf-8" });
						var href = URL.createObjectURL(blob);
						var anchor = document.createElement("a");
						anchor.href = href;
						anchor.download = "node2link-backup-" + new Date().toISOString().slice(0, 10) + ".txt";
						anchor.click();
						setTimeout(function () { URL.revokeObjectURL(href); }, 0);
						showToast("备份已下载");
					}

					function restoreBackup(file) {
						var textarea = document.getElementById("content");
						if (!file || !textarea) return;
						file.text().then(function (restoredContent) {
							return askMainConfirm("将备份内容载入编辑器？当前内容可通过撤销恢复。", "载入备份").then(function (accepted) {
							if (!accepted) return;
							pushUndoSnapshot(textarea.value);
							textarea.value = restoredContent;
							markEditorDirty("备份已载入，尚未保存");
							showToast("备份已载入编辑器");
							});
						}).catch(function () { showToast("无法读取备份文件"); });
					}

					function loadLastSavedVersion() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						fetch(window.location.href, {
							method: "POST",
							headers: { "X-Node2Link-Action": "get-backup" },
							cache: "no-cache"
						})
							.then(function (response) {
								return response.json().then(function (result) {
									if (!response.ok) throw new Error(result.message || "无法读取上次版本");
									return result;
								});
							})
							.then(function (result) {
								var savedAt = result.metadata && result.metadata.savedAt ? new Date(result.metadata.savedAt).toLocaleString() : "时间未知";
								return askMainConfirm("将上次保存版本（" + savedAt + "）载入编辑器？当前内容可通过撤销恢复。", "载入上次版本").then(function (accepted) {
								if (!accepted) return;
								pushUndoSnapshot(textarea.value);
								textarea.value = result.content;
								markEditorDirty("上次版本已载入，尚未保存");
								showToast("已载入上次保存版本");
								});
							})
							.catch(function (error) { showToast(error.message); });
					}

					function formatBytes(bytes) {
						if (bytes < 1024) return bytes + " B";
						return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
					}

					function updateSavedMetadata(metadata) {
						savedMetadata = metadata || savedMetadata;
						var element = document.getElementById("lastSaved");
						if (!element) return;
						if (!savedMetadata.savedAt) element.textContent = "尚无保存记录 · " + formatBytes(savedMetadata.bytes || 0);
						else element.textContent = new Date(savedMetadata.savedAt).toLocaleString() + " · " + formatBytes(savedMetadata.bytes || 0) + " · " + (savedMetadata.lines || 0) + " 行";
					}

					function setSaveState(message, state) {
						var status = document.getElementById("saveStatus");
						if (!status) return;
						status.textContent = message;
						status.className = "save-state" + (state ? " " + state : "");
					}

					function saveContent() {
						var textarea = document.getElementById("content");
						var button = document.getElementById("saveButton");
						if (!textarea || !button || button.disabled) return Promise.resolve();
						flushEditorWork();
						if (textarea.value === originalContent) { setSaveState("已同步", ""); return Promise.resolve(); }
						var contentToSave = textarea.value;
						button.disabled = true;
						button.querySelector("span").textContent = "保存中";
						setSaveState("正在保存…", "");
						return fetch(window.location.href, { method: "POST", body: contentToSave, headers: { "Content-Type": "text/plain;charset=UTF-8", ...(savedRevision ? { "X-Node2Link-Revision": savedRevision } : {}) }, cache: "no-cache" })
							.then(function (response) { return response.json().then(function (result) { if (!response.ok) throw new Error(result.message || "HTTP " + response.status); return result; }); })
							.then(function (result) {
								originalContent = contentToSave;
								savedRevision = result.metadata.revision;
								updateSavedMetadata(result.metadata);
								if (textarea.value === contentToSave) {
									clearLocalDraft();
									setSaveState("刚刚已保存", "");
									showToast("节点与订阅源已保存");
								} else {
									storeLocalDraft(textarea.value);
									updateEditorInsights();
									setSaveState("保存期间有新修改，请再次保存", "dirty");
									showToast("旧内容已保存，新修改尚未保存");
								}
							})
							.catch(function (error) { setSaveState("保存失败：" + error.message, "error"); showToast("保存失败，请稍后重试"); })
							.finally(function () { button.disabled = false; button.querySelector("span").textContent = "保存更改"; });
					}

					document.addEventListener("DOMContentLoaded", function () {
						initializeIcons();
						setTimeout(initializeIcons, 500);
						localizeRequestTimes();
						var textarea = document.getElementById("content");
						if (textarea) {
							// The live value may already contain edits made before deferred scripts
							// finished loading. Only the server-rendered value is the saved baseline.
							originalContent = textarea.defaultValue;
							updateEditorInsights();
							updateSavedMetadata(savedMetadata);
							if (textarea.value !== originalContent) markEditorDirty("有未保存更改");
							else restoreLocalDraft(textarea);
							textarea.addEventListener("input", function () {
								markEditorDirty("有未保存更改");
							});
							document.getElementById("restoreInput").addEventListener("change", function (event) {
								restoreBackup(event.target.files[0]);
								event.target.value = "";
							});
							document.getElementById("saveButton").disabled = false;
						}
						var qrDialog = document.getElementById("qrDialog");
						var toolDialog = document.getElementById("toolDialog");
						var mainConfirmDialog = document.getElementById("mainConfirmDialog");
						qrDialog.addEventListener("click", function (event) { if (event.target === qrDialog) closeQR(); });
						toolDialog.addEventListener("click", function (event) { if (event.target === toolDialog) closeToolDialog(); });
						mainConfirmDialog.addEventListener("click", function (event) { if (event.target === mainConfirmDialog) resolveMainConfirm(false); });
						mainConfirmDialog.addEventListener("cancel", function (event) { event.preventDefault(); resolveMainConfirm(false); });
					});

					document.addEventListener("keydown", function (event) {
						if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveContent(); }
						if (event.key === "Escape" && document.getElementById("qrDialog").open) closeQR();
						if (event.key === "Escape" && document.getElementById("toolDialog").open) closeToolDialog();
						if (event.key === "Escape" && document.getElementById("mainConfirmDialog").open) resolveMainConfirm(false);
					});

					window.addEventListener('pagehide', flushEditorWork);
					document.addEventListener('visibilitychange', function () { if (document.hidden) flushEditorWork(); });
					window.addEventListener("beforeunload", function (event) {
						flushEditorWork();
						var textarea = document.getElementById("content");
						if (textarea && textarea.value !== originalContent) {
							event.preventDefault();
							event.returnValue = "";
						}
					});
Object.assign(window, { showQRCode, copySubscription, openDedupePreview, undoLastChange, loadLastSavedVersion, downloadBackup, saveContent, closeQR, closeToolDialog, applyDedupe, resolveMainConfirm });
