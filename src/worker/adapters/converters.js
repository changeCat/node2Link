import { fetchWithTimeout, logRemote } from './http.js';
import { CONVERTER_FETCH_TIMEOUT_MS, DEFAULT_SUB_CONVERTER } from '../config.js';
import { base64Decode, isValidBase64 } from '../domain/nodes.js';
export function parseSubConverters(value) {
	const converters = String(value || DEFAULT_SUB_CONVERTER)
		.split(/[\n,;]+/)
		.map(item => item.trim())
		.filter(Boolean)
		.map(item => /^https?:\/\//i.test(item) ? item : 'https://' + item)
		.map(item => item.replace(/\/+$/, ''));
	return [...new Set(converters.length ? converters : [DEFAULT_SUB_CONVERTER])];
}

export function normalizeCustomConverter(value) {
	if (!value || String(value).length > 2048) return '';
	try {
		const url = new URL(String(value).trim());
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/+$/, '');
	} catch (error) {
		return '';
	}
}

export function converterOrigin(converter) {
	try { return new URL(converter).origin; } catch { return ''; }
}

export function createNoStoreFetchInit(init = {}) {
	const headers = new Headers(init.headers || {});
	headers.set('Cache-Control', 'no-store, no-cache, max-age=0');
	headers.set('Pragma', 'no-cache');
	return { ...init, cache: 'no-store', headers };
}

export async function fetchCustomSubscription(converter, target, sourceURL, init, options = {}) {
	const startedAt = Date.now();
	try {
		const requestURL = createSubConverterURL(converter, target === 'base64' ? 'mixed' : target, sourceURL, options.configURL || '');
		const response = await fetchWithTimeout(requestURL, createNoStoreFetchInit(init), options.conversionTimeoutMs || options.timeoutMs || CONVERTER_FETCH_TIMEOUT_MS, { ...options, discardErrorBody: true });
		if (response.ok) {
			// Missing endpoints can return HTTP 200 websites or JSON errors.
			const content = await response.text();
			if (isConvertedContent(content, target)) {
				logRemote('converter.complete', converter, { target, durationMs: Date.now() - startedAt });
				return { response: new Response(content, response), converter };
			}
			logRemote('converter.invalid_content', converter, { target, durationMs: Date.now() - startedAt });
		} else logRemote('converter.response', converter, { status: response.status, target, durationMs: Date.now() - startedAt });
	} catch (error) {
		logRemote('converter.failed', converter, { type: error.name, target, durationMs: Date.now() - startedAt });
	}
	return null;
}

function isConvertedContent(content, target) {
	const text = content.trim();
	if (!text || text.startsWith('<')) return false;
	if (target === 'base64') return isValidBase64(text) && base64Decode(text).includes('://');
	if (target === 'loon' || target === 'surge') return /^\s*\[Proxy\]\s*$/im.test(text)
		|| /^\s*[^#;\r\n=]+\s*=\s*(?:shadowsocksr?|ss|vmess|vless|trojan|http|https|socks5|wireguard|hysteria2|anytls|tuic|snell)\s*,/im.test(text);
	if (target === 'quanx') return /^\s*\[server_local\]\s*$/im.test(text)
		|| /^\s*(?:shadowsocks|vmess|trojan|http|socks5)\s*=.+/im.test(text);
	if (target === 'clash' && /^\s*(?:proxies|proxy-providers)\s*:/m.test(text)) return true;
	try {
		const parsed = JSON.parse(text);
		if (target === 'singbox') return Array.isArray(parsed?.outbounds);
		if (target === 'clash') return Array.isArray(parsed?.proxies) || Boolean(parsed?.['proxy-providers']);
	} catch {}
	return false;
}

export function createSubConverterURL(converter, target, sourceURL, configURL) {
	const params = new URLSearchParams({
		target, url: sourceURL, insert: 'false', config: configURL, emoji: 'true', list: 'false',
		tfo: 'false', scv: 'true', fdn: 'false', sort: 'false'
	});
	if (target === 'surge') params.set('ver', '4');
	if (target === 'quanx') params.set('udp', 'true');
	if (target !== 'loon' && target !== 'quanx') params.set('new_name', 'true');
	return converter + '/sub?' + params.toString();
}

export async function fetchConvertedSubscription(converters, target, sourceURL, configURL, init, options = {}) {
	const deadline = Date.now() + (options.conversionTimeoutMs || options.timeoutMs || CONVERTER_FETCH_TIMEOUT_MS);
	for (const converter of converters) {
		const startedAt = Date.now();
		try {
			const remaining = deadline - Date.now();
			if (remaining <= 0 || init.signal?.aborted) break;
			const attemptBudget = converters.length === 1 ? remaining : Math.min(remaining, options.attemptTimeoutMs || 20000);
			const response = await fetchWithTimeout(createSubConverterURL(converter, target, sourceURL, configURL), createNoStoreFetchInit(init), attemptBudget, { ...options, discardErrorBody: true });
			if (response.ok) {
				logRemote('converter.complete', converter, { target, durationMs: Date.now() - startedAt });
				return { response, converter };
			}
			logRemote('converter.response', converter, { status: response.status, target, durationMs: Date.now() - startedAt });
		} catch (error) {
			logRemote('converter.failed', converter, { type: error.name, target, durationMs: Date.now() - startedAt });
		}
	}
	return null;
}
