import { isValidShareId } from './storage/shares.js';
import { sha256Base64Url, adminPassword } from './auth.js';
import { parseSubConverters, normalizeSublinkConverter } from './adapters/converters.js';

export const DEFAULT_FILE_NAME = 'CF-Workers-SUB';
export const DEFAULT_PAGE_TITLE = DEFAULT_FILE_NAME;
export const LEGACY_DEFAULT_PAGE_TITLE = 'Node2Link';
export const DEFAULT_SUB_UPDATE_TIME = 6;
export const DEFAULT_MAIN_DATA = `
https://cfxr.eu.org/getSub
`;
export const DEFAULT_SUB_CONVERTER = 'https://SUBAPI.cmliussss.net';
export const DEFAULT_SUB_CONFIG = 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini';
export const DEFAULT_BROWSER_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23143f32'/%3E%3Cpath d='M18 42V22h8l12 13V22h8v20h-8L26 29v13z' fill='white'/%3E%3C/svg%3E";
export const SUBSCRIPTION_NO_STORE_HEADERS = {
	'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
	'CDN-Cache-Control': 'no-store',
	'Cloudflare-CDN-Cache-Control': 'no-store',
	Pragma: 'no-cache',
	Expires: '0'
};
export const SUBSCRIPTION_FORMAT_CATALOG = [
	{ name: '智能适配', key: 'sub', icon: 'sparkles', description: '自动识别客户端并返回合适格式', recommended: true },
	{ name: 'Base64', key: 'b64', icon: 'binary', description: '通用 Base64 编码订阅' },
	{ name: 'Clash', key: 'clash', icon: 'layers-3', description: '适用于 Clash 与 Mihomo' },
	{ name: 'Sing-box', key: 'singbox', icon: 'box', description: '适用于 Sing-box 客户端' },
	{ name: 'Surge', key: 'surge', icon: 'waves', description: '适用于 Surge 客户端' },
	{ name: 'QuanX', key: 'quanx', icon: 'atom', description: '适用于 Quantumult X' },
	{ name: 'Loon', key: 'loon', icon: 'orbit', description: '适用于 Loon 客户端' }
];
export const DEFAULT_DISPLAY_FORMATS = ['sub', 'b64', 'clash', 'loon'];
export const SUPPORTED_NODE_PROTOCOLS = ['vless', 'vmess', 'trojan', 'ss', 'ssr', 'hysteria', 'hysteria2', 'hy2', 'tuic', 'wireguard', 'socks', 'socks5'];
export const REMOTE_FETCH_TIMEOUT_MS = 8 * 1000;
export const APP_VERSION = globalThis.__NODE2LINK_VERSION__ || 'dev';

export function isAPISubscriptionEnabled(env) {
	return String(env.API_SUBSCRIPTION_ENABLED || '').trim().toLowerCase() === 'true';
}

export async function createRuntimeConfig(env, persistedSettings = {}) {
	const updateTime = Number(env.SUBUPTIME);
	const persistedCustomConverterURL = normalizeSublinkConverter(persistedSettings.customConverterURL);
	const defaultSubConfig = normalizeHTTPURL(env.SUBCONFIG) || DEFAULT_SUB_CONFIG;
	const migratedSubConfig = normalizeHTTPURL(persistedSettings.subConfig);
	const persistedCustomSubConfigURL = normalizeHTTPURL(persistedSettings.customSubConfigURL)
		|| (!Object.prototype.hasOwnProperty.call(persistedSettings, 'ruleMode') && migratedSubConfig !== defaultSubConfig ? migratedSubConfig : '');
	const ruleMode = (persistedSettings.ruleMode === 'custom' || (!Object.prototype.hasOwnProperty.call(persistedSettings, 'ruleMode') && Boolean(persistedCustomSubConfigURL)))
		&& persistedCustomSubConfigURL ? 'custom' : 'default';
	const storedMainId = isValidShareId(persistedSettings.mainSubscriptionId) ? persistedSettings.mainSubscriptionId : '';
	const configuredMainId = isValidShareId(env.SUBSCRIPTION_ID) ? env.SUBSCRIPTION_ID : '';
	const mainSubscriptionId = storedMainId
		|| configuredMainId
		|| (env.SESSION_SECRET || adminPassword(env) || env.TOKEN
			? (await sha256Base64Url('main:' + (env.SESSION_SECRET || adminPassword(env) || env.TOKEN))).slice(0, 24)
			: '');
	return {
		BotToken: env.TGTOKEN || '',
		ChatID: env.TGID || '',
		FileName: sanitizeSubscriptionName(persistedSettings.subscriptionName || env.SUBNAME || DEFAULT_FILE_NAME),
		pageTitle: sanitizePageTitle(!persistedSettings.pageTitle || persistedSettings.pageTitle === LEGACY_DEFAULT_PAGE_TITLE ? DEFAULT_PAGE_TITLE : persistedSettings.pageTitle),
		SUBUpdateTime: Number.isFinite(updateTime) && updateTime > 0 ? updateTime : DEFAULT_SUB_UPDATE_TIME,
		subConfig: ruleMode === 'custom' ? persistedCustomSubConfigURL : defaultSubConfig,
		defaultSubConfig,
		ruleMode,
		customSubConfigURL: persistedCustomSubConfigURL,
		subConverters: parseSubConverters(env.SUBAPI || DEFAULT_SUB_CONVERTER),
		converterMode: persistedSettings.converterMode === 'custom' && persistedCustomConverterURL ? 'custom' : 'default',
		customConverterURL: persistedCustomConverterURL,
		mainSubscriptionId,
		subscriptionToken: Object.prototype.hasOwnProperty.call(persistedSettings, 'subscriptionToken')
			? sanitizeSubscriptionToken(persistedSettings.subscriptionToken)
			: (Object.prototype.hasOwnProperty.call(persistedSettings, 'legacySubscriptionToken')
				? sanitizeSubscriptionToken(persistedSettings.legacySubscriptionToken)
				: sanitizeSubscriptionToken(env.TOKEN || '')),
		browserIconURL: normalizeBrowserIconURL(persistedSettings.browserIconURL),
		displayFormats: normalizeDisplayFormats(persistedSettings.displayFormats),
		apiSubscriptionEnabled: isAPISubscriptionEnabled(env),
		requestLogEnabled: String(env.REQUESTLOG ?? '1') !== '0'
	};
}

export function sanitizeSubscriptionName(value) {
	const name = String(value || '').trim().replace(/[\r\n\0]/g, '').slice(0, 80);
	return name || DEFAULT_FILE_NAME;
}

export function sanitizePageTitle(value) {
	const title = String(value || '').trim().replace(/[\r\n\0]/g, '').slice(0, 100);
	return title || DEFAULT_PAGE_TITLE;
}

export function normalizeDisplayFormats(value, fallback = DEFAULT_DISPLAY_FORMATS) {
	const allowed = new Set(SUBSCRIPTION_FORMAT_CATALOG.map(item => item.key));
	const formats = Array.isArray(value) ? [...new Set(value.map(item => String(item)).filter(item => allowed.has(item)))] : [];
	return formats.length ? formats : [...fallback];
}

export function sanitizeSubscriptionToken(value) {
	const token = String(value || '').trim();
	return token && token.length <= 128 && !/[\u0000-\u001f\u007f]/.test(token) ? token : '';
}

export function isSubscriptionTokenRequest(url, subscriptionToken) {
	if (!subscriptionToken) return false;
	if (url.searchParams.get('token') === subscriptionToken) return url.pathname === '/';
	if (url.pathname === '/') return false;
	try {
		return !url.pathname.slice(1).includes('/') && decodeURIComponent(url.pathname.slice(1)) === subscriptionToken;
	} catch (error) {
		return false;
	}
}

export function normalizeHTTPURL(value) {
	const input = String(value || '').trim();
	if (!input || input.length > 2048) return '';
	try {
		const parsed = new URL(input);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
	} catch (error) {
		return '';
	}
}

export function normalizeBrowserIconURL(value) {
	const input = String(value || '').trim();
	if (!input || input.length > 65535) return '';
	if (/^data:image\/(?:png|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:;[^,]*)?,/i.test(input)) return input;
	return normalizeHTTPURL(input);
}
