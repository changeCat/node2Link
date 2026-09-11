export function jsonResponse(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), { status, headers: {
		'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff', ...extraHeaders
	} });
}

export function textResponse(text, status = 200) {
	return new Response(text, { status, headers: {
		'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
	} });
}

export function requestHasSameOrigin(request, { allowMissing = true } = {}) {
	const origin = request.headers.get('Origin');
	if (!origin) return allowMissing;
	try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export function escapeHTML(value) {
	return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
