import { adminPassword, toBase64Url } from './auth.js';
import { BASE64_SUBSCRIPTION_USER_AGENT, SUBSCRIPTION_NO_STORE_HEADERS, normalizeHTTPURL } from './config.js';
import { fetchWithTransientRetry, logRemote, REMOTE_FETCH_TIMEOUT_MS } from './adapters/http.js';

const SOURCE_PROXY_PREFIX = '/_node2link/source/';
const SOURCE_PROXY_TTL_MS = 2 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keys = new Map();

function sourceProxySecret(env) {
	return String(env?.SESSION_SECRET || adminPassword(env || {}) || env?.TOKEN || '');
}

function fromBase64Url(value) {
	const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function encryptionKey(env) {
	const secret = sourceProxySecret(env);
	if (!secret) return null;
	if (!keys.has(secret)) {
		keys.set(secret, (async () => {
			const material = await crypto.subtle.digest('SHA-256', encoder.encode('node2link-source-proxy-v1\0' + secret));
			return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
		})());
	}
	return keys.get(secret);
}

export function isSourceProxyRequest(url) {
	const token = url.pathname.slice(SOURCE_PROXY_PREFIX.length);
	return url.pathname.startsWith(SOURCE_PROXY_PREFIX) && /^[A-Za-z0-9_-]{40,8192}$/.test(token);
}

export function canProxySources(env) {
	return Boolean(sourceProxySecret(env));
}

export async function createSourceProxyURL(env, origin, sourceURL, { now = Date.now(), ttlMs = SOURCE_PROXY_TTL_MS } = {}) {
	const normalized = normalizeHTTPURL(sourceURL);
	const key = await encryptionKey(env);
	if (!normalized || !key) throw new Error('Source proxy is unavailable');
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const payload = encoder.encode(JSON.stringify({ expiresAt: now + ttlMs, url: normalized }));
	const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));
	const token = new Uint8Array(iv.length + encrypted.length);
	token.set(iv);
	token.set(encrypted, iv.length);
	return String(origin).replace(/\/+$/, '') + SOURCE_PROXY_PREFIX + toBase64Url(token);
}

export async function readSourceProxyURL(env, token, now = Date.now()) {
	try {
		if (!/^[A-Za-z0-9_-]{40,8192}$/.test(String(token || ''))) return '';
		const key = await encryptionKey(env);
		const packed = fromBase64Url(token);
		if (!key || packed.length < 29) return '';
		const payload = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12));
		const parsed = JSON.parse(decoder.decode(payload));
		if (!Number.isFinite(parsed?.expiresAt) || parsed.expiresAt < now) return '';
		return normalizeHTTPURL(parsed.url);
	} catch {
		return '';
	}
}

export async function handleSourceProxy(request, env, url = new URL(request.url)) {
	if (request.method !== 'GET') return new Response('Not Found', { status: 404, headers: SUBSCRIPTION_NO_STORE_HEADERS });
	const token = url.pathname.slice(SOURCE_PROXY_PREFIX.length);
	const sourceURL = await readSourceProxyURL(env, token);
	if (!sourceURL) return new Response('Not Found', { status: 404, headers: SUBSCRIPTION_NO_STORE_HEADERS });
	try {
		const headers = new Headers({
			Accept: request.headers.get('Accept') || '*/*',
			'User-Agent': BASE64_SUBSCRIPTION_USER_AGENT + ' converter-source-proxy'
		});
		const response = await fetchWithTransientRetry(new Request(sourceURL, { headers, redirect: 'follow', signal: request.signal }), {}, REMOTE_FETCH_TIMEOUT_MS);
		if (!response.ok) {
			logRemote('source_proxy.response', sourceURL, { status: response.status });
			return new Response('Upstream subscription unavailable', { status: 502, headers: SUBSCRIPTION_NO_STORE_HEADERS });
		}
		const responseHeaders = new Headers(SUBSCRIPTION_NO_STORE_HEADERS);
		responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'text/plain; charset=utf-8');
		return new Response(response.body, { status: 200, headers: responseHeaders });
	} catch (error) {
		logRemote('source_proxy.failed', sourceURL, { type: error.name || 'Error' });
		return new Response('Upstream subscription unavailable', { status: 502, headers: SUBSCRIPTION_NO_STORE_HEADERS });
	}
}
