import { DEFAULT_DISPLAY_FORMATS, SUBSCRIPTION_FORMAT_CATALOG, SUPPORTED_NODE_PROTOCOLS } from '../config.js';
import { escapeHTML } from '../http.js';
import { assetURL, basePageStyles, pageScript } from './assets.js';
import { renderTopbar, renderFavicon } from './pages.js';
export function renderMainPage(request, runtime, record, hasKV) {
	const url = new URL(request.url);
		const content = record.content;
		let savedMetadata = record.metadata;
		if (!savedMetadata) {
			savedMetadata = {
				savedAt: "",
				bytes: new TextEncoder().encode(content).length,
				lines: content ? content.split(/\r?\n/).length : 0
			};
		}

		const origin = url.origin;
		const ownerBase = runtime.subscriptionToken
			? origin + "/" + encodeURIComponent(runtime.subscriptionToken)
			: origin + "/s/" + encodeURIComponent(runtime.mainSubscriptionId);
		const converterListHTML = runtime.subConverters.map((converter, index) =>
			`<span class="converter-entry"><b>${index === 0 ? "主" : "备" + index}</b><code title="${escapeHTML(converter)}">${escapeHTML(converter)}</code></span>`
		).join("");
		const activeConverterHTML = runtime.converterMode === 'custom'
			? `<span class="converter-entry"><b>自建</b><code title="${escapeHTML(runtime.customConverterURL)}">${escapeHTML(runtime.customConverterURL)}</code></span>`
			: converterListHTML;
		const formats = runtime.displayFormats
			.map((key) => SUBSCRIPTION_FORMAT_CATALOG.find((item) => item.key === key))
			.filter(Boolean);

		const renderSubscriptions = () => formats.map((format) => {
			const subscriptionURL = ownerBase + (format.key === "sub" ? "" : "?" + format.key);
			return `
				<article class="subscription-card" data-default-url="${escapeHTML(subscriptionURL)}">
					<div class="subscription-head">
						<span class="format-icon"><i data-lucide="${format.icon}"></i></span>
						<div><h3>${format.name}${format.recommended ? '<span class="badge">推荐</span>' : ""}</h3><p>${format.description}</p></div>
					</div>
					<div class="link-row">
						<code class="subscription-url" title="${escapeHTML(subscriptionURL)}">${escapeHTML(subscriptionURL)}</code>
						<button class="icon-button" type="button" data-url="${escapeHTML(subscriptionURL)}" onclick="showQRCode(this)" aria-label="显示二维码" title="显示二维码"><i data-lucide="qr-code"></i></button>
						<button class="copy-button" type="button" data-url="${escapeHTML(subscriptionURL)}" onclick="copySubscription(this)"><i data-lucide="copy"></i><span>复制</span></button>
					</div>
				</article>`;
		}).join("");

		const html = `
			<!DOCTYPE html>
			<html lang="zh-CN">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1">
				<meta name="color-scheme" content="light">
				<meta name="theme-color" content="#f5f6f3">
				<title>${escapeHTML(runtime.pageTitle)}</title>
				${renderFavicon(runtime.browserIconURL)}
				<style>
					${basePageStyles()}
					:root {
						color-scheme: light;
						font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
						--bg: #f5f6f3; --surface: #ffffff; --surface-soft: #f8faf7; --text: #17211d;
						--muted: #68736d; --line: #dfe4de; --line-soft: #edf0ec; --green: #176b49;
						--green-dark: #105239; --green-soft: #e8f3ed; --amber: #996515; --amber-soft: #fff5da;
						--danger: #b13a36; --shadow: 0 12px 36px rgba(26, 46, 35, .07);
					}
					* { box-sizing: border-box; }
					html { scroll-behavior: smooth; }
					body { margin: 0; min-width: 320px; background: var(--bg); color: var(--text); }
					button, input, textarea { font: inherit; }
					button { letter-spacing: 0; }
					button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid rgba(23, 107, 73, .2); outline-offset: 2px; }
					main { width: calc(100% - 48px); margin: 0 auto; padding: 18px 0 48px; }
					.token-chip { max-width: 360px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 12px; }
					.token-chip svg { flex: 0 0 auto; width: 16px; height: 16px; color: var(--green); }
					.token-chip code { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
					.section { margin-top: 38px; }
					.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
					.section-heading h2 { margin: 0; font-size: 19px; }
					.section-heading p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
					.workspace-grid { display: grid; grid-template-columns: 230px minmax(0, 1fr) 330px; grid-template-areas: "config main sidebar"; gap: 16px; align-items: start; }
					.workspace-config, .workspace-main, .workspace-sidebar { min-width: 0; }
					.workspace-config { grid-area: config; }
					.workspace-main { grid-area: main; }
					.workspace-sidebar { grid-area: sidebar; }
					.workspace-grid .section { margin-top: 0; }
					.workspace-sidebar { display: flex; flex-direction: column; gap: 26px; }
					.workspace-sidebar > .guest-panel { margin-top: 0; }
					.workspace-sidebar .subscription-grid { grid-template-columns: 1fr; gap: 10px; }
					.workspace-sidebar .compact-subscription-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
					.workspace-sidebar .subscription-card { padding: 14px; }
					.workspace-sidebar .subscription-head { min-height: 42px; }
					.workspace-sidebar .format-icon { width: 34px; height: 34px; }
					.workspace-sidebar .link-row { margin-top: 11px; }
					.compact-subscription-grid .subscription-card { padding: 12px; }
					.compact-subscription-grid .subscription-head { gap: 8px; min-height: 34px; }
					.compact-subscription-grid .format-icon { width: 32px; height: 32px; }
					.compact-subscription-grid .format-icon svg { width: 17px; height: 17px; }
					.compact-subscription-grid .subscription-head h3 { margin-top: 0; font-size: 13px; }
					.compact-subscription-grid .subscription-head p, .compact-subscription-grid .link-row code { display: none; }
					.compact-subscription-grid .link-row { grid-template-columns: minmax(0, 1fr) 34px; }
					.compact-subscription-grid .link-row .copy-button { grid-column: 1; grid-row: 1; }
					.compact-subscription-grid .link-row .icon-button { grid-column: 2; grid-row: 1; }
					.subscription-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
					.subscription-card { min-width: 0; padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 3px 12px rgba(26, 46, 35, .025); }
					.subscription-head { display: flex; gap: 12px; min-height: 48px; }
					.format-icon { flex: 0 0 auto; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 7px; background: var(--green-soft); color: var(--green); }
					.format-icon svg { width: 19px; height: 19px; }
					.subscription-head h3 { display: flex; align-items: center; gap: 8px; margin: 1px 0 4px; font-size: 14px; }
					.subscription-head p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
					.badge { padding: 2px 6px; border-radius: 4px; background: var(--amber-soft); color: var(--amber); font-size: 10px; font-weight: 800; }
					.link-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 34px auto; gap: 7px; margin-top: 15px; }
					.link-row code { min-width: 0; height: 34px; display: block; overflow: hidden; padding: 8px 10px; border: 1px solid var(--line-soft); border-radius: 6px; background: var(--surface-soft); color: #46514b; font: 11px/16px ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
					.icon-button, .copy-button, .primary-button { border: 0; border-radius: 6px; cursor: pointer; transition: background .16s ease, transform .16s ease, opacity .16s ease; }
					.icon-button { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--line); background: var(--surface); color: var(--muted); }
					.icon-button svg { width: 16px; height: 16px; }
					.copy-button, .primary-button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; background: var(--green); color: #fff; font-size: 12px; font-weight: 750; }
					.copy-button svg, .primary-button svg { width: 15px; height: 15px; }
					.icon-button:hover { background: var(--surface-soft); color: var(--green); }
					.copy-button:hover, .primary-button:hover { background: var(--green-dark); }
					.icon-button:active, .copy-button:active, .primary-button:active { transform: translateY(1px); }
					details.guest-panel { margin-top: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
					details.guest-panel > summary { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 18px; cursor: pointer; list-style: none; font-weight: 750; }
					details.guest-panel > summary::-webkit-details-marker { display: none; }
					.summary-label { display: flex; align-items: center; gap: 10px; }
					.summary-label svg { width: 18px; color: var(--green); }
					.summary-meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; font-weight: 500; }
					.summary-meta svg { width: 16px; transition: transform .18s ease; }
					details[open] .summary-meta svg { transform: rotate(180deg); }
					.guest-body { padding: 0 18px 18px; border-top: 1px solid var(--line-soft); }
					.guest-note { display: flex; align-items: flex-start; gap: 10px; margin: 16px 0; padding: 12px; border: 1px solid #ead9ae; border-radius: 6px; background: var(--amber-soft); color: #75521b; font-size: 12px; line-height: 1.55; }
					.guest-note svg { flex: 0 0 auto; width: 17px; margin-top: 1px; }
					.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); }
					.setting { min-width: 0; padding: 18px; }
					.setting + .setting { border-left: 1px solid var(--line-soft); }
					.setting-label { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--muted); font-size: 12px; font-weight: 700; }
					.setting-label svg { width: 15px; color: var(--green); }
					.setting code { display: block; overflow: hidden; color: var(--text); font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
					.converter-list { display: flex; flex-direction: column; gap: 7px; }
					.converter-entry { min-width: 0; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 7px; }
					.converter-entry b { padding: 2px 4px; border-radius: 4px; background: var(--green-soft); color: var(--green); font-size: 10px; text-align: center; }
					.converter-picker { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
					.converter-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
					.converter-option { display: flex; align-items: flex-start; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
					.converter-option:has(input:checked) { border-color: #8bc5a7; background: var(--green-soft); }
					.converter-option input { margin: 3px 0 0; accent-color: var(--green); }
					.converter-option strong, .converter-option small { display: block; }
					.converter-option strong { font-size: 12px; }
					.converter-option small { margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.4; }
					.custom-converter-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-top: 10px; }
					.custom-converter-row input { min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
					.custom-converter-row input:focus { border-color: #72ad90; outline: 3px solid rgba(23, 107, 73, .12); }
					.converter-help { margin: 9px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
					.converter-help strong { color: var(--green); }
					.converter-picker + .settings-grid { margin-top: 10px; }
					.workspace-config .converter-options, .workspace-config .custom-converter-row, .workspace-config .settings-grid { grid-template-columns: 1fr; }
					.workspace-config .custom-converter-row .tool-button { width: 100%; }
					.workspace-config .setting + .setting { border-top: 1px solid var(--line-soft); border-left: 0; }
					.request-list { max-height: 360px; border: 1px solid var(--line); border-radius: 8px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; background: var(--surface); }
					.request-client { min-width: 0; padding: 12px 14px; }
					.request-client + .request-client { border-top: 1px solid var(--line-soft); }
					.request-client-head, .request-client-meta, .request-access { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
					.request-client-head strong { font-size: 13px; }
					.request-client-head > span { flex: 0 0 auto; padding: 2px 7px; border-radius: 999px; background: var(--green-soft); color: var(--green-dark); font-size: 10px; font-weight: 800; }
					.request-client-meta { margin-top: 5px; color: var(--muted); font-size: 10px; }
					.request-client-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
					.request-client-meta time { flex: 0 0 auto; }
					.request-client code { display: block; margin-top: 7px; overflow: hidden; color: #53605a; font: 10px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
					.request-access { justify-content: flex-start; margin-top: 6px; color: var(--muted); font-size: 9px; }
					.request-empty { padding: 22px 14px; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); font-size: 12px; text-align: center; }
					.editor-shell { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); box-shadow: var(--shadow); }
					.editor-toolbar { min-height: 54px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 18px; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); }
					.editor-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; color: var(--muted); font-size: 12px; }
					.editor-meta span { display: inline-flex; align-items: center; gap: 6px; }
					.editor-meta svg { width: 14px; }
					.editor-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; }
					.save-state { color: var(--muted); }
					.save-state.dirty { color: var(--amber); }
					.save-state.error { color: var(--danger); }
					.tool-button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 11px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px; font-weight: 700; }
					.tool-button:hover { background: var(--surface-soft); color: var(--green); }
					.tool-button:disabled { cursor: not-allowed; opacity: .45; }
					.tool-button svg { width: 15px; height: 15px; }
					.primary-button { min-height: 36px; padding: 0 15px; }
					.primary-button:disabled { cursor: wait; opacity: .64; }
					.editor-insights { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--line-soft); background: var(--surface); }
					.metric { min-width: 0; padding: 11px 14px; }
					.metric + .metric { border-left: 1px solid var(--line-soft); }
					.metric span { display: block; color: var(--muted); font-size: 11px; }
					.metric strong { display: block; margin-top: 3px; font-size: 16px; }
					.validation-panel { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); background: var(--surface-soft); }
					.validation-status { display: flex; align-items: center; gap: 8px; color: var(--green); font-size: 12px; font-weight: 700; }
					.validation-status.has-issues { color: var(--danger); }
					.validation-status svg { width: 15px; height: 15px; }
					.protocol-breakdown { flex: 1; color: var(--muted); font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; text-align: center; }
					.validation-issues { max-width: 65%; color: var(--danger); font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; text-align: right; }
					.editor { width: 100%; height: calc(100vh - 300px); min-height: 560px; max-height: 760px; display: block; resize: vertical; margin: 0; padding: 18px; border: 0; background: #fbfcfa; color: #25312b; font: 13px/1.75 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
					.empty-state { padding: 34px; border: 1px dashed #ccd3cc; border-radius: 8px; background: rgba(255,255,255,.6); text-align: center; }
					.empty-state svg { width: 30px; height: 30px; margin-bottom: 8px; color: var(--amber); }
					.empty-state h3 { margin: 0 0 7px; font-size: 15px; }
					.empty-state p { margin: 0; color: var(--muted); font-size: 13px; }
					.page-footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 46px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
					.page-footer a { color: var(--green); text-decoration: none; }
					dialog { width: min(92vw, 360px); padding: 0; border: 0; border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: 0 28px 80px rgba(14, 34, 24, .25); }
					dialog::backdrop { background: rgba(15, 28, 21, .48); backdrop-filter: blur(3px); }
					dialog.tool-dialog { width: min(92vw, 480px); }
					.dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 15px 16px; border-bottom: 1px solid var(--line-soft); }
					.dialog-head strong { font-size: 14px; }
					.dialog-body { padding: 22px; text-align: center; }
					.tool-dialog .dialog-body { text-align: left; }
					.preview-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
					.preview-summary span { padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-soft); color: var(--muted); font-size: 11px; }
					.preview-summary strong { display: block; margin-top: 3px; color: var(--text); font-size: 18px; }
					.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
					#qrcode { min-height: 220px; display: grid; place-items: center; }
					#qrcode img, #qrcode canvas { max-width: 100%; height: auto; padding: 8px; border: 1px solid var(--line-soft); border-radius: 6px; }
					.qr-url { margin: 14px 0 0; overflow-wrap: anywhere; color: var(--muted); font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
					.toast { position: fixed; z-index: 10; left: 50%; bottom: 24px; max-width: calc(100vw - 32px); display: flex; align-items: center; gap: 9px; padding: 10px 14px; border-radius: 6px; background: #17211d; color: #fff; box-shadow: 0 10px 28px rgba(20, 35, 27, .22); font-size: 13px; opacity: 0; pointer-events: none; transform: translate(-50%, 12px); transition: opacity .2s ease, transform .2s ease; }
					.toast.show { opacity: 1; transform: translate(-50%, 0); }
					.toast svg { width: 16px; color: #62d297; }
					@media (max-width: 1180px) {
						.workspace-grid { grid-template-columns: 230px minmax(0, 1fr); grid-template-areas: "config main" "sidebar sidebar"; }
						.workspace-sidebar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
					}
					@media (max-width: 980px) {
						.workspace-grid { grid-template-columns: 1fr; grid-template-areas: "main" "config" "sidebar"; }
						.workspace-sidebar { display: flex; }
					}
					@media (max-width: 760px) {
						main { padding-top: 14px; }
						.workspace-sidebar .subscription-grid { grid-template-columns: 1fr; }
						.workspace-sidebar .compact-subscription-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
						.subscription-grid, .settings-grid { grid-template-columns: 1fr; }
						.setting + .setting { border-top: 1px solid var(--line-soft); border-left: 0; }
						.editor-insights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
						.metric:nth-child(3) { border-top: 1px solid var(--line-soft); border-left: 0; }
						.metric:nth-child(4) { border-top: 1px solid var(--line-soft); }
						.validation-panel { display: block; }
						.protocol-breakdown { display: block; margin-top: 6px; text-align: left; }
						.validation-issues { max-width: none; margin-top: 6px; text-align: left; }
						.page-footer { flex-direction: column; }
					}
					@media (max-width: 480px) {
						.workspace-sidebar .compact-subscription-grid { grid-template-columns: 1fr; }
						.subscription-card { padding: 15px; }
						.link-row { grid-template-columns: minmax(0, 1fr) 34px 40px; }
						.copy-button { width: 40px; padding: 0; }
						.copy-button span { display: none; }
						.summary-meta span { display: none; }
						.editor-toolbar { align-items: flex-start; }
						.editor-meta { flex-direction: column; align-items: flex-start; gap: 5px; }
						.editor-actions { width: 100%; justify-content: flex-start; }
						.editor-actions .primary-button { margin-left: auto; }
						.editor { height: 56vh; min-height: 430px; padding: 14px; }
					}
					@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
				</style>
				<script src="${assetURL('qrcode-loader.js')}" defer></script>
				<script src="${assetURL('lucide.js')}" defer></script>
			</head>
			<body>
				${renderTopbar('home', runtime)}
				<main>
					<div class="workspace-grid">
						<aside class="workspace-config" aria-label="当前转换信息">
							<section class="section" aria-labelledby="converter-info-title">
								<div class="section-heading"><div><h2 id="converter-info-title">转换信息</h2><p>配置请前往设置页面修改</p></div></div>
								<div class="settings-grid">
									<div class="setting"><span class="setting-label"><i data-lucide="server-cog"></i>当前转换后端</span><div class="converter-list">${activeConverterHTML}</div></div>
									<div class="setting"><span class="setting-label"><i data-lucide="file-cog"></i>规则配置</span><code title="${escapeHTML(runtime.subConfig)}">${escapeHTML(runtime.subConfig)}</code></div>
								</div>
								<a class="tool-button" href="/settings" style="width:100%;margin-top:10px;text-decoration:none"><i data-lucide="settings"></i><span>前往设置</span></a>
							</section>
						</aside>

						<section class="section workspace-main" aria-labelledby="editor-title">
							<div class="section-heading"><div><h2 id="editor-title">节点与订阅源</h2><p>每行填写一个节点链接或订阅地址</p></div></div>
							${hasKV ? `
							<div class="editor-shell">
								<div class="editor-toolbar">
									<div class="editor-meta">
										<span><i data-lucide="list"></i><b id="lineCount">0</b> 行</span>
										<span id="saveStatus" class="save-state">已同步</span>
										<span><i data-lucide="clock-3"></i><span id="lastSaved" data-saved-at="${escapeHTML(savedMetadata.savedAt || "")}">读取中</span></span>
									</div>
									<div class="editor-actions">
										<button class="tool-button" type="button" onclick="openDedupePreview()"><i data-lucide="list-checks"></i><span>去重</span></button>
										<button class="tool-button" id="undoButton" type="button" onclick="undoLastChange()" disabled><i data-lucide="undo-2"></i><span>撤销</span></button>
										<button class="tool-button" type="button" onclick="loadLastSavedVersion()"><i data-lucide="history"></i><span>上次版本</span></button>
										<button class="tool-button" type="button" onclick="downloadBackup()"><i data-lucide="download"></i><span>备份</span></button>
										<button class="tool-button" type="button" onclick="document.getElementById('restoreInput').click()"><i data-lucide="upload"></i><span>导入</span></button>
										<input id="restoreInput" type="file" accept=".txt,.conf,.list,text/plain" hidden>
										<button class="primary-button" id="saveButton" type="button" onclick="saveContent()"><i data-lucide="save"></i><span>保存更改</span></button>
									</div>
								</div>
								<div class="editor-insights" aria-label="内容统计">
									<div class="metric"><span>节点</span><strong id="nodeCount">0</strong></div>
									<div class="metric"><span>订阅源</span><strong id="sourceCount">0</strong></div>
									<div class="metric"><span>重复</span><strong id="duplicateCount">0</strong></div>
									<div class="metric"><span>格式问题</span><strong id="issueCount">0</strong></div>
								</div>
								<div class="validation-panel">
									<span class="validation-status" id="validationStatus"><i data-lucide="circle-check"></i><span>格式检查通过</span></span>
									<span class="protocol-breakdown" id="protocolBreakdown">暂无节点协议</span>
									<span class="validation-issues" id="validationIssues"></span>
								</div>
								<textarea class="editor" id="content" spellcheck="false" placeholder="vless://...&#10;https://example.com/sub">${escapeHTML(content)}</textarea>
							</div>` : `
							<div class="empty-state"><i data-lucide="database-zap"></i><h3>尚未绑定 KV 命名空间</h3><p>请在 Cloudflare 中绑定变量名为 KV 的命名空间后再编辑订阅源。</p></div>`}
						</section>

						<aside class="workspace-sidebar" aria-label="主订阅入口">
							<section class="section" aria-labelledby="owner-title">
								<div class="section-heading"><div><h2 id="owner-title">我的订阅</h2><p>复制链接，或扫码导入客户端</p></div></div>
								<div class="subscription-grid compact-subscription-grid">${renderSubscriptions(false)}</div>
							</section>

						</aside>
					</div>

					<footer class="page-footer"><span><a href="https://github.com/changeCat/node2Link" target="_blank" rel="noopener noreferrer">node2Link</a> · <a href="https://github.com/cmliu/CF-Workers-SUB" target="_blank" rel="noopener noreferrer">Forked from CF-Workers-SUB</a></span><span>当前设备：${escapeHTML(request.headers.get("User-Agent") || "Unknown")}</span></footer>
				</main>

				<dialog id="qrDialog" aria-labelledby="qrTitle">
					<div class="dialog-head"><strong id="qrTitle">扫描二维码导入</strong><button class="icon-button" type="button" onclick="closeQR()" aria-label="关闭" title="关闭"><i data-lucide="x"></i></button></div>
					<div class="dialog-body"><div id="qrcode"></div><p class="qr-url" id="qrUrl"></p></div>
				</dialog>
				<dialog id="toolDialog" class="tool-dialog" aria-labelledby="toolDialogTitle">
					<div class="dialog-head"><strong id="toolDialogTitle">整理节点与订阅源</strong><button class="icon-button" type="button" onclick="closeToolDialog()" aria-label="关闭" title="关闭"><i data-lucide="x"></i></button></div>
					<div class="dialog-body">
						<p id="dedupeDescription">将删除空行并合并完全重复的链接，原内容不会立即写入 KV。</p>
						<div class="preview-summary"><span>原始行数<strong id="previewBefore">0</strong></span><span>重复行<strong id="previewDuplicates">0</strong></span><span>整理后<strong id="previewAfter">0</strong></span></div>
						<div class="dialog-actions"><button class="tool-button" type="button" onclick="closeToolDialog()">取消</button><button class="primary-button" id="applyDedupeButton" type="button" onclick="applyDedupe()"><i data-lucide="list-checks"></i><span>应用整理</span></button></div>
					</div>
				</dialog>
				<dialog id="mainConfirmDialog" class="tool-dialog" aria-labelledby="mainConfirmTitle">
					<div class="dialog-head"><strong id="mainConfirmTitle">请确认操作</strong><button class="icon-button" type="button" onclick="resolveMainConfirm(false)" aria-label="关闭" title="关闭"><i data-lucide="x"></i></button></div>
					<div class="dialog-body"><p id="mainConfirmText"></p><div class="dialog-actions"><button class="tool-button" type="button" onclick="resolveMainConfirm(false)">取消</button><button class="primary-button" type="button" onclick="resolveMainConfirm(true)"><span>确认</span></button></div></div>
				</dialog>
				<div class="toast" id="toast" role="status" aria-live="polite"><i data-lucide="circle-check"></i><span id="toastText">已复制</span></div>

				${pageScript('home', { savedMetadata, supportedProtocols: SUPPORTED_NODE_PROTOCOLS })}
			</body>
			</html>`;

		return new Response(html, {
			headers: {
				"Content-Type": "text/html;charset=utf-8",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff"
			}
		});
}
