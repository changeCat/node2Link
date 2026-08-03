
// 部署完成后在网址后面加上这个，获取自建节点和机场聚合节点，/?token=auto或/auto或

const DEFAULT_TOKEN = 'auto';
const DEFAULT_GUEST_TOKEN = '';
const DEFAULT_FILE_NAME = 'CF-Workers-SUB';
const DEFAULT_SUB_UPDATE_TIME = 6;
const DEFAULT_MAIN_DATA = `
https://cfxr.eu.org/getSub
`;
const DEFAULT_SUB_CONVERTER = 'https://SUBAPI.cmliussss.net';
const DEFAULT_SUB_CONFIG = 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini';
const SETTINGS_KEY = 'NODE2LINK.settings.json';
const REQUEST_LOG_PREFIX = 'NODE2LINK.request.';
const REQUEST_LOG_TTL = 30 * 24 * 60 * 60;
const REQUEST_LOG_LIMIT = 5000;
const subscriptionNotificationCache = new Map();
const subscriptionNotificationCooldown = 10 * 1000;

export default {
	async fetch(request, env, ctx) {
		const runtime = await createRuntimeConfig(env);
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : 'null';
		const url = new URL(request.url);
		const token = url.searchParams.get('token');
		const currentDate = new Date();
		currentDate.setHours(0, 0, 0, 0);
		const timeTemp = Math.ceil(currentDate.getTime() / 1000);
		const fakeToken = await MD5MD5(`${runtime.mytoken}${timeTemp}`);
		const visitorToken = runtime.guestToken || await MD5MD5(runtime.mytoken);
		const isAuthorized = [runtime.mytoken, fakeToken, visitorToken].includes(token)
			|| url.pathname === '/' + runtime.mytoken
			|| url.pathname.includes('/' + runtime.mytoken + '?');

		if (!isAuthorized) {
			if (runtime.TG === 1 && url.pathname !== '/' && url.pathname !== '/favicon.ico') {
				queueTelegram(ctx, sendMessage(runtime, `#异常访问 ${runtime.FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgent}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`));
			}
			if (env.URL302) return Response.redirect(env.URL302, 302);
			if (env.URL) return proxyURL(env.URL, url);
			return new Response(await nginx(), { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
		}

		const persistedSettings = await readPersistedSettings(env);
		const persistedCustomConverterURL = normalizeSublinkConverter(persistedSettings.customConverterURL);
		runtime.converterMode = persistedSettings.converterMode === 'custom' && persistedCustomConverterURL ? 'custom' : 'default';
		runtime.customConverterURL = persistedCustomConverterURL;
		const customSublinkConverter = runtime.converterMode === 'custom'
			? runtime.customConverterURL
			: (!env.KV ? normalizeSublinkConverter(url.searchParams.get('converter')) : '');

		let mainData = DEFAULT_MAIN_DATA;
		let urls = [];
		if (env.KV) {
			await 迁移地址列表(env, 'LINK.txt');
			if (userAgent.includes('mozilla') && !url.search) {
				queueTelegram(ctx, sendMessage(runtime, `#编辑订阅 ${runtime.FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgentHeader}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`));
				return KV(request, env, 'LINK.txt', visitorToken, runtime);
			}
			mainData = await env.KV.get('LINK.txt') || DEFAULT_MAIN_DATA;
		} else {
			mainData = env.LINK || DEFAULT_MAIN_DATA;
			if (env.LINKSUB) urls = await ADD(env.LINKSUB);
		}

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
		const isInternalSubscriptionRequest = token === fakeToken || isSubConverterRequest;
		if (!isInternalSubscriptionRequest && request.method === 'GET' && shouldSendSubscriptionNotification(request)) {
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

		let converterSourceURL = `${url.origin}/${await MD5MD5(fakeToken)}?token=${fakeToken}`;
		let requestData = mainData;
		let appendUA = 'v2rayn';
		let usedConverter = '';
		if (url.searchParams.has('b64') || url.searchParams.has('base64')) subscriptionFormat = 'base64';
		else if (url.searchParams.has('clash')) appendUA = 'clash';
		else if (url.searchParams.has('singbox')) appendUA = 'singbox';
		else if (url.searchParams.has('surge')) appendUA = 'surge';
		else if (url.searchParams.has('quanx')) appendUA = 'Quantumult%20X';
		else if (url.searchParams.has('loon')) appendUA = 'Loon';

		if (!isInternalSubscriptionRequest && request.method === 'GET' && runtime.requestLogEnabled) {
			queueSubscriptionRequestLog(ctx, env, {
				client: detectSubscriptionClient(userAgentHeader),
				userAgent: userAgentHeader || 'Unknown',
				format: subscriptionFormat,
				access: token === visitorToken ? 'guest' : 'owner'
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

		if (env.WARP) converterSourceURL += '|' + (await ADD(env.WARP)).join('|');
		const text = new TextDecoder().decode(new TextEncoder().encode(requestData));
		const result = [...new Set(text.split('\n'))].join('\n');
		let base64Data;
		try { base64Data = btoa(result); }
		catch (error) { base64Data = encodeBase64(result); }

		const responseHeaders = {
			'content-type': 'text/plain; charset=utf-8',
			'Profile-Update-Interval': `${runtime.SUBUpdateTime}`,
			'Profile-web-page-url': request.url.includes('?') ? request.url.split('?')[0] : request.url
		};
		if (usedConverter) responseHeaders['X-Subconverter-Used'] = usedConverter;
		if (subscriptionFormat === 'base64' || token === fakeToken) return new Response(base64Data, { headers: responseHeaders });

		const conversionInit = { headers: { 'User-Agent': userAgentHeader || 'CF-Workers-SUB' } };
		const conversionResult = customSublinkConverter && supportsSublinkTarget(subscriptionFormat)
			? await fetchSublinkSubscription(customSublinkConverter, subscriptionFormat, converterSourceURL, conversionInit)
			: await fetchConvertedSubscription(runtime.subConverters, subscriptionFormat, converterSourceURL, runtime.subConfig, conversionInit);
		if (!conversionResult) return new Response(base64Data, { headers: responseHeaders });

		responseHeaders['X-Subconverter-Used'] = conversionResult.converter;
		let convertedContent = await conversionResult.response.text();
		if (subscriptionFormat === 'clash') convertedContent = await clashFix(convertedContent);
		if (!userAgent.includes('mozilla')) responseHeaders['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(runtime.FileName)}`;
		return new Response(convertedContent, { headers: responseHeaders });
	}
};

async function createRuntimeConfig(env) {
	const updateTime = Number(env.SUBUPTIME);
	return {
		mytoken: env.TOKEN || DEFAULT_TOKEN,
		guestToken: env.GUESTTOKEN || env.GUEST || DEFAULT_GUEST_TOKEN,
		BotToken: env.TGTOKEN || '',
		ChatID: env.TGID || '',
		TG: Number(env.TG || 0),
		FileName: env.SUBNAME || DEFAULT_FILE_NAME,
		SUBUpdateTime: Number.isFinite(updateTime) && updateTime > 0 ? updateTime : DEFAULT_SUB_UPDATE_TIME,
		subConfig: env.SUBCONFIG || DEFAULT_SUB_CONFIG,
		subConverters: parseSubConverters(env.SUBAPI || DEFAULT_SUB_CONVERTER),
		converterMode: 'default',
		customConverterURL: '',
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
		access: details.access === 'guest' ? 'guest' : 'owner',
		requestedAt: new Date(now).toISOString()
	};
	await kv.put(REQUEST_LOG_PREFIX + reverseTimestamp + '.' + randomID, '1', {
		metadata,
		expirationTtl: REQUEST_LOG_TTL
	});
}

async function readSubscriptionRequestStats(kv) {
	if (!kv || typeof kv.list !== 'function') return { total: 0, clients: [], truncated: false };
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
		return { total: 0, clients: [], truncated: false };
	}

	const clients = new Map();
	for (const event of events) {
		const clientName = String(event.client || '其他客户端');
		let item = clients.get(clientName);
		if (!item) {
			item = { name: clientName, count: 0, lastRequestedAt: '', lastUserAgent: '', formats: {}, owner: 0, guest: 0 };
			clients.set(clientName, item);
		}
		item.count += 1;
		const format = String(event.format || 'base64');
		item.formats[format] = (item.formats[format] || 0) + 1;
		if (event.access === 'guest') item.guest += 1;
		else item.owner += 1;
		if (!item.lastRequestedAt || String(event.requestedAt || '') > item.lastRequestedAt) {
			item.lastRequestedAt = String(event.requestedAt || '');
			item.lastUserAgent = String(event.userAgent || 'Unknown');
		}
	}

	return {
		total: events.length,
		truncated,
		clients: [...clients.values()].sort((a, b) => b.count - a.count || b.lastRequestedAt.localeCompare(a.lastRequestedAt))
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

async function nginx() {
	const text = `
	<!DOCTYPE html>
	<html lang="zh-CN">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<meta name="color-scheme" content="light">
		<title>Edge Gateway</title>
		<style>
			:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
			* { box-sizing: border-box; }
			body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f2; color: #17211d; }
			main { width: min(92vw, 520px); padding: 32px; border: 1px solid #dfe3dd; border-radius: 8px; background: #fff; box-shadow: 0 16px 50px rgba(28, 43, 35, .08); }
			.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 30px; font-weight: 700; }
			.mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 7px; background: #143f32; color: #fff; font-size: 18px; }
			.status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: #e8f4ed; color: #18613f; font-size: 12px; font-weight: 700; }
			.dot { width: 7px; height: 7px; border-radius: 50%; background: #21a464; box-shadow: 0 0 0 4px rgba(33, 164, 100, .12); }
			h1 { margin: 18px 0 10px; font-size: 38px; line-height: 1.1; letter-spacing: 0; }
			p { margin: 0; color: #68736d; line-height: 1.7; }
			footer { display: flex; justify-content: space-between; gap: 16px; margin-top: 34px; padding-top: 18px; border-top: 1px solid #edf0ec; color: #89918d; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
			@media (max-width: 480px) { main { padding: 24px; } h1 { font-size: 30px; } footer { flex-direction: column; } }
		</style>
	</head>
	<body>
		<main>
			<div class="brand"><span class="mark">E</span><span>Edge Gateway</span></div>
			<span class="status"><span class="dot"></span>All systems operational</span>
			<h1>Service is running.</h1>
			<p>The edge gateway is online and ready to handle requests.</p>
			<footer><span>HTTP 200</span><span>Cloudflare Network</span></footer>
		</main>
	</body>
	</html>
	`
	return text;
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


async function KV(request, env, txt = 'ADD.txt', guest, runtime) {
	const url = new URL(request.url);
	const metaKey = txt + '.meta.json';
	const backupKey = txt.endsWith('.txt') ? txt.slice(0, -4) + '.backup.txt' : txt + '.backup';
	const backupMetaKey = txt.endsWith('.txt') ? txt.slice(0, -4) + '.backup.meta.json' : txt + '.backup.meta.json';
	try {
		if (request.method === "POST") {
			if (!env.KV) return new Response("未绑定 KV 命名空间", { status: 400 });
			try {
				if (request.headers.get('X-Node2Link-Action') === 'save-converter') {
					const payload = await request.json();
					const mode = payload && payload.mode === 'custom' ? 'custom' : 'default';
					const customConverterURL = normalizeSublinkConverter(payload && payload.url);
					if (mode === 'custom' && !customConverterURL) {
						return new Response(JSON.stringify({ ok: false, message: '自建 Sublink Worker 地址无效' }), {
							status: 400,
							headers: { "Content-Type": "application/json;charset=utf-8" }
						});
					}
					const settings = { converterMode: mode, customConverterURL, savedAt: new Date().toISOString() };
					await env.KV.put(SETTINGS_KEY, JSON.stringify(settings));
					return new Response(JSON.stringify({ ok: true, settings }), {
						headers: { "Content-Type": "application/json;charset=utf-8" }
					});
				}

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
		let requestStats = { total: 0, clients: [], truncated: false };
		const hasKV = !!env.KV;
		if (hasKV) {
			try {
				const [storedContent, storedMetadata, storedRequestStats] = await Promise.all([
					env.KV.get(txt),
					env.KV.get(metaKey),
					readSubscriptionRequestStats(env.KV)
				]);
				content = storedContent || "";
				requestStats = storedRequestStats;
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
		const ownerBase = origin + "/" + encodeURIComponent(runtime.mytoken);
		const guestBase = origin + "/sub?token=" + encodeURIComponent(guest);
		const converterListHTML = runtime.subConverters.map((converter, index) =>
			`<span class="converter-entry"><b>${index === 0 ? "主" : "备" + index}</b><code title="${escapeHTML(converter)}">${escapeHTML(converter)}</code></span>`
		).join("");
		const formatNames = { base64: 'Base64', clash: 'Clash', singbox: 'Sing-box', surge: 'Surge', quanx: 'QuanX', loon: 'Loon' };
		const requestStatsHTML = requestStats.clients.slice(0, 10).map((client) => {
			const formats = Object.entries(client.formats)
				.sort((a, b) => b[1] - a[1])
				.map(([format, count]) => `${formatNames[format] || format} ${count}`)
				.join(' · ');
			return `
				<div class="request-client">
					<div class="request-client-head"><strong>${escapeHTML(client.name)}</strong><span>${client.count} 次</span></div>
					<div class="request-client-meta"><span>${escapeHTML(formats || '未知格式')}</span><time data-request-time="${escapeHTML(client.lastRequestedAt)}">${escapeHTML(client.lastRequestedAt || '时间未知')}</time></div>
					<code title="${escapeHTML(client.lastUserAgent)}">${escapeHTML(client.lastUserAgent)}</code>
					<div class="request-access"><span>管理 ${client.owner}</span><span>访客 ${client.guest}</span></div>
				</div>`;
		}).join('');
		const formats = [
			{ name: "智能适配", key: "sub", icon: "sparkles", description: "自动识别客户端并返回合适格式", recommended: true },
			{ name: "Base64", key: "b64", icon: "binary", description: "通用 Base64 编码订阅" },
			{ name: "Clash", key: "clash", icon: "layers-3", description: "适用于 Clash 与 Mihomo" },
			{ name: "Loon", key: "loon", icon: "orbit", description: "适用于 Loon 客户端" }
		];

		const renderSubscriptions = (isGuest = false) => formats.map((format) => {
			const subscriptionURL = isGuest
				? guestBase + (format.key === "sub" ? "" : "&" + format.key)
				: ownerBase + "?" + format.key;
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
				<title>${escapeHTML(runtime.FileName)} · 订阅控制台</title>
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
					button, textarea { font: inherit; }
					button { letter-spacing: 0; }
					button:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid rgba(23, 107, 73, .2); outline-offset: 2px; }
					.app-header { border-bottom: 1px solid var(--line); background: rgba(255, 255, 255, .92); }
					.header-inner { width: 80%; min-height: 70px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
					.brand { min-width: 0; display: flex; align-items: center; gap: 12px; }
					.brand-mark { flex: 0 0 auto; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 7px; background: #143f32; color: #fff; }
					.brand-mark svg { width: 20px; height: 20px; }
					.brand-copy { min-width: 0; }
					.brand-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
					.brand-copy span { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
					.online { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #cce4d6; border-radius: 999px; background: var(--green-soft); color: var(--green-dark); font-size: 12px; font-weight: 700; }
					.online::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #21a464; box-shadow: 0 0 0 3px rgba(33, 164, 100, .13); }
					main { width: 80%; margin: 0 auto; padding: 44px 0 64px; }
					.page-intro { display: flex; align-items: end; justify-content: space-between; gap: 32px; margin-bottom: 30px; }
					.eyebrow { margin: 0 0 8px; color: var(--green); font-size: 12px; font-weight: 800; text-transform: uppercase; }
					h1 { margin: 0; font-size: 42px; line-height: 1.13; letter-spacing: 0; }
					.intro-copy { max-width: 580px; margin: 12px 0 0; color: var(--muted); line-height: 1.7; }
					.token-chip { max-width: 360px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 12px; }
					.token-chip svg { flex: 0 0 auto; width: 16px; height: 16px; color: var(--green); }
					.token-chip code { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
					.section { margin-top: 38px; }
					.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
					.section-heading h2 { margin: 0; font-size: 19px; }
					.section-heading p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
					.workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr) 350px; gap: 20px; align-items: start; }
					.workspace-main, .workspace-sidebar { min-width: 0; }
					.workspace-grid .section { margin-top: 0; }
					.workspace-main { display: flex; flex-direction: column; gap: 26px; }
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
					@media (max-width: 980px) {
						.workspace-grid { grid-template-columns: 1fr; }
					}
					@media (max-width: 760px) {
						.header-inner, main { width: min(100% - 28px, 1440px); }
						main { padding-top: 30px; }
						.page-intro { display: block; }
						.token-chip { max-width: none; margin-top: 18px; }
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
						h1 { font-size: 32px; }
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
				<header class="app-header">
					<div class="header-inner">
						<div class="brand">
							<span class="brand-mark"><i data-lucide="route"></i></span>
							<div class="brand-copy"><strong>${escapeHTML(runtime.FileName)}</strong><span>Subscription Console</span></div>
						</div>
						<span class="online">服务正常</span>
					</div>
				</header>
				<main>
					<section class="page-intro">
						<div>
							<p class="eyebrow">Overview</p>
							<h1>订阅控制台</h1>
							<p class="intro-copy">在一个入口中管理节点来源，并为常用客户端生成对应格式的订阅地址。</p>
						</div>
						<div class="token-chip"><i data-lucide="shield-check"></i><span>当前入口</span><code>/${escapeHTML(runtime.mytoken)}</code></div>
					</section>

					<div class="workspace-grid">
						<div class="workspace-main" aria-label="订阅管理配置">
							<section class="section" aria-labelledby="editor-title">
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

							<section class="section" aria-labelledby="settings-title">
								<div class="section-heading"><div><h2 id="settings-title">转换配置</h2><p>选择默认服务，或接入自建 Sublink Worker</p></div></div>
								<div class="converter-picker">
									<div class="converter-options" role="radiogroup" aria-label="订阅转换服务">
										<label class="converter-option"><input type="radio" name="converterMode" value="default" checked><span><strong>默认服务</strong><small>使用内置 Subconverter</small></span></label>
										<label class="converter-option"><input type="radio" name="converterMode" value="custom"><span><strong>自建服务</strong><small>7Sageer/sublink-worker</small></span></label>
									</div>
									<div class="custom-converter-row">
										<input id="customConverterUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://sub.example.com" aria-label="自建 Sublink Worker 地址">
										<button class="tool-button" id="applyConverterButton" type="button" onclick="applyConverterSelection()">应用</button>
									</div>
									<p class="converter-help" id="converterHelp">当前使用：<strong>默认服务</strong>。选择会持久化到 KV，并对所有设备生效。</p>
								</div>
								<div class="settings-grid">
									<div class="setting"><span class="setting-label"><i data-lucide="server"></i>默认后端</span><div class="converter-list">${converterListHTML}</div></div>
									<div class="setting"><span class="setting-label"><i data-lucide="file-cog"></i>规则配置</span><code title="${escapeHTML(runtime.subConfig)}">${escapeHTML(runtime.subConfig)}</code></div>
								</div>
							</section>
						</div>

						<aside class="workspace-sidebar" aria-label="订阅入口与请求统计">
							<section class="section" aria-labelledby="owner-title">
								<div class="section-heading"><div><h2 id="owner-title">我的订阅</h2><p>复制链接，或扫码导入客户端</p></div></div>
								<div class="subscription-grid compact-subscription-grid">${renderSubscriptions(false)}</div>
							</section>

							<section class="section" aria-labelledby="requests-title">
								<div class="section-heading"><div><h2 id="requests-title">订阅请求</h2><p>近 30 天 · ${requestStats.total}${requestStats.truncated ? '+' : ''} 次，按次数排序 · 滚动查看</p></div></div>
								${requestStatsHTML ? `<div class="request-list">${requestStatsHTML}</div>` : '<div class="request-empty">暂无客户端请求记录</div>'}
							</section>

							<details class="guest-panel">
								<summary>
									<span class="summary-label"><i data-lucide="users"></i>访客订阅</span>
									<span class="summary-meta"><span>仅允许获取订阅</span><i data-lucide="chevron-down"></i></span>
								</summary>
								<div class="guest-body">
									<div class="guest-note"><i data-lucide="shield-alert"></i><span>访客链接无法进入本管理页，适合分享给其他设备或用户。访客 Token：<strong>${escapeHTML(guest)}</strong></span></div>
									<div class="subscription-grid">${renderSubscriptions(true)}</div>
								</div>
							</details>
						</aside>
					</div>

					<footer class="page-footer"><span>${escapeHTML(runtime.FileName)} · Powered by Cloudflare Workers</span><span>当前设备：${escapeHTML(request.headers.get("User-Agent") || "Unknown")}</span></footer>
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
					var initialConverterSettings = ${JSON.stringify({ mode: runtime.converterMode, url: runtime.customConverterURL })};

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

					function normalizeCustomConverter(value) {
						try {
							var parsed = new URL(String(value || "").trim());
							if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "";
							parsed.search = "";
							parsed.hash = "";
							return parsed.toString().replace(/\\/+$/, "");
						} catch (error) { return ""; }
					}

					function setConverterForm(mode, customConverter) {
						var selectedMode = mode === "custom" ? "custom" : "default";
						document.querySelector('input[name="converterMode"][value="' + selectedMode + '"]').checked = true;
						var input = document.getElementById("customConverterUrl");
						input.value = customConverter || "";
						input.disabled = selectedMode !== "custom";
						var help = document.getElementById("converterHelp");
						help.innerHTML = selectedMode === "custom"
							? "当前使用：<strong>自建 Sublink Worker</strong>。已持久化到 KV；支持 Clash、Sing-box、Surge，其他格式仍使用默认服务。"
							: "当前使用：<strong>默认服务</strong>。选择已持久化到 KV，并对所有设备生效。";
					}

					function restoreConverterSelection() {
						var customConverter = normalizeCustomConverter(initialConverterSettings.url);
						var mode = initialConverterSettings.mode === "custom" && customConverter ? "custom" : "default";
						setConverterForm(mode, customConverter);
					}

					function localizeRequestTimes() {
						document.querySelectorAll("[data-request-time]").forEach(function (element) {
							var value = element.dataset.requestTime;
							if (value) element.textContent = new Date(value).toLocaleString();
						});
					}

					function applyConverterSelection() {
						var checked = document.querySelector('input[name="converterMode"]:checked');
						var mode = checked ? checked.value : "default";
						var customConverter = normalizeCustomConverter(document.getElementById("customConverterUrl").value);
						if (mode === "custom" && !customConverter) {
							showToast("请输入有效的 http/https 自建地址");
							document.getElementById("customConverterUrl").focus();
							return;
						}
						var button = document.getElementById("applyConverterButton");
						button.disabled = true;
						button.textContent = "保存中";
						return fetch(window.location.href, {
							method: "POST",
							headers: { "Content-Type": "application/json", "X-Node2Link-Action": "save-converter" },
							body: JSON.stringify({ mode: mode, url: customConverter }),
							cache: "no-cache"
						})
							.then(function (response) {
								return response.json().then(function (result) {
									if (!response.ok) throw new Error(result.message || "保存失败");
									return result;
								});
							})
							.then(function (result) {
								initialConverterSettings = { mode: result.settings.converterMode, url: result.settings.customConverterURL };
								setConverterForm(initialConverterSettings.mode, initialConverterSettings.url);
								showToast(mode === "custom" ? "自建转换服务已保存到 KV" : "默认转换服务已保存到 KV");
							})
							.catch(function (error) { showToast("转换服务保存失败：" + error.message); })
							.finally(function () { button.disabled = false; button.textContent = "应用"; });
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
						restoreConverterSelection();
						localizeRequestTimes();
						document.querySelectorAll('input[name="converterMode"]').forEach(function (radio) {
							radio.addEventListener("change", function () {
								document.getElementById("customConverterUrl").disabled = radio.value !== "custom";
								if (radio.value === "custom") document.getElementById("customConverterUrl").focus();
							});
						});
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
