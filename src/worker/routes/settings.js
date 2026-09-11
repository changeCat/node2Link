import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { saveSettingsSections } from '../storage/settings.js';
import { StorageError } from '../storage/kv.js';
import { readJSONBody, BODY_LIMITS, RequestBodyError } from '../request-body.js';
import { normalizeSublinkConverter } from '../adapters/converters.js';
import { sanitizeSubscriptionName, sanitizePageTitle, normalizeBrowserIconURL, sanitizeSubscriptionToken, normalizeHTTPURL, normalizeDisplayFormats, DEFAULT_FILE_NAME, DEFAULT_PAGE_TITLE, DEFAULT_DISPLAY_FORMATS } from '../config.js';

export async function saveSettings(request, env, currentSettings) {
	if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
	try {
		const payload = await readJSONBody(request, BODY_LIMITS.settings);
		const allowedSections = ['display', 'entry', 'conversion', 'clients'];
		const section = payload.section === undefined || payload.section === 'all'
			? 'all' : allowedSections.includes(payload.section) ? payload.section : '';
		if (!section) return jsonResponse({ ok: false, message: '设置分区不存在' }, 400);
		const settings = { ...currentSettings };

		if (section === 'display' || section === 'all') {
			settings.subscriptionName = sanitizeSubscriptionName(payload.subscriptionName ?? currentSettings.subscriptionName ?? env.SUBNAME ?? DEFAULT_FILE_NAME);
			const storedPageTitle = payload.pageTitle ?? currentSettings.pageTitle ?? DEFAULT_PAGE_TITLE;
			settings.pageTitle = sanitizePageTitle(storedPageTitle);
			const browserIconInput = String(payload.browserIconURL ?? currentSettings.browserIconURL ?? '').trim();
			settings.browserIconURL = normalizeBrowserIconURL(browserIconInput);
			if (browserIconInput && !settings.browserIconURL) return jsonResponse({ ok: false, message: '请输入有效的标签页图标地址（HTTP、HTTPS 或 data:image）' }, 400);
		}

		if (section === 'entry' || section === 'all') {
			const tokenInput = String(payload.subscriptionToken ?? currentSettings.subscriptionToken ?? env.TOKEN ?? '').trim();
			settings.subscriptionToken = sanitizeSubscriptionToken(tokenInput);
			if (tokenInput && !settings.subscriptionToken) return jsonResponse({ ok: false, message: '订阅入口 Token 不能包含控制字符，且不能超过 128 个字符' }, 400);
		}

		if (section === 'conversion' || section === 'all') {
			settings.converterMode = payload.converterMode === 'custom' ? 'custom' : 'default';
			settings.customConverterURL = normalizeSublinkConverter(payload.customConverterURL ?? currentSettings.customConverterURL);
			const customSubConfigInput = String(payload.customSubConfigURL ?? currentSettings.customSubConfigURL ?? '').trim();
			settings.customSubConfigURL = normalizeHTTPURL(customSubConfigInput);
			settings.ruleMode = payload.ruleMode === 'custom' ? 'custom' : 'default';
			if (settings.converterMode === 'custom' && !settings.customConverterURL) return jsonResponse({ ok: false, message: '请输入有效的自建转换服务地址' }, 400);
			if (settings.ruleMode === 'custom' && !settings.customSubConfigURL) return jsonResponse({ ok: false, message: '请输入有效的自建规则配置地址（HTTP 或 HTTPS）' }, 400);
			if (customSubConfigInput && !settings.customSubConfigURL) return jsonResponse({ ok: false, message: '自建规则配置地址无效，请使用 HTTP 或 HTTPS 地址' }, 400);
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
		return jsonResponse({ ok: false, message: '保存失败：' + error.message }, error instanceof StorageError ? 503 : error instanceof RequestBodyError ? error.status : 400);
	}
}
