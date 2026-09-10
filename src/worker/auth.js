const SESSION_COOKIE = 'node2link_session';
const SESSION_TTL = 7 * 24 * 60 * 60;
export function adminUsername(env) {
	return String(env.ADMIN_USERNAME || env.USERNAME || 'admin').slice(0, 100);
}

export function adminPassword(env) {
	return String(env.ADMIN_PASSWORD || env.PASSWORD || '');
}

export function sessionSecret(env) {
	return String(env.SESSION_SECRET || adminPassword(env) || 'node2link-unconfigured');
}

export function toBase64Url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Base64Url(value) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
	return toBase64Url(new Uint8Array(digest));
}

export async function hmacBase64Url(value, secret) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(String(secret)),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(value)));
	return toBase64Url(new Uint8Array(signature));
}

export function safeEqual(left, right) {
	const a = String(left || '');
	const b = String(right || '');
	let difference = a.length ^ b.length;
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
	return difference === 0;
}

export function readCookie(request, name) {
	const cookieHeader = request.headers.get('Cookie') || '';
	for (const part of cookieHeader.split(';')) {
		const separator = part.indexOf('=');
		if (separator < 0) continue;
		if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
	}
	return '';
}

export async function createSessionCookie(env) {
	const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
	const payload = adminUsername(env) + '.' + expires;
	const signature = await hmacBase64Url(payload, await sessionSigningKey(env));
	return `${SESSION_COOKIE}=${encodeURIComponent(payload + '.' + signature)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Strict`;
}

// Bind sessions to current credentials even when SESSION_SECRET is fixed.
// This key never leaves the Worker; cookies contain only the payload/signature.
async function sessionSigningKey(env) {
	return hmacBase64Url(JSON.stringify(['node2link-session-v2', adminUsername(env), adminPassword(env)]), sessionSecret(env));
}

export function clearSessionCookie() {
	return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function isAuthenticated(request, env) {
	if (!adminPassword(env)) return false;
	let raw = '';
	try { raw = decodeURIComponent(readCookie(request, SESSION_COOKIE) || ''); }
	catch (error) { return false; }
	const lastDot = raw.lastIndexOf('.');
	if (lastDot < 1) return false;
	const payload = raw.slice(0, lastDot);
	const signature = raw.slice(lastDot + 1);
	const split = payload.lastIndexOf('.');
	if (split < 1) return false;
	const username = payload.slice(0, split);
	const expires = Number(payload.slice(split + 1));
	if (username !== adminUsername(env) || !Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
	return safeEqual(signature, await hmacBase64Url(payload, await sessionSigningKey(env)));
}
