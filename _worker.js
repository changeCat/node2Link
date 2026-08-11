
// 管理端使用账号密码登录；订阅通过不可猜测的 /s/<id> 链接访问。

const DEFAULT_FILE_NAME = 'CF-Workers-SUB';
const DEFAULT_PAGE_TITLE = DEFAULT_FILE_NAME;
const LEGACY_DEFAULT_PAGE_TITLE = 'Node2Link';
const DEFAULT_SUB_UPDATE_TIME = 6;
const DEFAULT_MAIN_DATA = `
https://cfxr.eu.org/getSub
`;
const DEFAULT_SUB_CONVERTER = 'https://SUBAPI.cmliussss.net';
const DEFAULT_SUB_CONFIG = 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini';
const DEFAULT_BROWSER_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23143f32'/%3E%3Cpath d='M18 42V22h8l12 13V22h8v20h-8L26 29v13z' fill='white'/%3E%3C/svg%3E";
const SETTINGS_KEY = 'NODE2LINK.settings.json';
const SHARE_INDEX_KEY = 'NODE2LINK.shares.json';
const SHARE_KEY_PREFIX = 'NODE2LINK.share.';
const SESSION_COOKIE = 'node2link_session';
const SESSION_TTL = 7 * 24 * 60 * 60;
const REQUEST_LOG_PREFIX = 'NODE2LINK.request.';
const REQUEST_LOG_TTL = 30 * 24 * 60 * 60;
const REQUEST_LOG_LIMIT = 5000;
const subscriptionNotificationCache = new Map();
const subscriptionNotificationCooldown = 10 * 1000;

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const persistedSettings = await readPersistedSettings(env);
		const runtime = await createRuntimeConfig(env, persistedSettings);

		if (request.method === 'GET' && isSubscriptionTokenRequest(url, runtime.subscriptionToken)) {
			const mainData = env.KV ? (await env.KV.get('LINK.txt') || DEFAULT_MAIN_DATA) : (env.LINK || DEFAULT_MAIN_DATA);
			return serveSubscription(request, env, ctx, runtime, mainData, 'main', true, runtime.mainSubscriptionId);
		}

		const shareMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{12,64})$/);
		if (shareMatch && request.method === 'GET') {
			const shareId = shareMatch[1];
			if (shareId === runtime.mainSubscriptionId) {
				const mainData = env.KV ? (await env.KV.get('LINK.txt') || DEFAULT_MAIN_DATA) : (env.LINK || DEFAULT_MAIN_DATA);
				return serveSubscription(request, env, ctx, runtime, mainData, 'main', true, runtime.mainSubscriptionId);
			}
			if (!env.KV) return textResponse('分享链接不存在', 404);
			const shared = await readShare(env.KV, shareId);
			if (!shared) return textResponse('分享链接不存在或已被删除', 404);
			return serveSubscription(request, env, ctx, runtime, shared.content, 'share', false, shareId);
		}

		if (url.pathname === '/api/login' && request.method === 'POST') return handleLogin(request, env, runtime);
		if (url.pathname === '/login' && request.method === 'GET') {
			if (await isAuthenticated(request, env)) return Response.redirect(url.origin + '/', 303);
			return renderLoginPage(env, runtime);
		}

		if (!(await isAuthenticated(request, env))) {
			if (url.pathname.startsWith('/api/')) return jsonResponse({ ok: false, message: '登录已失效' }, 401);
			return Response.redirect(url.origin + '/login', 303);
		}

		if (url.pathname === '/api/logout' && request.method === 'POST') {
			if (!requestHasSameOrigin(request)) return textResponse('请求来源无效', 403);
			return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': clearSessionCookie() } });
		}
		if (url.pathname === '/api/settings' && request.method === 'POST') return saveSettings(request, env, persistedSettings);
		if (url.pathname === '/api/shares') return handleSharesAPI(request, env, url);
		if (url.pathname === '/settings' && request.method === 'GET') return renderSettingsPage(request, runtime);
		if (url.pathname === '/shares' && request.method === 'GET') return renderSharesPage(request, env, runtime);
		if (url.pathname === '/requests' && request.method === 'GET') return renderRequestsPage(request, env, runtime);
		if (url.pathname !== '/') return textResponse('页面不存在', 404);
		if (!env.KV) return KV(request, env, 'LINK.txt', runtime.mainSubscriptionId, runtime);

		await 迁移地址列表(env, 'LINK.txt');
		if (request.method === 'GET' || request.method === 'POST') {
			return KV(request, env, 'LINK.txt', runtime.mainSubscriptionId, runtime);
		}
		return textResponse('Method Not Allowed', 405);
	}
};

async function serveSubscription(request, env, ctx, runtime, sourceData, access, includeWarp, subscriptionId = '') {
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : 'null';
		const url = new URL(request.url);
		const customSublinkConverter = runtime.converterMode === 'custom'
			? runtime.customConverterURL
			: (!env.KV ? normalizeSublinkConverter(url.searchParams.get('converter')) : '');

		let mainData = sourceData || '';
		let urls = [];
		if (access === 'main' && !env.KV && env.LINKSUB) urls = await ADD(env.LINKSUB);

		const allLinks = await ADD(mainData + '\n' + urls.join('\n'));
		let selfBuiltNodes = '';
		let subscriptionLinks = '';
		for (const link of allLinks) {
			if (link.toLowerCase().startsWith('http')) subscriptionLinks += link + '\n';
			else selfBuiltNodes += link + '\n';
		}
		mainData = selfBuiltNodes;
		urls = await ADD(subscriptionLinks);

		const isSubConverterRequest = request.headers.get('subconverter-request')
			|| request.headers.get('subconverter-version')
			|| userAgent.includes('subconverter');
		if (!isSubConverterRequest && request.method === 'GET' && shouldSendSubscriptionNotification(request)) {
			queueTelegram(ctx, sendMessage(runtime, `#获取订阅 ${runtime.FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgentHeader}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`));
		}

		let subscriptionFormat = 'base64';
		if (!(userAgent.includes('null') || isSubConverterRequest || userAgent.includes('nekobox') || userAgent.includes('cf-workers-sub'))) {
			if (userAgent.includes('sing-box') || userAgent.includes('singbox') || url.searchParams.has('sb') || url.searchParams.has('singbox')) subscriptionFormat = 'singbox';
			else if (userAgent.includes('surge') || url.searchParams.has('surge')) subscriptionFormat = 'surge';
			else if (userAgent.includes('quantumult') || url.searchParams.has('quanx')) subscriptionFormat = 'quanx';
			else if (userAgent.includes('loon') || url.searchParams.has('loon')) subscriptionFormat = 'loon';
			else if (userAgent.includes('clash') || userAgent.includes('meta') || userAgent.includes('mihomo') || url.searchParams.has('clash')) subscriptionFormat = 'clash';
		}

		const sourceBaseURL = access === 'main'
			? `${url.origin}/s/${encodeURIComponent(runtime.mainSubscriptionId)}`
			: url.origin + url.pathname;
		let converterSourceURL = sourceBaseURL + '?base64';
		let requestData = mainData;
		let appendUA = 'v2rayn';
		let usedConverter = '';
		if (url.searchParams.has('b64') || url.searchParams.has('base64')) subscriptionFormat = 'base64';
		else if (url.searchParams.has('clash')) appendUA = 'clash';
		else if (url.searchParams.has('singbox')) appendUA = 'singbox';
		else if (url.searchParams.has('surge')) appendUA = 'surge';
		else if (url.searchParams.has('quanx')) appendUA = 'Quantumult%20X';
		else if (url.searchParams.has('loon')) appendUA = 'Loon';

		if (!isSubConverterRequest && request.method === 'GET' && runtime.requestLogEnabled) {
			queueSubscriptionRequestLog(ctx, env, {
				client: detectSubscriptionClient(userAgentHeader),
				userAgent: userAgentHeader || 'Unknown',
				format: subscriptionFormat,
				access,
				subscriptionId
			});
		}

		const uniqueSubscriptionLinks = [...new Set(urls)].filter(item => item?.trim?.());
		if (uniqueSubscriptionLinks.length > 0) {
			const subscriptionResponses = await getSUB(uniqueSubscriptionLinks, request, appendUA, userAgentHeader);
			requestData += subscriptionResponses[0].join('\n');
			converterSourceURL += '|' + subscriptionResponses[1];
			if (subscriptionFormat === 'base64' && !isSubConverterRequest && subscriptionResponses[1].includes('://')) {
				const mixedResult = await fetchConvertedSubscription(runtime.subConverters, 'mixed', subscriptionResponses[1], runtime.subConfig, {
					headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB (https://github.com/cmliu/CF-Workers-SUB)' }
				});
				if (mixedResult) {
					try {
						requestData += '\n' + atob(await mixedResult.response.text());
						usedConverter = mixedResult.converter;
					} catch (error) {
						console.log('订阅转换返回的 Base64 内容无效:', error.message);
					}
				}
			}
		}

		if (includeWarp && env.WARP) converterSourceURL += '|' + (await ADD(env.WARP)).join('|');
		const text = new TextDecoder().decode(new TextEncoder().encode(requestData));
		const result = [...new Set(text.split('\n'))].join('\n');
		let base64Data;
		try { base64Data = btoa(result); }
		catch (error) { base64Data = encodeBase64(result); }

		const responseHeaders = {
			'content-type': 'text/plain; charset=utf-8',
			'Profile-Update-Interval': `${runtime.SUBUpdateTime}`,
			'Profile-web-page-url': sourceBaseURL,
			'Profile-Title': `base64:${encodeBase64(runtime.FileName)}`
		};
		if (!userAgent.includes('mozilla')) {
			responseHeaders['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(runtime.FileName)}`;
		}
		if (usedConverter) responseHeaders['X-Subconverter-Used'] = usedConverter;
		if (subscriptionFormat === 'base64') return new Response(base64Data, { headers: responseHeaders });

		const conversionInit = { headers: { 'User-Agent': userAgentHeader || 'CF-Workers-SUB' } };
		const conversionResult = customSublinkConverter && supportsSublinkTarget(subscriptionFormat)
			? await fetchSublinkSubscription(customSublinkConverter, subscriptionFormat, converterSourceURL, conversionInit)
			: await fetchConvertedSubscription(runtime.subConverters, subscriptionFormat, converterSourceURL, runtime.subConfig, conversionInit);
		if (!conversionResult) return new Response(base64Data, { headers: responseHeaders });

		responseHeaders['X-Subconverter-Used'] = conversionResult.converter;
		let convertedContent = await conversionResult.response.text();
		if (subscriptionFormat === 'clash') convertedContent = await clashFix(convertedContent);
		return new Response(convertedContent, { headers: responseHeaders });
	}

async function createRuntimeConfig(env, persistedSettings = {}) {
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
		|| (env.KV ? createShareId() : (await sha256Base64Url('main:' + sessionSecret(env))).slice(0, 24));
	if (env.KV && storedMainId !== mainSubscriptionId) {
		persistedSettings = { ...persistedSettings, mainSubscriptionId };
		await env.KV.put(SETTINGS_KEY, JSON.stringify(persistedSettings));
	}
	return {
		BotToken: env.TGTOKEN || '',
		ChatID: env.TGID || '',
		TG: Number(env.TG || 0),
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
		requestLogEnabled: String(env.REQUESTLOG ?? '1') !== '0'
	};
}

async function readPersistedSettings(env) {
	if (!env.KV) return {};
	try {
		const value = await env.KV.get(SETTINGS_KEY);
		const parsed = value ? JSON.parse(value) : {};
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch (error) {
		console.error('读取持久化设置时发生错误:', error);
		return {};
	}
}

function adminUsername(env) {
	return String(env.ADMIN_USERNAME || env.USERNAME || 'admin').slice(0, 100);
}

function adminPassword(env) {
	return String(env.ADMIN_PASSWORD || env.PASSWORD || '');
}

function sessionSecret(env) {
	return String(env.SESSION_SECRET || adminPassword(env) || 'node2link-unconfigured');
}

function sanitizeSubscriptionName(value) {
	const name = String(value || '').trim().replace(/[\r\n\0]/g, '').slice(0, 80);
	return name || DEFAULT_FILE_NAME;
}

function sanitizePageTitle(value) {
	const title = String(value || '').trim().replace(/[\r\n\0]/g, '').slice(0, 100);
	return title || DEFAULT_PAGE_TITLE;
}

function sanitizeSubscriptionToken(value) {
	const token = String(value || '').trim();
	return token && token.length <= 128 && !/[\u0000-\u001f\u007f]/.test(token) ? token : '';
}

function isSubscriptionTokenRequest(url, subscriptionToken) {
	if (!subscriptionToken) return false;
	if (url.searchParams.get('token') === subscriptionToken) return url.pathname === '/';
	if (url.pathname === '/') return false;
	try {
		return !url.pathname.slice(1).includes('/') && decodeURIComponent(url.pathname.slice(1)) === subscriptionToken;
	} catch (error) {
		return false;
	}
}

function normalizeHTTPURL(value) {
	const input = String(value || '').trim();
	if (!input || input.length > 2048) return '';
	try {
		const parsed = new URL(input);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
	} catch (error) {
		return '';
	}
}

function normalizeBrowserIconURL(value) {
	const input = String(value || '').trim();
	if (!input || input.length > 65535) return '';
	if (/^data:image\/(?:png|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:;[^,]*)?,/i.test(input)) return input;
	return normalizeHTTPURL(input);
}

function renderFavicon(browserIconURL = '') {
	return `<link rel="icon" href="${escapeHTML(browserIconURL || DEFAULT_BROWSER_ICON)}">`;
}

function escapeHTML(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
	});
}

function textResponse(text, status = 200) {
	return new Response(text, { status, headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store' } });
}

function requestHasSameOrigin(request) {
	const origin = request.headers.get('Origin');
	return !origin || origin === new URL(request.url).origin;
}

function toBase64Url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(value) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
	return toBase64Url(new Uint8Array(digest));
}

async function hmacBase64Url(value, secret) {
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

function safeEqual(left, right) {
	const a = String(left || '');
	const b = String(right || '');
	let difference = a.length ^ b.length;
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
	return difference === 0;
}

function readCookie(request, name) {
	const cookieHeader = request.headers.get('Cookie') || '';
	for (const part of cookieHeader.split(';')) {
		const separator = part.indexOf('=');
		if (separator < 0) continue;
		if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
	}
	return '';
}

async function createSessionCookie(env) {
	const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
	const payload = adminUsername(env) + '.' + expires;
	const signature = await hmacBase64Url(payload, sessionSecret(env));
	return `${SESSION_COOKIE}=${encodeURIComponent(payload + '.' + signature)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Strict`;
}

function clearSessionCookie() {
	return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

async function isAuthenticated(request, env) {
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
	return safeEqual(signature, await hmacBase64Url(payload, sessionSecret(env)));
}

async function handleLogin(request, env, runtime) {
	if (!requestHasSameOrigin(request)) return textResponse('Invalid origin', 403);
	const configuredPassword = adminPassword(env);
	if (!configuredPassword) return renderLoginPage(env, runtime, '尚未配置 ADMIN_PASSWORD，登录已禁用。');
	let username = '';
	let password = '';
	const contentType = request.headers.get('Content-Type') || '';
	if (contentType.includes('application/json')) {
		const body = await request.json();
		username = body.username;
		password = body.password;
	} else {
		const form = await request.formData();
		username = form.get('username');
		password = form.get('password');
	}
	if (!safeEqual(username, adminUsername(env)) || !safeEqual(password, configuredPassword)) {
		return renderLoginPage(env, runtime, '用户名或密码错误。', 401);
	}
	return new Response(null, {
		status: 303,
		headers: { Location: '/', 'Set-Cookie': await createSessionCookie(env), 'Cache-Control': 'no-store' }
	});
}

function basePageStyles() {
	return `
		:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17211d;background:#f5f6f3;--green:#176b49;--green-dark:#105239;--green-soft:#e8f3ed;--muted:#68736d;--line:#dfe4de;--line-soft:#edf0ec;--surface:#fff;--danger:#b42318}
		*{box-sizing:border-box}body{margin:0;min-width:320px;background:#f5f6f3;color:#17211d}button,input,textarea{font:inherit}a{color:inherit}
		.app-header{border-bottom:1px solid var(--line);background:rgba(255,255,255,.92)}.header-inner{width:calc(100% - 48px);min-height:82px;margin:0 auto;display:flex;align-items:center;gap:22px}.header-overview{min-width:0;flex:0 1 420px}.header-overview .eyebrow{margin:0 0 2px;color:var(--green);font-size:9px;font-weight:800;text-transform:uppercase}.header-overview h1{margin:0;font-size:23px;line-height:1.12}.header-overview .intro-copy{margin:3px 0 0;overflow:hidden;color:var(--muted);font-size:12px;line-height:1.4;text-overflow:ellipsis;white-space:nowrap}.header-tabs{align-self:stretch;display:flex;align-items:stretch;gap:4px}.header-tabs a{position:relative;display:inline-flex;align-items:center;padding:0 16px;color:var(--muted);font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap}.header-tabs a:hover{color:var(--green)}.header-tabs a.active{color:var(--green-dark)}.header-tabs a.active::after{content:"";position:absolute;right:10px;bottom:-1px;left:10px;height:3px;border-radius:3px 3px 0 0;background:var(--green)}.header-actions{flex:0 0 auto;margin-left:auto;display:flex;align-items:center;gap:12px}.header-nav{display:flex;align-items:center;gap:4px}.header-nav a,.header-nav button{min-height:34px;display:inline-flex;align-items:center;gap:5px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:12px;text-decoration:none;white-space:nowrap;cursor:pointer}.header-nav a:hover,.header-nav a.active,.header-nav button:hover{background:var(--green-soft);color:var(--green)}.header-nav svg{width:14px;height:14px}.header-nav form{display:flex;margin:0}.online{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid #cce4d6;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:12px;font-weight:700;white-space:nowrap}.online::before{content:"";width:7px;height:7px;border-radius:50%;background:#21a464;box-shadow:0 0 0 3px rgba(33,164,100,.13)}
		main{width:calc(100% - 48px);max-width:1440px;margin:26px auto;padding:0}.page-head{margin-bottom:22px}.page-head h1{margin:0 0 7px;font-size:28px}.page-head p{margin:0;color:var(--muted)}.panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px;box-shadow:0 8px 28px rgba(26,46,35,.04)}.field{display:grid;gap:7px;margin-bottom:18px}.field label{font-size:13px;font-weight:700}.field small{color:var(--muted)}input[type=text],input[type=password],input[type=url],textarea{width:100%;border:1px solid #ccd6ce;border-radius:8px;background:#fff;padding:11px 12px;color:#17211d}textarea{min-height:190px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;line-height:1.55}input:focus,textarea:focus{outline:3px solid rgba(23,107,73,.12);border-color:#72ad90}.button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:10px 15px;cursor:pointer}.button.primary{background:var(--green);border-color:var(--green);color:#fff}.button.danger{color:var(--danger);border-color:#f2c6c2}.button:disabled{opacity:.55;cursor:wait}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.message{padding:11px 13px;border-radius:8px;margin-bottom:18px;background:#fff2f0;color:#9b2319;border:1px solid #facdc8}.success{color:var(--green)}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.muted{color:var(--muted)}
		@media(max-width:1040px){.header-overview .intro-copy{display:none}.header-inner{gap:14px}.header-tabs a{padding:0 10px}.header-nav a,.header-nav button{padding:0 7px}}
		@media(max-width:760px){.header-inner,main{width:calc(100% - 28px)}.header-inner{flex-wrap:wrap;gap:0 12px;padding:9px 0}.header-overview{order:1;flex:0 0 100%;padding:0 0 7px;border-bottom:1px solid var(--line-soft)}.header-tabs{order:2;width:100%;min-height:42px;border-bottom:1px solid var(--line-soft)}.header-tabs a{padding:0 14px}.header-actions{order:3;margin-left:0;width:100%;padding-top:8px;justify-content:space-between}.header-overview .eyebrow,.header-overview .intro-copy{display:none}.header-overview h1{font-size:20px}.header-nav{max-width:calc(100vw - 62px);overflow-x:auto}.online{width:9px;height:9px;padding:0;border:0;font-size:0;background:#21a464;box-shadow:0 0 0 4px rgba(33,164,100,.13)}.online::before{display:none}main{margin-top:18px}.panel{padding:17px}}`;
}

function renderTopbar(active) {
	const settingsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1A1.7 1.7 0 0 0 2.5 13.6H2.4V9.6h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.66 3.8l.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 10 2.5v-.1h4v.1a1.7 1.7 0 0 0 1 1.7 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1Z"/></svg>`;
	const link = (href, label, key, icon = '') => `<a href="${href}"${active === key ? ' class="active"' : ''}>${icon}${label}</a>`;
	return `<header class="app-header"><div class="header-inner"><section class="header-overview" aria-label="订阅控制台"><p class="eyebrow">Overview</p><h1>订阅控制台</h1><p class="intro-copy">在一个入口中管理节点来源，并为常用客户端生成对应格式的订阅地址。</p></section><nav class="header-tabs" aria-label="订阅管理">${link('/', '主订阅', 'home')}${link('/shares', '分享管理', 'shares')}${link('/requests', '订阅请求', 'requests')}</nav><div class="header-actions"><nav class="header-nav" aria-label="管理导航">${link('/settings', '设置', 'settings', settingsIcon)}<form action="/api/logout" method="post"><button type="submit">退出</button></form></nav><span class="online">服务正常</span></div></div></header>`;
}

function renderLoginPage(env, runtime, error = '', status = 200) {
	const missing = !adminPassword(env);
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · ${escapeHTML(runtime?.pageTitle || DEFAULT_PAGE_TITLE)}</title>${renderFavicon(runtime?.browserIconURL)}<style>${basePageStyles()}.login-wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.login-card{width:min(420px,100%)}.login-title{margin:0 0 7px}.login-copy{margin:0 0 24px;color:var(--muted)}</style></head><body><div class="login-wrap"><main class="login-card"><section class="panel"><h1 class="login-title">登录订阅控制台</h1><p class="login-copy">输入管理员账号后访问节点与分享管理。</p>${error ? `<div class="message">${escapeHTML(error)}</div>` : ''}${missing && !error ? '<div class="message">请先在 Cloudflare 中设置 ADMIN_PASSWORD 环境变量。</div>' : ''}<form action="/api/login" method="post"><div class="field"><label for="username">用户名</label><input id="username" name="username" type="text" autocomplete="username" required autofocus></div><div class="field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><button class="button primary" type="submit"${missing ? ' disabled' : ''}>登录</button></form></section></main></div></body></html>`;
	return new Response(html, { status, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' } });
}

async function saveSettings(request, env, currentSettings) {
	if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	try {
		const payload = await request.json();
		const section = ['display', 'entry', 'conversion'].includes(payload.section) ? payload.section : 'all';
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

		settings.savedAt = new Date().toISOString();
		await env.KV.put(SETTINGS_KEY, JSON.stringify(settings));
		return jsonResponse({ ok: true, section, settings });
	} catch (error) {
		return jsonResponse({ ok: false, message: '保存失败：' + error.message }, 500);
	}
}

function renderSettingsPage(_request, runtime) {
	const converters = runtime.subConverters.map((item, index) => `<li><b>${index ? '备用 ' + index : '默认'}</b> <code>${escapeHTML(item)}</code></li>`).join('');
	const initial = JSON.stringify({ subscriptionName: runtime.FileName, pageTitle: runtime.pageTitle, browserIconURL: runtime.browserIconURL, subscriptionToken: runtime.subscriptionToken, converterMode: runtime.converterMode, customConverterURL: runtime.customConverterURL, ruleMode: runtime.ruleMode, customSubConfigURL: runtime.customSubConfigURL }).replace(/</g, '\\u003c');
	const defaultIcon = JSON.stringify(DEFAULT_BROWSER_ICON);
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>设置 · ${escapeHTML(runtime.pageTitle)}</title>${renderFavicon(runtime.browserIconURL)}<style>${basePageStyles()}
		.settings-form{display:grid;gap:18px}.settings-section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px;box-shadow:0 8px 28px rgba(26,46,35,.04)}.settings-section-head{margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid var(--line-soft)}.settings-section-head h2{margin:0 0 5px;font-size:19px}.settings-section-head p{margin:0;color:var(--muted);font-size:13px}.settings-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.settings-fields .field{margin-bottom:20px}.field.full{grid-column:1/-1}.conversion-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:26px}.config-column{min-width:0}.config-column>.field:last-child{margin-bottom:0}.choice{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.choice label{min-width:0;display:flex;align-items:flex-start;gap:9px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;cursor:pointer}.choice label:has(input:checked){border-color:#8bc5a7;background:var(--green-soft)}.choice input{margin-top:3px;accent-color:var(--green)}.choice strong,.choice small{display:block}.choice small{margin-top:3px;font-weight:400;line-height:1.45}.icon-control{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;align-items:center}.icon-preview{width:48px;height:48px;display:grid;place-items:center;overflow:hidden;border:1px solid var(--line);border-radius:9px;background:#f8faf7}.icon-preview img{width:34px;height:34px;object-fit:contain}.service-list{margin:0;padding:12px 14px 12px 34px;border:1px solid var(--line-soft);border-radius:8px;background:#f8faf7;color:var(--muted);font-size:12px}.service-list li{margin:5px 0}.service-list code,.default-rule code{overflow-wrap:anywhere}.default-rule{display:flex;align-items:flex-start;gap:9px;padding:12px 14px;border:1px solid var(--line-soft);border-radius:8px;background:#f8faf7;color:var(--muted);font-size:12px}.default-rule b{flex:0 0 auto;color:var(--text)}.section-actions{display:flex;align-items:center;gap:12px;margin-top:4px;padding-top:16px;border-top:1px solid var(--line-soft)}.section-actions .button{min-width:120px}@media(max-width:980px){.conversion-grid{grid-template-columns:1fr}}@media(max-width:760px){.settings-section{padding:18px}.settings-fields{grid-template-columns:1fr}.field.full{grid-column:auto}.choice{grid-template-columns:1fr}}
	</style></head><body>${renderTopbar('settings')}<main><div class="page-head"><h1>设置</h1><p>三个模块可以分别保存，未提交的其他模块不会被修改。</p></div><div class="settings-form">
		<form id="displayForm" class="settings-section" aria-labelledby="displaySettings"><div class="settings-section-head"><h2 id="displaySettings">1. 基本显示</h2><p>分别设置客户端订阅名称和管理页面的浏览器标签信息。</p></div><div class="settings-fields"><div class="field"><label for="subscriptionName">订阅名称</label><input id="subscriptionName" type="text" maxlength="80" required><small>仅用于客户端拉取订阅后的订阅标题和下载文件名。</small></div><div class="field"><label for="pageTitle">浏览器标签页标题</label><input id="pageTitle" type="text" maxlength="100" required><small>用于登录、主订阅、分享管理和设置页面的浏览器标题。</small></div><div class="field full"><label for="browserIconURL">浏览器标签页图标</label><div class="icon-control"><span class="icon-preview"><img id="iconPreview" alt="图标预览"></span><input id="browserIconURL" type="text" maxlength="65535" placeholder="https://example.com/favicon.png"></div><small>支持 HTTP、HTTPS 或 data:image 地址；留空恢复默认图标。</small></div></div><div class="section-actions"><button class="button primary" type="submit">保存基本显示</button><span id="displayMessage" class="muted" role="status"></span></div></form>
		<form id="entryForm" class="settings-section" aria-labelledby="entrySettings"><div class="settings-section-head"><h2 id="entrySettings">2. 订阅入口</h2><p>管理主订阅的兼容访问 Token。</p></div><div class="settings-fields"><div class="field full"><label for="subscriptionToken">订阅入口 Token</label><input id="subscriptionToken" type="text" maxlength="128" placeholder="例如 auto"><small>设置为 TOKEN 后，<code>/TOKEN</code> 和 <code>/?token=TOKEN</code> 都能访问主订阅；修改后原 Token 地址失效，留空则只保留系统生成的订阅链接。</small></div></div><div class="section-actions"><button class="button primary" type="submit">保存订阅入口</button><span id="entryMessage" class="muted" role="status"></span></div></form>
		<form id="conversionForm" class="settings-section" aria-labelledby="converterSettings"><div class="settings-section-head"><h2 id="converterSettings">3. 转换配置</h2><p>分别选择转换后端和转换时使用的规则配置。</p></div><div class="conversion-grid"><div class="config-column"><div class="field"><label>转换服务</label><div class="choice"><label><input type="radio" name="converterMode" value="default"><span><strong>默认服务</strong><small>按顺序使用项目配置的 Subconverter 后端。</small></span></label><label><input type="radio" name="converterMode" value="custom"><span><strong>自建 Sublink Worker</strong><small>Clash、Sing-box、Surge 优先使用自建服务。</small></span></label></div></div><div class="field"><label for="customConverterURL">自建转换服务地址</label><input id="customConverterURL" type="url" placeholder="https://sub.example.com"><small>仅选择“自建 Sublink Worker”时启用。</small></div><div class="field"><label>当前默认转换后端</label><ul class="service-list">${converters}</ul></div></div><div class="config-column"><div class="field"><label>规则配置</label><div class="choice"><label><input type="radio" name="ruleMode" value="default"><span><strong>默认规则</strong><small>使用项目环境变量或内置的 ACL4SSR 规则。</small></span></label><label><input type="radio" name="ruleMode" value="custom"><span><strong>自建规则</strong><small>使用下方填写的自定义规则配置地址。</small></span></label></div></div><div class="field"><label for="customSubConfigURL">自建规则配置地址</label><input id="customSubConfigURL" type="url" maxlength="2048" placeholder="https://example.com/config.ini"><small>仅选择“自建规则”时启用。</small></div><div class="field"><label>当前默认规则配置</label><div class="default-rule"><b>默认</b><code>${escapeHTML(runtime.defaultSubConfig)}</code></div></div></div></div><div class="section-actions"><button class="button primary" type="submit">保存转换配置</button><span id="conversionMessage" class="muted" role="status"></span></div></form>
	</div></main><script>var initial=${initial};var defaultIcon=${defaultIcon};var nameInput=document.getElementById('subscriptionName');var pageTitleInput=document.getElementById('pageTitle');var iconInput=document.getElementById('browserIconURL');var iconPreview=document.getElementById('iconPreview');var tokenInput=document.getElementById('subscriptionToken');var urlInput=document.getElementById('customConverterURL');var ruleURLInput=document.getElementById('customSubConfigURL');nameInput.value=initial.subscriptionName;pageTitleInput.value=initial.pageTitle;iconInput.value=initial.browserIconURL||'';tokenInput.value=initial.subscriptionToken||'';urlInput.value=initial.customConverterURL||'';ruleURLInput.value=initial.customSubConfigURL||'';document.querySelector('input[name="converterMode"][value="'+initial.converterMode+'"]').checked=true;document.querySelector('input[name="ruleMode"][value="'+initial.ruleMode+'"]').checked=true;function refreshIcon(){iconPreview.src=iconInput.value.trim()||defaultIcon}function syncModes(){var converterMode=document.querySelector('input[name="converterMode"]:checked').value;var ruleMode=document.querySelector('input[name="ruleMode"]:checked').value;urlInput.disabled=converterMode!=='custom';urlInput.required=converterMode==='custom';ruleURLInput.disabled=ruleMode!=='custom';ruleURLInput.required=ruleMode==='custom';}function saveSection(form,message,payload,onSaved){var button=form.querySelector('button[type="submit"]');button.disabled=true;message.textContent='正在保存…';message.className='muted';fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(response){return response.json().then(function(data){if(!response.ok)throw new Error(data.message||'保存失败');return data})}).then(function(data){message.textContent='已保存';message.className='success';if(onSaved)onSaved(data.settings)}).catch(function(error){message.textContent=error.message;message.className='message'}).finally(function(){button.disabled=false})}iconPreview.addEventListener('error',function(){iconPreview.src=defaultIcon});iconInput.addEventListener('input',refreshIcon);document.querySelectorAll('input[name="converterMode"],input[name="ruleMode"]').forEach(function(el){el.addEventListener('change',syncModes)});refreshIcon();syncModes();document.getElementById('displayForm').addEventListener('submit',function(event){event.preventDefault();saveSection(this,document.getElementById('displayMessage'),{section:'display',subscriptionName:nameInput.value,pageTitle:pageTitleInput.value,browserIconURL:iconInput.value},function(settings){document.title='设置 · '+settings.pageTitle;document.querySelector('link[rel="icon"]').href=settings.browserIconURL||defaultIcon})});document.getElementById('entryForm').addEventListener('submit',function(event){event.preventDefault();saveSection(this,document.getElementById('entryMessage'),{section:'entry',subscriptionToken:tokenInput.value})});document.getElementById('conversionForm').addEventListener('submit',function(event){event.preventDefault();saveSection(this,document.getElementById('conversionMessage'),{section:'conversion',converterMode:document.querySelector('input[name="converterMode"]:checked').value,customConverterURL:urlInput.value,ruleMode:document.querySelector('input[name="ruleMode"]:checked').value,customSubConfigURL:ruleURLInput.value})});</script></body></html>`;
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function readShare(kv, id) {
	try {
		const value = await kv.get(SHARE_KEY_PREFIX + id);
		if (!value) return null;
		const share = JSON.parse(value);
		return share && share.id === id && typeof share.content === 'string' ? share : null;
	} catch (error) {
		console.error('读取分享失败:', error);
		return null;
	}
}

async function readShareIndex(kv) {
	try {
		const value = await kv.get(SHARE_INDEX_KEY);
		const parsed = value ? JSON.parse(value) : [];
		return Array.isArray(parsed) ? parsed.filter(isValidShareId) : [];
	} catch (error) {
		return [];
	}
}

function isValidShareId(value) {
	return /^[A-Za-z0-9_-]{12,64}$/.test(String(value || ''));
}

async function listShares(kv) {
	if (!kv) return [];
	const ids = await readShareIndex(kv);
	const shares = await Promise.all(ids.map(id => readShare(kv, id)));
	return shares.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function normalizeSharePayload(payload) {
	const name = String(payload && payload.name || '').trim().replace(/[\r\n\0]/g, '').slice(0, 80);
	const lines = String(payload && payload.content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	const content = [...new Set(lines)].join('\n');
	if (!name) throw new Error('请输入分享名称');
	if (!content) throw new Error('请至少填写一个节点');
	const invalidIndex = content.split('\n').findIndex(line => !/^(vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|wireguard|socks|socks5):\/\//i.test(line));
	if (invalidIndex >= 0) throw new Error(`第 ${invalidIndex + 1} 行不是支持的节点链接`);
	if (new TextEncoder().encode(content).length > 1024 * 1024) throw new Error('节点内容不能超过 1 MB');
	return { name, content, nodeCount: content.split('\n').length };
}

function createShareId() {
	const bytes = new Uint8Array(18);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}

async function handleSharesAPI(request, env) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (request.method === 'GET') return jsonResponse({ ok: true, shares: await listShares(env.KV) });
	if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
	try {
		const payload = await request.json();
		const index = await readShareIndex(env.KV);
		if (request.method === 'POST') {
			const normalized = normalizeSharePayload(payload);
			const now = new Date().toISOString();
			const share = { id: createShareId(), ...normalized, createdAt: now, updatedAt: now };
			await Promise.all([
				env.KV.put(SHARE_KEY_PREFIX + share.id, JSON.stringify(share)),
				env.KV.put(SHARE_INDEX_KEY, JSON.stringify([share.id, ...index.filter(id => id !== share.id)]))
			]);
			return jsonResponse({ ok: true, share }, 201);
		}
		if (request.method === 'PUT') {
			const id = String(payload.id || '');
			const previous = await readShare(env.KV, id);
			if (!previous) return jsonResponse({ ok: false, message: '分享不存在' }, 404);
			const share = { ...previous, ...normalizeSharePayload(payload), updatedAt: new Date().toISOString() };
			await env.KV.put(SHARE_KEY_PREFIX + id, JSON.stringify(share));
			return jsonResponse({ ok: true, share });
		}
		if (request.method === 'DELETE') {
			const id = String(payload.id || '');
			if (!index.includes(id)) return jsonResponse({ ok: false, message: '分享不存在' }, 404);
			await Promise.all([env.KV.delete(SHARE_KEY_PREFIX + id), env.KV.put(SHARE_INDEX_KEY, JSON.stringify(index.filter(item => item !== id)))]);
			return jsonResponse({ ok: true });
		}
		return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	} catch (error) {
		return jsonResponse({ ok: false, message: error.message || '操作失败' }, 400);
	}
}

async function renderSharesPage(_request, env, runtime) {
	const shares = await listShares(env.KV);
	const initial = JSON.stringify(shares).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分享管理 · ${escapeHTML(runtime.pageTitle)}</title>${renderFavicon(runtime.browserIconURL)}<style>${basePageStyles()}.layout{display:grid;grid-template-columns:minmax(520px,1.35fr) minmax(320px,1fr);gap:18px;align-items:start}.share-list{display:grid;gap:12px}.share-card{border:1px solid var(--line);border-radius:10px;padding:15px;background:#fff}.share-card h3{margin:0 0 5px}.share-meta{font-size:12px;color:var(--muted);margin-bottom:10px}.share-link{display:flex;gap:8px;margin:10px 0}.share-link code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:9px;background:#f5f7f5;border-radius:6px;flex:1}.empty{text-align:center;padding:35px;color:var(--muted)}#shareContent{min-height:320px}@media(max-width:960px){.layout{grid-template-columns:1fr}}</style></head><body>${renderTopbar('shares')}<main><div class="page-head"><h1>分享管理</h1><p>把一组或多组节点保存为独立订阅链接，可随时修改或删除。</p></div>${env.KV ? `<div class="layout"><section class="panel"><h2 id="formTitle">新建分享</h2><form id="shareForm"><input id="shareId" type="hidden"><div class="field"><label for="shareName">分享名称</label><input id="shareName" type="text" maxlength="80" placeholder="例如：给朋友的日本节点" required></div><div class="field"><label for="shareContent">节点内容</label><textarea id="shareContent" placeholder="每行一个节点，例如 vless://..." required></textarea><small>保存时会自动移除空行和完全重复的行。</small></div><div class="row"><button class="button primary" id="submitShare" type="submit">生成订阅链接</button><button class="button" id="cancelEdit" type="button" hidden>取消修改</button><span id="formMessage" class="muted"></span></div></form></section><section><div id="shareList" class="share-list"></div></section></div>` : '<section class="panel empty">请先绑定 KV 命名空间后使用分享管理。</section>'}</main>${env.KV ? `<script>var shares=${initial};var origin=window.location.origin;var form=document.getElementById('shareForm');var list=document.getElementById('shareList');function esc(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}function linkOf(id){return origin+'/s/'+id}function render(){if(!shares.length){list.innerHTML='<div class="panel empty">还没有分享链接，请先创建一组。</div>';return}list.innerHTML=shares.map(function(item){return '<article class="share-card"><h3>'+esc(item.name)+'</h3><div class="share-meta">'+item.nodeCount+' 个节点 · 更新于 '+new Date(item.updatedAt).toLocaleString()+'</div><div class="share-link"><code title="'+esc(linkOf(item.id))+'">'+esc(linkOf(item.id))+'</code><button class="button" data-copy="'+esc(linkOf(item.id))+'">复制</button></div><div class="row"><button class="button" data-edit="'+item.id+'">修改</button><button class="button danger" data-delete="'+item.id+'">删除</button></div></article>'}).join('')}function reset(){form.reset();document.getElementById('shareId').value='';document.getElementById('formTitle').textContent='新建分享';document.getElementById('submitShare').textContent='生成订阅链接';document.getElementById('cancelEdit').hidden=true}function call(method,body){return fetch('/api/shares',{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(response){return response.json().then(function(data){if(!response.ok)throw new Error(data.message||'操作失败');return data})})}form.addEventListener('submit',function(event){event.preventDefault();var id=document.getElementById('shareId').value;var button=document.getElementById('submitShare');var message=document.getElementById('formMessage');button.disabled=true;message.textContent='正在保存…';call(id?'PUT':'POST',{id:id,name:document.getElementById('shareName').value,content:document.getElementById('shareContent').value}).then(function(data){var index=shares.findIndex(function(item){return item.id===data.share.id});if(index>=0)shares[index]=data.share;else shares.unshift(data.share);render();reset();message.textContent='已保存，订阅链接可直接使用';message.className='success'}).catch(function(error){message.textContent=error.message;message.className='message'}).finally(function(){button.disabled=false})});list.addEventListener('click',function(event){var copy=event.target.dataset.copy;if(copy){navigator.clipboard.writeText(copy).then(function(){event.target.textContent='已复制';setTimeout(function(){event.target.textContent='复制'},1200)});return}var edit=event.target.dataset.edit;if(edit){var item=shares.find(function(value){return value.id===edit});document.getElementById('shareId').value=item.id;document.getElementById('shareName').value=item.name;document.getElementById('shareContent').value=item.content;document.getElementById('formTitle').textContent='修改分享';document.getElementById('submitShare').textContent='保存修改';document.getElementById('cancelEdit').hidden=false;window.scrollTo({top:0,behavior:'smooth'});return}var remove=event.target.dataset.delete;if(remove&&confirm('删除后，这个订阅链接将失效，KV 同步可能有短暂延迟。确定删除？')){call('DELETE',{id:remove}).then(function(){shares=shares.filter(function(item){return item.id!==remove});render()}).catch(function(error){alert(error.message)})}});document.getElementById('cancelEdit').addEventListener('click',reset);render();</script>` : ''}</body></html>`;
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function renderRequestsPage(_request, env, runtime) {
	const [stats, shares] = await Promise.all([
		readSubscriptionRequestStats(env.KV),
		listShares(env.KV)
	]);
	const shareNames = new Map(shares.map(item => [item.id, item.name]));
	const formatNames = { base64: 'Base64', clash: 'Clash', singbox: 'Sing-box', surge: 'Surge', quanx: 'QuanX', loon: 'Loon' };
	const renderClients = clients => clients.slice(0, 20).map(client => {
		const formats = Object.entries(client.formats)
			.sort((a, b) => b[1] - a[1])
			.map(([format, count]) => `${formatNames[format] || format} ${count}`)
			.join(' · ');
		return `<div class="request-client"><div class="request-client-head"><strong>${escapeHTML(client.name)}</strong><span>${client.count} 次</span></div><div class="request-client-meta"><span>${escapeHTML(formats || '未知格式')}</span><time data-request-time="${escapeHTML(client.lastRequestedAt)}">${escapeHTML(client.lastRequestedAt || '时间未知')}</time></div><code title="${escapeHTML(client.lastUserAgent)}">${escapeHTML(client.lastUserAgent)}</code></div>`;
	}).join('');
	const mainHTML = stats.main.total
		? `<div class="request-list">${renderClients(stats.main.clients)}</div>`
		: '<div class="request-empty">暂无主订阅请求记录</div>';
	const shareHTML = stats.shares.length ? stats.shares.map(group => {
		const isLegacy = group.subscriptionId === 'legacy';
		const name = isLegacy ? '历史分享请求' : (shareNames.get(group.subscriptionId) || '已删除的分享');
		const link = isLegacy ? '旧记录未保存分享 ID' : '/s/' + group.subscriptionId;
		return `<article class="share-request"><div class="share-request-head"><div><h3>${escapeHTML(name)}</h3><code>${escapeHTML(link)}</code></div><strong>${group.total} 次</strong></div><div class="request-list">${renderClients(group.clients)}</div></article>`;
	}).join('') : '<div class="request-empty">暂无分享订阅请求记录</div>';
	const disabledNote = runtime.requestLogEnabled ? '' : '<div class="message">订阅请求记录已通过 REQUESTLOG=0 关闭。</div>';
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>订阅请求 · ${escapeHTML(runtime.pageTitle)}</title>${renderFavicon(runtime.browserIconURL)}<style>${basePageStyles()}.request-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.request-panel h2{margin:0}.request-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}.request-panel-head p{margin:5px 0 0;color:var(--muted);font-size:13px}.count-badge{flex:0 0 auto;padding:5px 10px;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:12px;font-weight:800}.request-list{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}.request-client{min-width:0;padding:12px 14px}.request-client+.request-client{border-top:1px solid var(--line-soft)}.request-client-head,.request-client-meta{display:flex;align-items:center;justify-content:space-between;gap:10px}.request-client-head strong{font-size:13px}.request-client-head>span{padding:2px 7px;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:10px;font-weight:800}.request-client-meta{margin-top:5px;color:var(--muted);font-size:11px}.request-client-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.request-client-meta time{flex:0 0 auto}.request-client code{display:block;margin-top:7px;overflow:hidden;color:#53605a;font-size:10px;line-height:1.45;text-overflow:ellipsis;white-space:nowrap}.request-empty{padding:32px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);text-align:center}.share-request-list{display:grid;gap:12px}.share-request{border:1px solid var(--line);border-radius:10px;overflow:hidden}.share-request-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:13px 14px;background:#f8faf7}.share-request-head h3{margin:0 0 4px;font-size:14px}.share-request-head code{color:var(--muted);font-size:10px}.share-request-head>strong{color:var(--green);font-size:12px}.share-request .request-list{border:0;border-top:1px solid var(--line-soft);border-radius:0}@media(max-width:900px){.request-summary{grid-template-columns:1fr}}</style></head><body>${renderTopbar('requests')}<main><div class="page-head"><h1>订阅请求</h1><p>近 30 天的请求记录；主订阅和分享订阅分别统计，互不混合。${stats.truncated ? ' 记录较多，仅展示最近一部分。' : ''}</p></div>${disabledNote}<div class="request-summary"><section class="panel request-panel"><div class="request-panel-head"><div><h2>主订阅请求</h2><p>仅统计主订阅入口产生的请求</p></div><span class="count-badge">${stats.main.total} 次</span></div>${mainHTML}</section><section class="panel request-panel"><div class="request-panel-head"><div><h2>分享订阅请求</h2><p>按分享链接分别展示请求记录</p></div><span class="count-badge">${stats.shares.reduce((total, item) => total + item.total, 0)} 次</span></div><div class="share-request-list">${shareHTML}</div></section></div></main><script>document.querySelectorAll('[data-request-time]').forEach(function(el){var value=el.dataset.requestTime;if(value){var date=new Date(value);if(!Number.isNaN(date.getTime()))el.textContent=date.toLocaleString()}});</script></body></html>`;
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function parseSubConverters(value) {
	const converters = String(value || DEFAULT_SUB_CONVERTER)
		.split(/[\n,;]+/)
		.map(item => item.trim())
		.filter(Boolean)
		.map(item => /^https?:\/\//i.test(item) ? item : 'https://' + item)
		.map(item => item.replace(/\/+$/, ''));
	return [...new Set(converters.length ? converters : [DEFAULT_SUB_CONVERTER])];
}

function normalizeSublinkConverter(value) {
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

function supportsSublinkTarget(target) {
	return ['clash', 'singbox', 'surge'].includes(target);
}

function createSublinkURL(converter, target, sourceURL) {
	const sources = String(sourceURL || '').split('|').map(item => item.trim()).filter(Boolean).join('\n');
	const params = new URLSearchParams({ config: sources });
	return converter + '/' + target + '?' + params.toString();
}

async function fetchSublinkSubscription(converter, target, sourceURL, init) {
	try {
		const response = await fetch(createSublinkURL(converter, target, sourceURL), init);
		if (response.ok) return { response, converter };
		console.log(`Sublink Worker ${converter} 返回 ${response.status}`);
	} catch (error) {
		console.log(`Sublink Worker ${converter} 请求失败:`, error.message);
	}
	return null;
}

function queueTelegram(ctx, task) {
	const safeTask = Promise.resolve(task).catch(error => console.error('TG 推送失败:', error));
	if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(safeTask);
	return safeTask;
}

function detectSubscriptionClient(userAgentHeader) {
	const ua = String(userAgentHeader || '').toLowerCase();
	if (ua.includes('mihomo')) return 'Mihomo';
	if (ua.includes('clash')) return 'Clash';
	if (ua.includes('sing-box') || ua.includes('singbox')) return 'Sing-box';
	if (ua.includes('shadowrocket')) return 'Shadowrocket';
	if (ua.includes('quantumult')) return 'Quantumult X';
	if (ua.includes('surge')) return 'Surge';
	if (ua.includes('loon')) return 'Loon';
	if (ua.includes('nekobox')) return 'NekoBox';
	if (ua.includes('v2rayng')) return 'v2rayNG';
	if (ua.includes('v2rayn')) return 'v2rayN';
	if (ua.includes('stash')) return 'Stash';
	if (ua.includes('mozilla')) return '浏览器';
	return '其他客户端';
}

function queueSubscriptionRequestLog(ctx, env, details) {
	if (!env.KV || typeof env.KV.put !== 'function') return;
	const task = recordSubscriptionRequest(env.KV, details)
		.catch(error => console.error('记录订阅请求时发生错误:', error));
	if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
}

async function recordSubscriptionRequest(kv, details) {
	const now = Date.now();
	const reverseTimestamp = String(9999999999999 - now).padStart(13, '0');
	const randomID = typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + now.toString(36);
	const metadata = {
		client: String(details.client || '其他客户端').slice(0, 40),
		userAgent: String(details.userAgent || 'Unknown').slice(0, 240),
		format: String(details.format || 'base64').slice(0, 20),
		access: details.access === 'share' ? 'share' : 'main',
		subscriptionId: isValidShareId(details.subscriptionId) ? details.subscriptionId : '',
		requestedAt: new Date(now).toISOString()
	};
	await kv.put(REQUEST_LOG_PREFIX + reverseTimestamp + '.' + randomID, '1', {
		metadata,
		expirationTtl: REQUEST_LOG_TTL
	});
}

async function readSubscriptionRequestStats(kv) {
	const empty = { total: 0, truncated: false, main: { total: 0, clients: [] }, shares: [] };
	if (!kv || typeof kv.list !== 'function') return empty;
	const events = [];
	let cursor;
	let truncated = false;
	try {
		do {
			const options = { prefix: REQUEST_LOG_PREFIX, limit: Math.min(1000, REQUEST_LOG_LIMIT - events.length) };
			if (cursor) options.cursor = cursor;
			const page = await kv.list(options);
			for (const key of page.keys || []) {
				if (key.metadata) events.push(key.metadata);
				if (events.length >= REQUEST_LOG_LIMIT) break;
			}
			cursor = page.list_complete ? undefined : page.cursor;
			if (events.length >= REQUEST_LOG_LIMIT && !page.list_complete) truncated = true;
		} while (cursor && events.length < REQUEST_LOG_LIMIT);
	} catch (error) {
		console.error('读取订阅请求统计时发生错误:', error);
		return empty;
	}

	const summarize = records => {
		const clients = new Map();
		for (const event of records) {
			const clientName = String(event.client || '其他客户端');
			let item = clients.get(clientName);
			if (!item) {
				item = { name: clientName, count: 0, lastRequestedAt: '', lastUserAgent: '', formats: {} };
				clients.set(clientName, item);
			}
			item.count += 1;
			const format = String(event.format || 'base64');
			item.formats[format] = (item.formats[format] || 0) + 1;
			if (!item.lastRequestedAt || String(event.requestedAt || '') > item.lastRequestedAt) {
				item.lastRequestedAt = String(event.requestedAt || '');
				item.lastUserAgent = String(event.userAgent || 'Unknown');
			}
		}
		return {
			total: records.length,
			clients: [...clients.values()].sort((a, b) => b.count - a.count || b.lastRequestedAt.localeCompare(a.lastRequestedAt))
		};
	};

	const mainEvents = events.filter(event => event.access !== 'share' && event.access !== 'guest');
	const shareEvents = events.filter(event => event.access === 'share' || event.access === 'guest');
	const shareGroups = new Map();
	for (const event of shareEvents) {
		const id = isValidShareId(event.subscriptionId) ? event.subscriptionId : 'legacy';
		if (!shareGroups.has(id)) shareGroups.set(id, []);
		shareGroups.get(id).push(event);
	}
	return {
		total: events.length,
		truncated,
		main: summarize(mainEvents),
		shares: [...shareGroups.entries()]
			.map(([subscriptionId, records]) => ({ subscriptionId, ...summarize(records) }))
			.sort((a, b) => b.total - a.total)
	};
}

function createSubConverterURL(converter, target, sourceURL, configURL) {
	const params = new URLSearchParams({
		target, url: sourceURL, insert: 'false', config: configURL, emoji: 'true', list: 'false',
		tfo: 'false', scv: 'true', fdn: 'false', sort: 'false'
	});
	if (target === 'surge') params.set('ver', '4');
	if (target === 'quanx') params.set('udp', 'true');
	if (target !== 'loon' && target !== 'quanx') params.set('new_name', 'true');
	return converter + '/sub?' + params.toString();
}

async function fetchConvertedSubscription(converters, target, sourceURL, configURL, init) {
	for (const converter of converters) {
		try {
			const response = await fetch(createSubConverterURL(converter, target, sourceURL, configURL), init);
			if (response.ok) return { response, converter };
			console.log(`订阅转换后端 ${converter} 返回 ${response.status}`);
		} catch (error) {
			console.log(`订阅转换后端 ${converter} 请求失败:`, error.message);
		}
	}
	return null;
}

function encodeBase64(data) {
	const binary = new TextEncoder().encode(data);
	let base64 = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	for (let i = 0; i < binary.length; i += 3) {
		const byte1 = binary[i];
		const byte2 = binary[i + 1] || 0;
		const byte3 = binary[i + 2] || 0;
		base64 += chars[byte1 >> 2];
		base64 += chars[((byte1 & 3) << 4) | (byte2 >> 4)];
		base64 += chars[((byte2 & 15) << 2) | (byte3 >> 6)];
		base64 += chars[byte3 & 63];
	}
	const padding = 3 - (binary.length % 3 || 3);
	return base64.slice(0, base64.length - padding) + '=='.slice(0, padding);
}


async function ADD(envadd) {
	var addtext = envadd.replace(/[	"'|\r\n]+/g, '\n').replace(/\n+/g, '\n');	// 替换为换行
	//console.log(addtext);
	if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
	const add = addtext.split('\n');
	//console.log(add);
	return add;
}

function shouldSendSubscriptionNotification(request) {
	const now = Date.now();
	const url = new URL(request.url);
	const key = [
		request.headers.get('CF-Connecting-IP') || 'unknown',
		request.headers.get('User-Agent') || 'unknown',
		url.pathname,
		url.search
	].join('|');
	const lastNotification = subscriptionNotificationCache.get(key);

	if (lastNotification && now - lastNotification < subscriptionNotificationCooldown) return false;
	subscriptionNotificationCache.set(key, now);

	if (subscriptionNotificationCache.size > 200) {
		for (const [cacheKey, timestamp] of subscriptionNotificationCache) {
			if (now - timestamp >= subscriptionNotificationCooldown) subscriptionNotificationCache.delete(cacheKey);
		}
	}
	return true;
}

async function sendMessage(runtime, type, ip, add_data = "") {
	if (runtime.BotToken !== '' && runtime.ChatID !== '') {
		let msg = "";
		const response = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
		if (response.status == 200) {
			const ipInfo = await response.json();
			msg = `${type}\nIP: ${ip}\n国家: ${ipInfo.country}\n<tg-spoiler>城市: ${ipInfo.city}\n组织: ${ipInfo.org}\nASN: ${ipInfo.as}\n${add_data}`;
		} else {
			msg = `${type}\nIP: ${ip}\n<tg-spoiler>${add_data}`;
		}

		let url = "https://api.telegram.org/bot" + runtime.BotToken + "/sendMessage?chat_id=" + runtime.ChatID + "&parse_mode=HTML&text=" + encodeURIComponent(msg);
		return fetch(url, {
			method: 'get',
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml;',
				'Accept-Encoding': 'gzip, deflate, br',
				'User-Agent': 'Mozilla/5.0 Chrome/90.0.4430.72'
			}
		});
	}
}

function base64Decode(str) {
	const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
	const decoder = new TextDecoder('utf-8');
	return decoder.decode(bytes);
}

async function MD5MD5(text) {
	const encoder = new TextEncoder();

	const firstPass = await crypto.subtle.digest('MD5', encoder.encode(text));
	const firstPassArray = Array.from(new Uint8Array(firstPass));
	const firstHex = firstPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

	const secondPass = await crypto.subtle.digest('MD5', encoder.encode(firstHex.slice(7, 27)));
	const secondPassArray = Array.from(new Uint8Array(secondPass));
	const secondHex = secondPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

	return secondHex.toLowerCase();
}

function clashFix(content) {
	if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
		let lines;
		if (content.includes('\r\n')) {
			lines = content.split('\r\n');
		} else {
			lines = content.split('\n');
		}

		let result = "";
		for (let line of lines) {
			if (line.includes('type: wireguard')) {
				const 备改内容 = `, mtu: 1280, udp: true`;
				const 正确内容 = `, mtu: 1280, remote-dns-resolve: true, udp: true`;
				result += line.replace(new RegExp(备改内容, 'g'), 正确内容) + '\n';
			} else {
				result += line + '\n';
			}
		}

		content = result;
	}
	return content;
}

async function proxyURL(proxyURL, url) {
	const URLs = await ADD(proxyURL);
	const fullURL = URLs[Math.floor(Math.random() * URLs.length)];

	// 解析目标 URL
	let parsedURL = new URL(fullURL);
	console.log(parsedURL);
	// 提取并可能修改 URL 组件
	let URLProtocol = parsedURL.protocol.slice(0, -1) || 'https';
	let URLHostname = parsedURL.hostname;
	let URLPathname = parsedURL.pathname;
	let URLSearch = parsedURL.search;

	// 处理 pathname
	if (URLPathname.charAt(URLPathname.length - 1) == '/') {
		URLPathname = URLPathname.slice(0, -1);
	}
	URLPathname += url.pathname;

	// 构建新的 URL
	let newURL = `${URLProtocol}://${URLHostname}${URLPathname}${URLSearch}`;

	// 反向代理请求
	let response = await fetch(newURL);

	// 创建新的响应
	let newResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});

	// 添加自定义头部，包含 URL 信息
	//newResponse.headers.set('X-Proxied-By', 'Cloudflare Worker');
	//newResponse.headers.set('X-Original-URL', fullURL);
	newResponse.headers.set('X-New-URL', newURL);

	return newResponse;
}

async function getSUB(api, request, 追加UA, userAgentHeader) {
	if (!api || api.length === 0) {
		return [];
	} else api = [...new Set(api)]; // 去重
	let newapi = "";
	let 订阅转换URLs = "";
	let 异常订阅 = "";
	const controller = new AbortController(); // 创建一个AbortController实例，用于取消请求
	const timeout = setTimeout(() => {
		controller.abort(); // 2秒后取消所有请求
	}, 2000);

	try {
		// 使用Promise.allSettled等待所有API请求完成，无论成功或失败
		const responses = await Promise.allSettled(api.map(apiUrl => getUrl(request, apiUrl, 追加UA, userAgentHeader).then(response => response.ok ? response.text() : Promise.reject(response))));

		// 遍历所有响应
		const modifiedResponses = responses.map((response, index) => {
			// 检查是否请求成功
			if (response.status === 'rejected') {
				const reason = response.reason;
				if (reason && reason.name === 'AbortError') {
					return {
						status: '超时',
						value: null,
						apiUrl: api[index] // 将原始的apiUrl添加到返回对象中
					};
				}
				console.error(`请求失败: ${api[index]}, 错误信息: ${reason.status} ${reason.statusText}`);
				return {
					status: '请求失败',
					value: null,
					apiUrl: api[index] // 将原始的apiUrl添加到返回对象中
				};
			}
			return {
				status: response.status,
				value: response.value,
				apiUrl: api[index] // 将原始的apiUrl添加到返回对象中
			};
		});

		console.log(modifiedResponses); // 输出修改后的响应数组

		for (const response of modifiedResponses) {
			// 检查响应状态是否为'fulfilled'
			if (response.status === 'fulfilled') {
				const content = await response.value || 'null'; // 获取响应的内容
				if (content.includes('proxies:')) {
					//console.log('Clash订阅: ' + response.apiUrl);
					订阅转换URLs += "|" + response.apiUrl; // Clash 配置
				} else if (content.includes('outbounds"') && content.includes('inbounds"')) {
					//console.log('Singbox订阅: ' + response.apiUrl);
					订阅转换URLs += "|" + response.apiUrl; // Singbox 配置
				} else if (content.includes('://')) {
					//console.log('明文订阅: ' + response.apiUrl);
					newapi += content + '\n'; // 追加内容
				} else if (isValidBase64(content)) {
					//console.log('Base64订阅: ' + response.apiUrl);
					newapi += base64Decode(content) + '\n'; // 解码并追加内容
				} else {
					const 异常订阅LINK = `trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#%E5%BC%82%E5%B8%B8%E8%AE%A2%E9%98%85%20${response.apiUrl.split('://')[1].split('/')[0]}`;
					console.log('异常订阅: ' + 异常订阅LINK);
					异常订阅 += `${异常订阅LINK}\n`;
				}
			}
		}
	} catch (error) {
		console.error(error); // 捕获并输出错误信息
	} finally {
		clearTimeout(timeout); // 清除定时器
	}

	const 订阅内容 = await ADD(newapi + 异常订阅); // 将处理后的内容转换为数组
	// 返回处理后的结果
	return [订阅内容, 订阅转换URLs];
}

async function getUrl(request, targetUrl, 追加UA, userAgentHeader) {
	// 设置自定义 User-Agent
	const newHeaders = new Headers(request.headers);
	newHeaders.set("User-Agent", `${atob('djJyYXlOLzYuNDU=')} cmliu/CF-Workers-SUB ${追加UA}(${userAgentHeader})`);

	// 构建新的请求对象
	const modifiedRequest = new Request(targetUrl, {
		method: request.method,
		headers: newHeaders,
		body: request.method === "GET" ? null : request.body,
		redirect: "follow",
		cf: {
			// 忽略SSL证书验证
			insecureSkipVerify: true,
			// 允许自签名证书
			allowUntrusted: true,
			// 禁用证书验证
			validateCertificate: false
		}
	});

	// 输出请求的详细信息
	console.log(`请求URL: ${targetUrl}`);
	console.log(`请求头: ${JSON.stringify([...newHeaders])}`);
	console.log(`请求方法: ${request.method}`);
	console.log(`请求体: ${request.method === "GET" ? null : request.body}`);

	// 发送请求并返回响应
	return fetch(modifiedRequest);
}

function isValidBase64(str) {
	// 先移除所有空白字符(空格、换行、回车等)
	const cleanStr = str.replace(/\s/g, '');
	const base64Regex = /^[A-Za-z0-9+/=]+$/;
	return base64Regex.test(cleanStr);
}

async function 迁移地址列表(env, txt = 'ADD.txt') {
	const 旧数据 = await env.KV.get(`/${txt}`);
	const 新数据 = await env.KV.get(txt);

	if (旧数据 && !新数据) {
		// 写入新位置
		await env.KV.put(txt, 旧数据);
		// 删除旧数据
		await env.KV.delete(`/${txt}`);
		return true;
	}
	return false;
}


async function KV(request, env, txt = 'ADD.txt', mainSubscriptionId, runtime) {
	const url = new URL(request.url);
	const metaKey = txt + '.meta.json';
	const backupKey = txt.endsWith('.txt') ? txt.slice(0, -4) + '.backup.txt' : txt + '.backup';
	const backupMetaKey = txt.endsWith('.txt') ? txt.slice(0, -4) + '.backup.meta.json' : txt + '.backup.meta.json';
	try {
		if (request.method === "POST") {
			if (!env.KV) return new Response("未绑定 KV 命名空间", { status: 400 });
			if (!requestHasSameOrigin(request)) return new Response("请求来源无效", { status: 403 });
			try {
				if (request.headers.get('X-Node2Link-Action') === 'get-backup') {
					const [backupContent, backupMetadataText] = await Promise.all([
						env.KV.get(backupKey),
						env.KV.get(backupMetaKey)
					]);
					if (backupContent === null || backupContent === undefined) {
						return new Response(JSON.stringify({ ok: false, message: '暂无上次保存版本' }), {
							status: 404,
							headers: { "Content-Type": "application/json;charset=utf-8" }
						});
					}
					let backupMetadata = null;
					try { backupMetadata = backupMetadataText ? JSON.parse(backupMetadataText) : null; }
					catch (error) { console.error('读取备份元数据时发生错误:', error); }
					return new Response(JSON.stringify({ ok: true, content: backupContent, metadata: backupMetadata }), {
						headers: { "Content-Type": "application/json;charset=utf-8" }
					});
				}

				const content = await request.text();
				const [previousContent, previousMetadataText] = await Promise.all([
					env.KV.get(txt),
					env.KV.get(metaKey)
				]);
				const metadata = {
					savedAt: new Date().toISOString(),
					bytes: new TextEncoder().encode(content).length,
					lines: content ? content.split(/\r?\n/).length : 0
				};
				const writes = [
					env.KV.put(txt, content),
					env.KV.put(metaKey, JSON.stringify(metadata))
				];
				if (previousContent !== null && previousContent !== undefined) {
					let previousMetadata = null;
					try { previousMetadata = previousMetadataText ? JSON.parse(previousMetadataText) : null; }
					catch (error) { console.error('读取上一版元数据时发生错误:', error); }
					if (!previousMetadata) {
						previousMetadata = {
							savedAt: '',
							bytes: new TextEncoder().encode(previousContent).length,
							lines: previousContent ? previousContent.split(/\r?\n/).length : 0
						};
					}
					writes.push(env.KV.put(backupKey, previousContent));
					writes.push(env.KV.put(backupMetaKey, JSON.stringify(previousMetadata)));
				}
				await Promise.all(writes);
				return new Response(JSON.stringify({ ok: true, metadata }), {
					headers: { "Content-Type": "application/json;charset=utf-8" }
				});
			} catch (error) {
				console.error("保存 KV 时发生错误:", error);
				return new Response("保存失败: " + error.message, { status: 500 });
			}
		}

		let content = "";
		let savedMetadata = null;
		const hasKV = !!env.KV;
		if (hasKV) {
			try {
				const [storedContent, storedMetadata] = await Promise.all([
					env.KV.get(txt),
					env.KV.get(metaKey)
				]);
				content = storedContent || "";
				if (storedMetadata) {
					try { savedMetadata = JSON.parse(storedMetadata); }
					catch (metadataError) { console.error("读取 KV 元数据时发生错误:", metadataError); }
				}
			} catch (error) {
				console.error("读取 KV 时发生错误:", error);
				content = "读取数据时发生错误: " + error.message;
			}
		}
		if (!savedMetadata) {
			savedMetadata = {
				savedAt: "",
				bytes: new TextEncoder().encode(content).length,
				lines: content ? content.split(/\r?\n/).length : 0
			};
		}

		const escapeHTML = (value) => String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
		const origin = url.origin;
		const ownerBase = runtime.subscriptionToken
			? origin + "/" + encodeURIComponent(runtime.subscriptionToken)
			: origin + "/s/" + encodeURIComponent(mainSubscriptionId);
		const converterListHTML = runtime.subConverters.map((converter, index) =>
			`<span class="converter-entry"><b>${index === 0 ? "主" : "备" + index}</b><code title="${escapeHTML(converter)}">${escapeHTML(converter)}</code></span>`
		).join("");
		const activeConverterHTML = runtime.converterMode === 'custom'
			? `<span class="converter-entry"><b>自建</b><code title="${escapeHTML(runtime.customConverterURL)}">${escapeHTML(runtime.customConverterURL)}</code></span>`
			: converterListHTML;
		const formats = [
			{ name: "智能适配", key: "sub", icon: "sparkles", description: "自动识别客户端并返回合适格式", recommended: true },
			{ name: "Base64", key: "b64", icon: "binary", description: "通用 Base64 编码订阅" },
			{ name: "Clash", key: "clash", icon: "layers-3", description: "适用于 Clash 与 Mihomo" },
			{ name: "Loon", key: "loon", icon: "orbit", description: "适用于 Loon 客户端" }
		];

		const renderSubscriptions = () => formats.map((format) => {
			const subscriptionURL = ownerBase + (format.key === "sub" ? "" : "?" + format.key);
			return `
				<article class="subscription-card" data-default-url="${escapeHTML(subscriptionURL)}">
					<div class="subscription-head">
						<span class="format-icon"><i data-lucide="${format.icon}"></i></span>
						<div><h3>${format.name}${format.recommended ? '<span class="badge">推荐</span>' : ""}</h3><p>${format.description}</p></div>
					</div>
					<div class="link-row">
						<code class="subscription-url" title="${escapeHTML(subscriptionURL)}">${escapeHTML(subscriptionURL)}</code>
						<button class="icon-button" type="button" data-url="${escapeHTML(subscriptionURL)}" onclick="showQRCode(this)" aria-label="显示二维码" title="显示二维码"><i data-lucide="qr-code"></i></button>
						<button class="copy-button" type="button" data-url="${escapeHTML(subscriptionURL)}" onclick="copySubscription(this)"><i data-lucide="copy"></i><span>复制</span></button>
					</div>
				</article>`;
		}).join("");

		const html = `
			<!DOCTYPE html>
			<html lang="zh-CN">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1">
				<meta name="color-scheme" content="light">
				<meta name="theme-color" content="#f5f6f3">
				<title>${escapeHTML(runtime.pageTitle)}</title>
				${renderFavicon(runtime.browserIconURL)}
				<style>
					:root {
						color-scheme: light;
						font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
						--bg: #f5f6f3; --surface: #ffffff; --surface-soft: #f8faf7; --text: #17211d;
						--muted: #68736d; --line: #dfe4de; --line-soft: #edf0ec; --green: #176b49;
						--green-dark: #105239; --green-soft: #e8f3ed; --amber: #996515; --amber-soft: #fff5da;
						--danger: #b13a36; --shadow: 0 12px 36px rgba(26, 46, 35, .07);
					}
					* { box-sizing: border-box; }
					html { scroll-behavior: smooth; }
					body { margin: 0; min-width: 320px; background: var(--bg); color: var(--text); }
					button, input, textarea { font: inherit; }
					button { letter-spacing: 0; }
					button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid rgba(23, 107, 73, .2); outline-offset: 2px; }
					.app-header { border-bottom: 1px solid var(--line); background: rgba(255, 255, 255, .92); }
					.header-inner { width: calc(100% - 48px); min-height: 82px; margin: 0 auto; display: flex; align-items: center; gap: 22px; }
					.header-overview { min-width: 0; flex: 0 1 420px; }
					.header-overview .eyebrow { margin: 0 0 2px; color: var(--green); font-size: 9px; font-weight: 800; text-transform: uppercase; }
					.header-overview h1 { margin: 0; font-size: 23px; line-height: 1.12; letter-spacing: 0; }
					.header-overview .intro-copy { max-width: 620px; margin: 3px 0 0; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
					.header-tabs { align-self: stretch; display: flex; align-items: stretch; gap: 4px; }
					.header-tabs a { position: relative; display: inline-flex; align-items: center; padding: 0 16px; color: var(--muted); font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap; }
					.header-tabs a:hover { color: var(--green); }
					.header-tabs a.active { color: var(--green-dark); }
					.header-tabs a.active::after { content: ""; position: absolute; right: 10px; bottom: -1px; left: 10px; height: 3px; border-radius: 3px 3px 0 0; background: var(--green); }
					.header-actions { flex: 0 0 auto; margin-left: auto; display: flex; align-items: center; gap: 12px; }
					.header-nav { display: flex; align-items: center; gap: 4px; }
					.header-nav a, .header-nav button { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 12px; text-decoration: none; white-space: nowrap; cursor: pointer; }
					.header-nav a:hover, .header-nav a.active, .header-nav button:hover { background: var(--green-soft); color: var(--green); }
					.header-nav svg { width: 14px; height: 14px; }
					.header-nav form { display: flex; margin: 0; }
					.online { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #cce4d6; border-radius: 999px; background: var(--green-soft); color: var(--green-dark); font-size: 12px; font-weight: 700; }
					.online::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #21a464; box-shadow: 0 0 0 3px rgba(33, 164, 100, .13); }
					main { width: calc(100% - 48px); margin: 0 auto; padding: 18px 0 48px; }
					.token-chip { max-width: 360px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 12px; }
					.token-chip svg { flex: 0 0 auto; width: 16px; height: 16px; color: var(--green); }
					.token-chip code { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
					.section { margin-top: 38px; }
					.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
					.section-heading h2 { margin: 0; font-size: 19px; }
					.section-heading p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
					.workspace-grid { display: grid; grid-template-columns: 230px minmax(0, 1fr) 330px; grid-template-areas: "config main sidebar"; gap: 16px; align-items: start; }
					.workspace-config, .workspace-main, .workspace-sidebar { min-width: 0; }
					.workspace-config { grid-area: config; }
					.workspace-main { grid-area: main; }
					.workspace-sidebar { grid-area: sidebar; }
					.workspace-grid .section { margin-top: 0; }
					.workspace-sidebar { display: flex; flex-direction: column; gap: 26px; }
					.workspace-sidebar > .guest-panel { margin-top: 0; }
					.workspace-sidebar .subscription-grid { grid-template-columns: 1fr; gap: 10px; }
					.workspace-sidebar .compact-subscription-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
					.workspace-sidebar .subscription-card { padding: 14px; }
					.workspace-sidebar .subscription-head { min-height: 42px; }
					.workspace-sidebar .format-icon { width: 34px; height: 34px; }
					.workspace-sidebar .link-row { margin-top: 11px; }
					.compact-subscription-grid .subscription-card { padding: 12px; }
					.compact-subscription-grid .subscription-head { gap: 8px; min-height: 34px; }
					.compact-subscription-grid .format-icon { width: 32px; height: 32px; }
					.compact-subscription-grid .format-icon svg { width: 17px; height: 17px; }
					.compact-subscription-grid .subscription-head h3 { margin-top: 0; font-size: 13px; }
					.compact-subscription-grid .subscription-head p, .compact-subscription-grid .link-row code { display: none; }
					.compact-subscription-grid .link-row { grid-template-columns: minmax(0, 1fr) 34px; }
					.compact-subscription-grid .link-row .copy-button { grid-column: 1; grid-row: 1; }
					.compact-subscription-grid .link-row .icon-button { grid-column: 2; grid-row: 1; }
					.subscription-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
					.subscription-card { min-width: 0; padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 3px 12px rgba(26, 46, 35, .025); }
					.subscription-head { display: flex; gap: 12px; min-height: 48px; }
					.format-icon { flex: 0 0 auto; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 7px; background: var(--green-soft); color: var(--green); }
					.format-icon svg { width: 19px; height: 19px; }
					.subscription-head h3 { display: flex; align-items: center; gap: 8px; margin: 1px 0 4px; font-size: 14px; }
					.subscription-head p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
					.badge { padding: 2px 6px; border-radius: 4px; background: var(--amber-soft); color: var(--amber); font-size: 10px; font-weight: 800; }
					.link-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 34px auto; gap: 7px; margin-top: 15px; }
					.link-row code { min-width: 0; height: 34px; display: block; overflow: hidden; padding: 8px 10px; border: 1px solid var(--line-soft); border-radius: 6px; background: var(--surface-soft); color: #46514b; font: 11px/16px ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
					.icon-button, .copy-button, .primary-button { border: 0; border-radius: 6px; cursor: pointer; transition: background .16s ease, transform .16s ease, opacity .16s ease; }
					.icon-button { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--line); background: var(--surface); color: var(--muted); }
					.icon-button svg { width: 16px; height: 16px; }
					.copy-button, .primary-button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; background: var(--green); color: #fff; font-size: 12px; font-weight: 750; }
					.copy-button svg, .primary-button svg { width: 15px; height: 15px; }
					.icon-button:hover { background: var(--surface-soft); color: var(--green); }
					.copy-button:hover, .primary-button:hover { background: var(--green-dark); }
					.icon-button:active, .copy-button:active, .primary-button:active { transform: translateY(1px); }
					details.guest-panel { margin-top: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
					details.guest-panel > summary { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 18px; cursor: pointer; list-style: none; font-weight: 750; }
					details.guest-panel > summary::-webkit-details-marker { display: none; }
					.summary-label { display: flex; align-items: center; gap: 10px; }
					.summary-label svg { width: 18px; color: var(--green); }
					.summary-meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; font-weight: 500; }
					.summary-meta svg { width: 16px; transition: transform .18s ease; }
					details[open] .summary-meta svg { transform: rotate(180deg); }
					.guest-body { padding: 0 18px 18px; border-top: 1px solid var(--line-soft); }
					.guest-note { display: flex; align-items: flex-start; gap: 10px; margin: 16px 0; padding: 12px; border: 1px solid #ead9ae; border-radius: 6px; background: var(--amber-soft); color: #75521b; font-size: 12px; line-height: 1.55; }
					.guest-note svg { flex: 0 0 auto; width: 17px; margin-top: 1px; }
					.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); }
					.setting { min-width: 0; padding: 18px; }
					.setting + .setting { border-left: 1px solid var(--line-soft); }
					.setting-label { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--muted); font-size: 12px; font-weight: 700; }
					.setting-label svg { width: 15px; color: var(--green); }
					.setting code { display: block; overflow: hidden; color: var(--text); font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
					.converter-list { display: flex; flex-direction: column; gap: 7px; }
					.converter-entry { min-width: 0; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 7px; }
					.converter-entry b { padding: 2px 4px; border-radius: 4px; background: var(--green-soft); color: var(--green); font-size: 10px; text-align: center; }
					.converter-picker { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
					.converter-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
					.converter-option { display: flex; align-items: flex-start; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
					.converter-option:has(input:checked) { border-color: #8bc5a7; background: var(--green-soft); }
					.converter-option input { margin: 3px 0 0; accent-color: var(--green); }
					.converter-option strong, .converter-option small { display: block; }
					.converter-option strong { font-size: 12px; }
					.converter-option small { margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.4; }
					.custom-converter-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-top: 10px; }
					.custom-converter-row input { min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
					.custom-converter-row input:focus { border-color: #72ad90; outline: 3px solid rgba(23, 107, 73, .12); }
					.converter-help { margin: 9px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
					.converter-help strong { color: var(--green); }
					.converter-picker + .settings-grid { margin-top: 10px; }
					.workspace-config .converter-options, .workspace-config .custom-converter-row, .workspace-config .settings-grid { grid-template-columns: 1fr; }
					.workspace-config .custom-converter-row .tool-button { width: 100%; }
					.workspace-config .setting + .setting { border-top: 1px solid var(--line-soft); border-left: 0; }
					.request-list { max-height: 360px; border: 1px solid var(--line); border-radius: 8px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; background: var(--surface); }
					.request-client { min-width: 0; padding: 12px 14px; }
					.request-client + .request-client { border-top: 1px solid var(--line-soft); }
					.request-client-head, .request-client-meta, .request-access { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
					.request-client-head strong { font-size: 13px; }
					.request-client-head > span { flex: 0 0 auto; padding: 2px 7px; border-radius: 999px; background: var(--green-soft); color: var(--green-dark); font-size: 10px; font-weight: 800; }
					.request-client-meta { margin-top: 5px; color: var(--muted); font-size: 10px; }
					.request-client-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
					.request-client-meta time { flex: 0 0 auto; }
					.request-client code { display: block; margin-top: 7px; overflow: hidden; color: #53605a; font: 10px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
					.request-access { justify-content: flex-start; margin-top: 6px; color: var(--muted); font-size: 9px; }
					.request-empty { padding: 22px 14px; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); font-size: 12px; text-align: center; }
					.editor-shell { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); box-shadow: var(--shadow); }
					.editor-toolbar { min-height: 54px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 18px; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); }
					.editor-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; color: var(--muted); font-size: 12px; }
					.editor-meta span { display: inline-flex; align-items: center; gap: 6px; }
					.editor-meta svg { width: 14px; }
					.editor-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; }
					.save-state { color: var(--muted); }
					.save-state.dirty { color: var(--amber); }
					.save-state.error { color: var(--danger); }
					.tool-button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 11px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px; font-weight: 700; }
					.tool-button:hover { background: var(--surface-soft); color: var(--green); }
					.tool-button:disabled { cursor: not-allowed; opacity: .45; }
					.tool-button svg { width: 15px; height: 15px; }
					.primary-button { min-height: 36px; padding: 0 15px; }
					.primary-button:disabled { cursor: wait; opacity: .64; }
					.editor-insights { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--line-soft); background: var(--surface); }
					.metric { min-width: 0; padding: 11px 14px; }
					.metric + .metric { border-left: 1px solid var(--line-soft); }
					.metric span { display: block; color: var(--muted); font-size: 11px; }
					.metric strong { display: block; margin-top: 3px; font-size: 16px; }
					.validation-panel { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); background: var(--surface-soft); }
					.validation-status { display: flex; align-items: center; gap: 8px; color: var(--green); font-size: 12px; font-weight: 700; }
					.validation-status.has-issues { color: var(--danger); }
					.validation-status svg { width: 15px; height: 15px; }
					.protocol-breakdown { flex: 1; color: var(--muted); font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; text-align: center; }
					.validation-issues { max-width: 65%; color: var(--danger); font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; text-align: right; }
					.editor { width: 100%; height: calc(100vh - 300px); min-height: 560px; max-height: 760px; display: block; resize: vertical; margin: 0; padding: 18px; border: 0; background: #fbfcfa; color: #25312b; font: 13px/1.75 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
					.empty-state { padding: 34px; border: 1px dashed #ccd3cc; border-radius: 8px; background: rgba(255,255,255,.6); text-align: center; }
					.empty-state svg { width: 30px; height: 30px; margin-bottom: 8px; color: var(--amber); }
					.empty-state h3 { margin: 0 0 7px; font-size: 15px; }
					.empty-state p { margin: 0; color: var(--muted); font-size: 13px; }
					.page-footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 46px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
					.page-footer a { color: var(--green); text-decoration: none; }
					dialog { width: min(92vw, 360px); padding: 0; border: 0; border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: 0 28px 80px rgba(14, 34, 24, .25); }
					dialog::backdrop { background: rgba(15, 28, 21, .48); backdrop-filter: blur(3px); }
					dialog.tool-dialog { width: min(92vw, 480px); }
					.dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 15px 16px; border-bottom: 1px solid var(--line-soft); }
					.dialog-head strong { font-size: 14px; }
					.dialog-body { padding: 22px; text-align: center; }
					.tool-dialog .dialog-body { text-align: left; }
					.preview-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
					.preview-summary span { padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-soft); color: var(--muted); font-size: 11px; }
					.preview-summary strong { display: block; margin-top: 3px; color: var(--text); font-size: 18px; }
					.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
					#qrcode { min-height: 220px; display: grid; place-items: center; }
					#qrcode img, #qrcode canvas { max-width: 100%; height: auto; padding: 8px; border: 1px solid var(--line-soft); border-radius: 6px; }
					.qr-url { margin: 14px 0 0; overflow-wrap: anywhere; color: var(--muted); font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
					.toast { position: fixed; z-index: 10; left: 50%; bottom: 24px; max-width: calc(100vw - 32px); display: flex; align-items: center; gap: 9px; padding: 10px 14px; border-radius: 6px; background: #17211d; color: #fff; box-shadow: 0 10px 28px rgba(20, 35, 27, .22); font-size: 13px; opacity: 0; pointer-events: none; transform: translate(-50%, 12px); transition: opacity .2s ease, transform .2s ease; }
					.toast.show { opacity: 1; transform: translate(-50%, 0); }
					.toast svg { width: 16px; color: #62d297; }
					@media (max-width: 1180px) {
						.header-overview .intro-copy { display: none; }
						.header-tabs a { padding: 0 10px; }
						.workspace-grid { grid-template-columns: 230px minmax(0, 1fr); grid-template-areas: "config main" "sidebar sidebar"; }
						.workspace-sidebar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
					}
					@media (max-width: 980px) {
						.workspace-grid { grid-template-columns: 1fr; grid-template-areas: "main" "config" "sidebar"; }
						.workspace-sidebar { display: flex; }
					}
					@media (max-width: 760px) {
						.header-inner, main { width: min(100% - 28px, 1440px); }
						.header-inner { flex-wrap: wrap; gap: 0 12px; padding: 9px 0; }
						.header-overview { order: 1; flex: 0 0 100%; padding: 0 0 7px; border-bottom: 1px solid var(--line-soft); }
						.header-overview .eyebrow, .header-overview .intro-copy { display: none; }
						.header-overview h1 { font-size: 20px; }
						.header-tabs { order: 2; width: 100%; min-height: 42px; border-bottom: 1px solid var(--line-soft); }
						.header-tabs a { padding: 0 14px; }
						.header-actions { order: 3; width: 100%; margin-left: 0; padding-top: 8px; justify-content: space-between; }
						.header-actions .token-chip { max-width: 180px; padding: 7px 9px; }
						.header-actions .token-chip span { display: none; }
						main { padding-top: 14px; }
						.workspace-sidebar .subscription-grid { grid-template-columns: 1fr; }
						.workspace-sidebar .compact-subscription-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
						.subscription-grid, .settings-grid { grid-template-columns: 1fr; }
						.setting + .setting { border-top: 1px solid var(--line-soft); border-left: 0; }
						.editor-insights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
						.metric:nth-child(3) { border-top: 1px solid var(--line-soft); border-left: 0; }
						.metric:nth-child(4) { border-top: 1px solid var(--line-soft); }
						.validation-panel { display: block; }
						.protocol-breakdown { display: block; margin-top: 6px; text-align: left; }
						.validation-issues { max-width: none; margin-top: 6px; text-align: left; }
						.page-footer { flex-direction: column; }
					}
					@media (max-width: 480px) {
						.workspace-sidebar .compact-subscription-grid { grid-template-columns: 1fr; }
						.online { width: 9px; height: 9px; padding: 0; border: 0; font-size: 0; background: #21a464; box-shadow: 0 0 0 4px rgba(33, 164, 100, .13); }
						.online::before { display: none; }
						.subscription-card { padding: 15px; }
						.link-row { grid-template-columns: minmax(0, 1fr) 34px 40px; }
						.copy-button { width: 40px; padding: 0; }
						.copy-button span { display: none; }
						.summary-meta span { display: none; }
						.editor-toolbar { align-items: flex-start; }
						.editor-meta { flex-direction: column; align-items: flex-start; gap: 5px; }
						.editor-actions { width: 100%; justify-content: flex-start; }
						.editor-actions .primary-button { margin-left: auto; }
						.editor { height: 56vh; min-height: 430px; padding: 14px; }
					}
					@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
				</style>
				<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js" defer></script>
				<script src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js" defer></script>
			</head>
			<body>
				${renderTopbar('home')}
				<main>
					<div class="workspace-grid">
						<aside class="workspace-config" aria-label="当前转换信息">
							<section class="section" aria-labelledby="converter-info-title">
								<div class="section-heading"><div><h2 id="converter-info-title">转换信息</h2><p>配置请前往设置页面修改</p></div></div>
								<div class="settings-grid">
									<div class="setting"><span class="setting-label"><i data-lucide="server-cog"></i>当前转换后端</span><div class="converter-list">${activeConverterHTML}</div></div>
									<div class="setting"><span class="setting-label"><i data-lucide="file-cog"></i>规则配置</span><code title="${escapeHTML(runtime.subConfig)}">${escapeHTML(runtime.subConfig)}</code></div>
								</div>
								<a class="tool-button" href="/settings" style="width:100%;margin-top:10px;text-decoration:none"><i data-lucide="settings"></i><span>前往设置</span></a>
							</section>
						</aside>

						<section class="section workspace-main" aria-labelledby="editor-title">
							<div class="section-heading"><div><h2 id="editor-title">节点与订阅源</h2><p>每行填写一个节点链接或订阅地址</p></div></div>
							${hasKV ? `
							<div class="editor-shell">
								<div class="editor-toolbar">
									<div class="editor-meta">
										<span><i data-lucide="list"></i><b id="lineCount">0</b> 行</span>
										<span id="saveStatus" class="save-state">已同步</span>
										<span><i data-lucide="clock-3"></i><span id="lastSaved" data-saved-at="${escapeHTML(savedMetadata.savedAt || "")}">读取中</span></span>
									</div>
									<div class="editor-actions">
										<button class="tool-button" type="button" onclick="openDedupePreview()"><i data-lucide="list-checks"></i><span>去重</span></button>
										<button class="tool-button" id="undoButton" type="button" onclick="undoLastChange()" disabled><i data-lucide="undo-2"></i><span>撤销</span></button>
										<button class="tool-button" type="button" onclick="loadLastSavedVersion()"><i data-lucide="history"></i><span>上次版本</span></button>
										<button class="tool-button" type="button" onclick="downloadBackup()"><i data-lucide="download"></i><span>备份</span></button>
										<button class="tool-button" type="button" onclick="document.getElementById('restoreInput').click()"><i data-lucide="upload"></i><span>导入</span></button>
										<input id="restoreInput" type="file" accept=".txt,.conf,.list,text/plain" hidden>
										<button class="primary-button" id="saveButton" type="button" onclick="saveContent()"><i data-lucide="save"></i><span>保存更改</span></button>
									</div>
								</div>
								<div class="editor-insights" aria-label="内容统计">
									<div class="metric"><span>节点</span><strong id="nodeCount">0</strong></div>
									<div class="metric"><span>订阅源</span><strong id="sourceCount">0</strong></div>
									<div class="metric"><span>重复</span><strong id="duplicateCount">0</strong></div>
									<div class="metric"><span>格式问题</span><strong id="issueCount">0</strong></div>
								</div>
								<div class="validation-panel">
									<span class="validation-status" id="validationStatus"><i data-lucide="circle-check"></i><span>格式检查通过</span></span>
									<span class="protocol-breakdown" id="protocolBreakdown">暂无节点协议</span>
									<span class="validation-issues" id="validationIssues"></span>
								</div>
								<textarea class="editor" id="content" spellcheck="false" placeholder="vless://...&#10;https://example.com/sub">${escapeHTML(content)}</textarea>
							</div>` : `
							<div class="empty-state"><i data-lucide="database-zap"></i><h3>尚未绑定 KV 命名空间</h3><p>请在 Cloudflare 中绑定变量名为 KV 的命名空间后再编辑订阅源。</p></div>`}
						</section>

						<aside class="workspace-sidebar" aria-label="主订阅入口">
							<section class="section" aria-labelledby="owner-title">
								<div class="section-heading"><div><h2 id="owner-title">我的订阅</h2><p>复制链接，或扫码导入客户端</p></div></div>
								<div class="subscription-grid compact-subscription-grid">${renderSubscriptions(false)}</div>
							</section>

						</aside>
					</div>

					<footer class="page-footer"><span>Node2Link · Powered by Cloudflare Workers</span><span>当前设备：${escapeHTML(request.headers.get("User-Agent") || "Unknown")}</span></footer>
				</main>

				<dialog id="qrDialog" aria-labelledby="qrTitle">
					<div class="dialog-head"><strong id="qrTitle">扫描二维码导入</strong><button class="icon-button" type="button" onclick="closeQR()" aria-label="关闭" title="关闭"><i data-lucide="x"></i></button></div>
					<div class="dialog-body"><div id="qrcode"></div><p class="qr-url" id="qrUrl"></p></div>
				</dialog>
				<dialog id="toolDialog" class="tool-dialog" aria-labelledby="toolDialogTitle">
					<div class="dialog-head"><strong id="toolDialogTitle">整理节点与订阅源</strong><button class="icon-button" type="button" onclick="closeToolDialog()" aria-label="关闭" title="关闭"><i data-lucide="x"></i></button></div>
					<div class="dialog-body">
						<p id="dedupeDescription">将删除空行并合并完全重复的链接，原内容不会立即写入 KV。</p>
						<div class="preview-summary"><span>原始行数<strong id="previewBefore">0</strong></span><span>重复行<strong id="previewDuplicates">0</strong></span><span>整理后<strong id="previewAfter">0</strong></span></div>
						<div class="dialog-actions"><button class="tool-button" type="button" onclick="closeToolDialog()">取消</button><button class="primary-button" id="applyDedupeButton" type="button" onclick="applyDedupe()"><i data-lucide="list-checks"></i><span>应用整理</span></button></div>
					</div>
				</dialog>
				<div class="toast" id="toast" role="status" aria-live="polite"><i data-lucide="circle-check"></i><span id="toastText">已复制</span></div>

				<script>
					var toastTimer;
					var originalContent = "";
					var undoStack = [];
					var pendingDedupeContent = "";
					var savedMetadata = ${JSON.stringify(savedMetadata)};
					var draftStorageKey = "node2link:draft:" + window.location.host + window.location.pathname;

					function initializeIcons() {
						if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
					}

					function showToast(message) {
						var toast = document.getElementById("toast");
						document.getElementById("toastText").textContent = message;
						toast.classList.add("show");
						clearTimeout(toastTimer);
						toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2200);
					}

					function localizeRequestTimes() {
						document.querySelectorAll("[data-request-time]").forEach(function (element) {
							var value = element.dataset.requestTime;
							if (value) element.textContent = new Date(value).toLocaleString();
						});
					}

					function copyText(text) {
						if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
						var helper = document.createElement("textarea");
						helper.value = text;
						helper.style.position = "fixed";
						helper.style.opacity = "0";
						document.body.appendChild(helper);
						helper.select();
						var copied = document.execCommand("copy");
						helper.remove();
						return copied ? Promise.resolve() : Promise.reject(new Error("copy failed"));
					}

					function copySubscription(button) {
						copyText(button.dataset.url).then(function () {
							showToast("订阅地址已复制");
							button.querySelector("span").textContent = "已复制";
							setTimeout(function () { button.querySelector("span").textContent = "复制"; }, 1600);
						}).catch(function () { showToast("复制失败，请手动选择链接"); });
					}

					function showQRCode(button) {
						var text = button.dataset.url;
						var container = document.getElementById("qrcode");
						container.innerHTML = "";
						document.getElementById("qrUrl").textContent = text;
						if (window.QRCode) {
							new QRCode(container, { text: text, width: 220, height: 220, colorDark: "#17211d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.Q });
						} else {
							container.textContent = "二维码组件加载失败";
						}
						var dialog = document.getElementById("qrDialog");
						if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
					}

					function closeQR() {
						var dialog = document.getElementById("qrDialog");
						if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
					}

					function escapeClientHTML(value) {
						return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
					}

					function analyzeContent(value) {
						var lines = value ? value.split(/\\r?\\n/) : [];
						var supportedProtocols = ["vless", "vmess", "trojan", "ss", "ssr", "hysteria", "hysteria2", "hy2", "tuic", "wireguard", "socks", "socks5"];
						var seen = new Set();
						var protocols = {};
						var result = { lines: lines.length, nodes: 0, sources: 0, duplicates: 0, blank: 0, issues: [], protocols: protocols };
						lines.forEach(function (line, index) {
							var trimmed = line.trim();
							if (!trimmed) { result.blank += 1; return; }
							if (seen.has(trimmed)) result.duplicates += 1;
							else seen.add(trimmed);
							if (/^https?:\\/\\//i.test(trimmed)) { result.sources += 1; return; }
							var match = trimmed.match(/^([a-z0-9+.-]+):\\/\\//i);
							var protocol = match ? match[1].toLowerCase() : "";
							if (supportedProtocols.includes(protocol)) {
								result.nodes += 1;
								protocols[protocol] = (protocols[protocol] || 0) + 1;
							} else {
								result.issues.push({ line: index + 1, value: trimmed, reason: match ? "不支持的协议 " + protocol : "无法识别链接格式" });
							}
						});
						return result;
					}

					function updateEditorInsights() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						var analysis = analyzeContent(textarea.value);
						document.getElementById("lineCount").textContent = analysis.lines;
						document.getElementById("nodeCount").textContent = analysis.nodes;
						document.getElementById("sourceCount").textContent = analysis.sources;
						document.getElementById("duplicateCount").textContent = analysis.duplicates;
						document.getElementById("issueCount").textContent = analysis.issues.length;
						var protocolText = Object.keys(analysis.protocols).sort().map(function (protocol) { return protocol.toUpperCase() + " " + analysis.protocols[protocol]; }).join(" · ");
						document.getElementById("protocolBreakdown").textContent = protocolText || "暂无节点协议";
						var status = document.getElementById("validationStatus");
						var issues = document.getElementById("validationIssues");
						if (analysis.issues.length) {
							status.classList.add("has-issues");
							status.querySelector("span").textContent = "发现 " + analysis.issues.length + " 个格式问题";
							issues.innerHTML = analysis.issues.slice(0, 4).map(function (issue) { return "第 " + issue.line + " 行：" + escapeClientHTML(issue.reason); }).join("<br>");
							if (analysis.issues.length > 4) issues.innerHTML += "<br>另有 " + (analysis.issues.length - 4) + " 项";
						} else {
							status.classList.remove("has-issues");
							status.querySelector("span").textContent = "格式检查通过";
							issues.textContent = "";
						}
					}

					function updateLineCount() { updateEditorInsights(); }

					function buildDedupeContent(value) {
						var lines = value ? value.split(/\\r?\\n/) : [];
						var seen = new Set();
						var unique = [];
						var duplicates = 0;
						lines.forEach(function (line) {
							var trimmed = line.trim();
							if (!trimmed) return;
							if (seen.has(trimmed)) { duplicates += 1; return; }
							seen.add(trimmed);
							unique.push(trimmed);
						});
						return { content: unique.join("\\n"), before: lines.length, duplicates: duplicates, after: unique.length };
					}

					function openDedupePreview() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						var preview = buildDedupeContent(textarea.value);
						pendingDedupeContent = preview.content;
						document.getElementById("previewBefore").textContent = preview.before;
						document.getElementById("previewDuplicates").textContent = preview.duplicates;
						document.getElementById("previewAfter").textContent = preview.after;
						document.getElementById("applyDedupeButton").disabled = preview.content === textarea.value;
						var dialog = document.getElementById("toolDialog");
						if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
					}

					function closeToolDialog() {
						var dialog = document.getElementById("toolDialog");
						if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
					}

					function pushUndoSnapshot(value) {
						if (undoStack[undoStack.length - 1] !== value) undoStack.push(value);
						if (undoStack.length > 10) undoStack.shift();
						document.getElementById("undoButton").disabled = undoStack.length === 0;
					}

					function storeLocalDraft(value) {
						try { window.localStorage.setItem(draftStorageKey, value); }
						catch (error) { console.warn("无法保存本地草稿:", error); }
					}

					function clearLocalDraft() {
						try { window.localStorage.removeItem(draftStorageKey); }
						catch (error) { console.warn("无法清除本地草稿:", error); }
					}

					function restoreLocalDraft(textarea) {
						try {
							var draft = window.localStorage.getItem(draftStorageKey);
							if (draft === null || draft === originalContent) return;
							if (window.confirm("发现尚未保存的本地草稿，是否恢复到编辑器？")) {
								textarea.value = draft;
								updateEditorInsights();
								setSaveState("已恢复本地草稿，尚未保存", "dirty");
							} else {
								clearLocalDraft();
							}
						} catch (error) {
							console.warn("无法读取本地草稿:", error);
						}
					}

					function markEditorDirty(message) {
						updateEditorInsights();
						setSaveState(message || "有未保存更改", "dirty");
						var textarea = document.getElementById("content");
						if (textarea) storeLocalDraft(textarea.value);
					}

					function applyDedupe() {
						var textarea = document.getElementById("content");
						if (!textarea || pendingDedupeContent === textarea.value) { closeToolDialog(); return; }
						pushUndoSnapshot(textarea.value);
						textarea.value = pendingDedupeContent;
						markEditorDirty("整理结果尚未保存");
						closeToolDialog();
						showToast("已整理，可撤销或保存");
					}

					function undoLastChange() {
						var textarea = document.getElementById("content");
						if (!textarea || !undoStack.length) return;
						textarea.value = undoStack.pop();
						document.getElementById("undoButton").disabled = undoStack.length === 0;
						markEditorDirty("已撤销，尚未保存");
						showToast("已恢复上一个版本");
					}

					function downloadBackup() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						var blob = new Blob([textarea.value], { type: "text/plain;charset=utf-8" });
						var href = URL.createObjectURL(blob);
						var anchor = document.createElement("a");
						anchor.href = href;
						anchor.download = "node2link-backup-" + new Date().toISOString().slice(0, 10) + ".txt";
						anchor.click();
						setTimeout(function () { URL.revokeObjectURL(href); }, 0);
						showToast("备份已下载");
					}

					function restoreBackup(file) {
						var textarea = document.getElementById("content");
						if (!file || !textarea) return;
						file.text().then(function (restoredContent) {
							if (!window.confirm("将备份内容载入编辑器？当前内容可通过撤销恢复。")) return;
							pushUndoSnapshot(textarea.value);
							textarea.value = restoredContent;
							markEditorDirty("备份已载入，尚未保存");
							showToast("备份已载入编辑器");
						}).catch(function () { showToast("无法读取备份文件"); });
					}

					function loadLastSavedVersion() {
						var textarea = document.getElementById("content");
						if (!textarea) return;
						fetch(window.location.href, {
							method: "POST",
							headers: { "X-Node2Link-Action": "get-backup" },
							cache: "no-cache"
						})
							.then(function (response) {
								return response.json().then(function (result) {
									if (!response.ok) throw new Error(result.message || "无法读取上次版本");
									return result;
								});
							})
							.then(function (result) {
								var savedAt = result.metadata && result.metadata.savedAt ? new Date(result.metadata.savedAt).toLocaleString() : "时间未知";
								if (!window.confirm("将上次保存版本（" + savedAt + "）载入编辑器？当前内容可通过撤销恢复。")) return;
								pushUndoSnapshot(textarea.value);
								textarea.value = result.content;
								markEditorDirty("上次版本已载入，尚未保存");
								showToast("已载入上次保存版本");
							})
							.catch(function (error) { showToast(error.message); });
					}

					function formatBytes(bytes) {
						if (bytes < 1024) return bytes + " B";
						return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
					}

					function updateSavedMetadata(metadata) {
						savedMetadata = metadata || savedMetadata;
						var element = document.getElementById("lastSaved");
						if (!element) return;
						if (!savedMetadata.savedAt) element.textContent = "尚无保存记录 · " + formatBytes(savedMetadata.bytes || 0);
						else element.textContent = new Date(savedMetadata.savedAt).toLocaleString() + " · " + formatBytes(savedMetadata.bytes || 0) + " · " + (savedMetadata.lines || 0) + " 行";
					}

					function setSaveState(message, state) {
						var status = document.getElementById("saveStatus");
						if (!status) return;
						status.textContent = message;
						status.className = "save-state" + (state ? " " + state : "");
					}

					function saveContent() {
						var textarea = document.getElementById("content");
						var button = document.getElementById("saveButton");
						if (!textarea || !button || button.disabled) return Promise.resolve();
						if (textarea.value === originalContent) { setSaveState("已同步", ""); return Promise.resolve(); }
						var contentToSave = textarea.value;
						button.disabled = true;
						button.querySelector("span").textContent = "保存中";
						setSaveState("正在保存…", "");
						return fetch(window.location.href, { method: "POST", body: contentToSave, headers: { "Content-Type": "text/plain;charset=UTF-8" }, cache: "no-cache" })
							.then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); })
							.then(function (result) {
								originalContent = contentToSave;
								updateSavedMetadata(result.metadata);
								if (textarea.value === contentToSave) {
									clearLocalDraft();
									setSaveState("刚刚已保存", "");
									showToast("节点与订阅源已保存");
								} else {
									storeLocalDraft(textarea.value);
									updateEditorInsights();
									setSaveState("保存期间有新修改，请再次保存", "dirty");
									showToast("旧内容已保存，新修改尚未保存");
								}
							})
							.catch(function (error) { setSaveState("保存失败：" + error.message, "error"); showToast("保存失败，请稍后重试"); })
							.finally(function () { button.disabled = false; button.querySelector("span").textContent = "保存更改"; });
					}

					document.addEventListener("DOMContentLoaded", function () {
						initializeIcons();
						setTimeout(initializeIcons, 500);
						localizeRequestTimes();
						var textarea = document.getElementById("content");
						if (textarea) {
							originalContent = textarea.value;
							updateEditorInsights();
							updateSavedMetadata(savedMetadata);
							restoreLocalDraft(textarea);
							textarea.addEventListener("input", function () {
								markEditorDirty("有未保存更改");
							});
							document.getElementById("restoreInput").addEventListener("change", function (event) {
								restoreBackup(event.target.files[0]);
								event.target.value = "";
							});
						}
						var qrDialog = document.getElementById("qrDialog");
						var toolDialog = document.getElementById("toolDialog");
						qrDialog.addEventListener("click", function (event) { if (event.target === qrDialog) closeQR(); });
						toolDialog.addEventListener("click", function (event) { if (event.target === toolDialog) closeToolDialog(); });
					});

					document.addEventListener("keydown", function (event) {
						if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveContent(); }
						if (event.key === "Escape" && document.getElementById("qrDialog").open) closeQR();
						if (event.key === "Escape" && document.getElementById("toolDialog").open) closeToolDialog();
					});

					window.addEventListener("beforeunload", function (event) {
						var textarea = document.getElementById("content");
						if (textarea && textarea.value !== originalContent) {
							event.preventDefault();
							event.returnValue = "";
						}
					});
				</script>
			</body>
			</html>`;

		return new Response(html, {
			headers: {
				"Content-Type": "text/html;charset=utf-8",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff"
			}
		});
	} catch (error) {
		console.error("处理管理页请求时发生错误:", error);
		return new Response("服务器错误: " + error.message, {
			status: 500,
			headers: { "Content-Type": "text/plain;charset=utf-8" }
		});
	}
}
