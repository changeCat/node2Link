import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { saveSettingsSections } from '../storage/settings.js';
import { StorageError } from '../storage/kv.js';
import { normalizeSublinkConverter } from '../adapters/converters.js';
import { sanitizeSubscriptionName, sanitizePageTitle, normalizeBrowserIconURL, sanitizeSubscriptionToken, normalizeHTTPURL, normalizeDisplayFormats, DEFAULT_FILE_NAME, DEFAULT_PAGE_TITLE, LEGACY_DEFAULT_PAGE_TITLE, DEFAULT_SUB_CONFIG, DEFAULT_DISPLAY_FORMATS } from '../config.js';

export async function saveSettings(request, env, currentSettings) {
	if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	try {
		const payload = await request.json();
		const section = ['display', 'entry', 'conversion', 'clients'].includes(payload.section) ? payload.section : 'all';
		const settings = { ...currentSettings };

		if (section === 'display' || section === 'all') {
			settings.subscriptionName = sanitizeSubscriptionName(payload.subscriptionName ?? currentSettings.subscriptionName ?? env.SUBNAME ?? DEFAULT_FILE_NAME);
			const storedPageTitle = payload.pageTitle ?? currentSettings.pageTitle ?? DEFAULT_PAGE_TITLE;
			settings.pageTitle = sanitizePageTitle(!Object.prototype.hasOwnProperty.call(payload, 'pageTitle') && storedPageTitle === LEGACY_DEFAULT_PAGE_TITLE ? DEFAULT_PAGE_TITLE : storedPageTitle);
			const browserIconInput = String(payload.browserIconURL ?? currentSettings.browserIconURL ?? '').trim();
			settings.browserIconURL = normalizeBrowserIconURL(browserIconInput);
			if (browserIconInput && !settings.browserIconURL) return jsonResponse({ ok: false, message: '请输入有效的标签页图标地址（HTTP、HTTPS 或 data:image）' }, 400);
		}

		if (section === 'entry' || section === 'all') {
			const tokenInput = String(payload.subscriptionToken ?? payload.legacySubscriptionToken ?? currentSettings.subscriptionToken ?? currentSettings.legacySubscriptionToken ?? env.TOKEN ?? '').trim();
			settings.subscriptionToken = sanitizeSubscriptionToken(tokenInput);
			if (tokenInput && !settings.subscriptionToken) return jsonResponse({ ok: false, message: '订阅入口 Token 不能包含控制字符，且不能超过 128 个字符' }, 400);
			delete settings.legacySubscriptionToken;
		}

		if (section === 'conversion' || section === 'all') {
			settings.converterMode = payload.converterMode === 'custom' ? 'custom' : 'default';
			settings.customConverterURL = normalizeSublinkConverter(payload.customConverterURL ?? currentSettings.customConverterURL);
			const defaultSubConfig = normalizeHTTPURL(env.SUBCONFIG) || DEFAULT_SUB_CONFIG;
			const customSubConfigInput = String(payload.customSubConfigURL ?? payload.subConfig ?? currentSettings.customSubConfigURL ?? currentSettings.subConfig ?? '').trim();
			settings.customSubConfigURL = normalizeHTTPURL(customSubConfigInput);
			settings.ruleMode = payload.ruleMode === 'custom'
				|| (!Object.prototype.hasOwnProperty.call(payload, 'ruleMode') && settings.customSubConfigURL && settings.customSubConfigURL !== defaultSubConfig)
				? 'custom' : 'default';
			if (settings.converterMode === 'custom' && !settings.customConverterURL) return jsonResponse({ ok: false, message: '请输入有效的自建转换服务地址' }, 400);
			if (settings.ruleMode === 'custom' && !settings.customSubConfigURL) return jsonResponse({ ok: false, message: '请输入有效的自建规则配置地址（HTTP 或 HTTPS）' }, 400);
			if (customSubConfigInput && !settings.customSubConfigURL) return jsonResponse({ ok: false, message: '自建规则配置地址无效，请使用 HTTP 或 HTTPS 地址' }, 400);
			delete settings.subConfig;
		}

		if (section === 'clients' || section === 'all') {
			const displayFormats = normalizeDisplayFormats(payload.displayFormats ?? currentSettings.displayFormats ?? DEFAULT_DISPLAY_FORMATS, []);
			if (!displayFormats.length) return jsonResponse({ ok: false, message: '请至少保留一种客户端订阅格式' }, 400);
			settings.displayFormats = displayFormats;
		}

		settings.savedAt = new Date().toISOString();
		await saveSettingsSections(env.KV, settings, section);
		return jsonResponse({ ok: true, section, settings });
	} catch (error) {
		return jsonResponse({ ok: false, message: '保存失败：' + error.message }, error instanceof StorageError ? 503 : 400);
	}
}
