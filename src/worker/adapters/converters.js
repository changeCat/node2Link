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

export const converterTypeLabel = type => type === 'sublink' ? 'Sublink Worker' : 'Subconverter';
export function createSublinkURL(converter, target, sourceURL) {
 const config = String(sourceURL || '').split('|').map(value => value.trim()).filter(Boolean).join('\n');
 return converter + '/' + (target === 'base64' ? 'xray' : target) + '?' + new URLSearchParams({ config });
}

export function readCustomConverterProfiles(settings = {}) {
 if (Array.isArray(settings.customConverters)) return settings.customConverters.slice(0, 10).map(item => ({
  id: String(item?.id || ''), name: String(item?.name || '').slice(0, 60),
  type: item?.type === 'sublink' ? 'sublink' : 'subconverter', url: normalizeCustomConverter(item?.url)
 })).filter(item => item.id);
 const url = normalizeCustomConverter(settings.customConverterURL);
 return url ? [{ id: 'legacy', name: '自建转换', type: settings.customConverterType === 'sublink' ? 'sublink' : 'subconverter', url }] : [];
}

export async function fetchCustomSubscription(converter, target, sourceURL, init, options = {}) {
 const startedAt = Date.now();
 const fail = (reason, audit) => { options.onFailure?.({ reason, audit }); return null; };
 const type = options.converterType || 'subconverter';
 if (!converter) return fail('地址未配置或无效');
 if (init.signal?.aborted) return fail('请求已取消');
 try {
  const requestURL = type === 'sublink' ? createSublinkURL(converter, target, sourceURL)
   : createSubConverterURL(converter, target === 'base64' ? 'mixed' : target, sourceURL, options.configURL || '');
  const response = await fetchWithTimeout(requestURL, createNoStoreFetchInit(init), options.conversionTimeoutMs || options.timeoutMs || CONVERTER_FETCH_TIMEOUT_MS, { ...options, discardErrorBody: true });
  if (!response.ok) {
   logRemote('converter.response', converter, { status: response.status, target, durationMs: Date.now() - startedAt });
   return fail('HTTP ' + response.status);
  }
  const content = await response.text();
  if (!isConvertedContent(content, target)) {
   logRemote('converter.invalid_content', converter, { target, durationMs: Date.now() - startedAt });
   return fail('返回内容为空或格式无效');
  }
  const audit = options.validateContent?.(content);
  if (audit?.check === 'incomplete') {
   logRemote('converter.incomplete', converter, { target, inputNodes: audit.inputCount, outputNodes: audit.outputCount, missingProtocols: audit.missing });
   return fail('缺少 ' + audit.missing.map(item => item.protocol.toUpperCase() + ' ' + item.count + ' 个').join('、'), audit);
  }
  logRemote('converter.complete', converter, { target, durationMs: Date.now() - startedAt });
  return { response: new Response(content, response), converter, audit };
 } catch (error) {
  logRemote('converter.failed', converter, { type: error.name, target, durationMs: Date.now() - startedAt });
  return fail(init.signal?.aborted ? '请求已取消' : error.name === 'TimeoutError' ? '请求超时' : '请求失败');
 }
}

function isConvertedContent(content, target) {
	const text = content.trim();
	if (!text || text.startsWith('<')) return false;
	if (target === 'base64' || target === 'mixed') return isValidBase64(text) && base64Decode(text).includes('://');
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
		fdn: 'false', sort: 'false'
	});
	if (target === 'surge') params.set('ver', '4');
	if (target === 'quanx') params.set('udp', 'true');
	if (target !== 'loon' && target !== 'quanx') params.set('new_name', 'true');
	return converter + '/sub?' + params.toString();
}

export async function fetchConvertedSubscription(converters, target, sourceURL, configURL, init, options = {}) {
 const deadline = Date.now() + (options.conversionTimeoutMs || options.timeoutMs || CONVERTER_FETCH_TIMEOUT_MS);
 for (const converter of converters) {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || init.signal?.aborted) break;
  const result = await fetchCustomSubscription(converter, target, sourceURL, init, { ...options,
   converterType: 'subconverter', configURL,
   conversionTimeoutMs: converters.length === 1 ? remaining : Math.min(remaining, options.attemptTimeoutMs || 20000)
  });
  if (result) return result;
 }
 return null;
}
