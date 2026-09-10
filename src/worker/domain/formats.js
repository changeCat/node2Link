const FORMATS = [['b64', 'base64'], ['base64', 'base64'], ['sb', 'singbox'], ['singbox', 'singbox'], ['surge', 'surge'], ['quanx', 'quanx'], ['loon', 'loon'], ['clash', 'clash']];

export function selectSubscriptionFormat(url, userAgent, converterRequest = false) {
	if (converterRequest) return 'base64';
	for (const [key, format] of FORMATS) if (url.searchParams.has(key)) return format;
	const ua = String(userAgent || '').toLowerCase();
	if (ua.includes('nekobox') || ua.includes('cf-workers-sub')) return 'base64';
	if (ua.includes('sing-box') || ua.includes('singbox')) return 'singbox';
	if (ua.includes('surge')) return 'surge';
	if (ua.includes('quantumult')) return 'quanx';
	if (ua.includes('loon')) return 'loon';
	if (ua.includes('clash') || ua.includes('meta') || ua.includes('mihomo')) return 'clash';
	return 'base64';
}
