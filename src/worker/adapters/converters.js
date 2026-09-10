import { fetchWithTimeout, logRemote } from './http.js';
import { DEFAULT_SUB_CONVERTER, REMOTE_FETCH_TIMEOUT_MS } from '../config.js';
export function parseSubConverters(value) {
	const converters = String(value || DEFAULT_SUB_CONVERTER)
		.split(/[\n,;]+/)
		.map(item => item.trim())
		.filter(Boolean)
		.map(item => /^https?:\/\//i.test(item) ? item : 'https://' + item)
		.map(item => item.replace(/\/+$/, ''));
	return [...new Set(converters.length ? converters : [DEFAULT_SUB_CONVERTER])];
}

export function normalizeSublinkConverter(value) {
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

export function supportsSublinkTarget(target) {
	return ['base64', 'clash', 'singbox', 'surge'].includes(target);
}

export function createSublinkURL(converter, target, sourceURL) {
	const sources = String(sourceURL || '').split('|').map(item => item.trim()).filter(Boolean).join('\n');
	const params = new URLSearchParams({ config: sources });
	return converter + '/' + (target === 'base64' ? 'xray' : target) + '?' + params.toString();
}

export function createNoStoreFetchInit(init = {}) {
	const headers = new Headers(init.headers || {});
	headers.set('Cache-Control', 'no-store, no-cache, max-age=0');
	headers.set('Pragma', 'no-cache');
	return { ...init, cache: 'no-store', headers };
}

export async function fetchSublinkSubscription(converter, target, sourceURL, init, options = {}) {
	try {
		const response = await fetchWithTimeout(createSublinkURL(converter, target, sourceURL), createNoStoreFetchInit(init), options.timeoutMs || REMOTE_FETCH_TIMEOUT_MS, options);
		if (response.ok) return { response, converter };
		logRemote('converter.response', converter, { status: response.status });
	} catch (error) {
		logRemote('converter.failed', converter, { type: error.name });
	}
	return null;
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
	const deadline = Date.now() + (options.timeoutMs || REMOTE_FETCH_TIMEOUT_MS);
	for (const converter of converters) {
		try {
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			const attemptBudget = converters.length === 1 ? remaining : Math.min(remaining, options.attemptTimeoutMs || 3000);
			const response = await fetchWithTimeout(createSubConverterURL(converter, target, sourceURL, configURL), createNoStoreFetchInit(init), attemptBudget, options);
			if (response.ok) return { response, converter };
			logRemote('converter.response', converter, { status: response.status });
		} catch (error) {
			logRemote('converter.failed', converter, { type: error.name });
		}
	}
	return null;
}
