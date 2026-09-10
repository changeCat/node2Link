import { fetchWithTimeout } from './http.js';
import { escapeHTML } from '../http.js';
import { APP_VERSION } from '../config.js';
const subscriptionNotificationCache = new Map();
const subscriptionNotificationCooldown = 10 * 1000;
export function queueTelegram(ctx, task) {
	const safeTask = Promise.resolve(task).catch(error => console.error(JSON.stringify({ event: 'telegram.failed', type: error.name })));
	if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(safeTask);
	return safeTask;
}

export function shouldSendSubscriptionNotification(request) {
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

export async function sendMessage(runtime, subscriptionName, ip, details = {}) {
	return sendRequestMessage(runtime, `获取订阅 ${subscriptionName}`, ip, details);
}

export async function sendActionMessage(runtime, title, detailLines = [], request) {
	const url = request ? new URL(request.url) : null;
	return sendRequestMessage(runtime, title, request?.headers.get('CF-Connecting-IP'), {
		userAgent: request?.headers.get('User-Agent') || 'Unknown',
		hostname: url?.hostname || 'Unknown'
	}, detailLines);
}

export async function sendRequestMessage(runtime, title, ip, details = {}, detailLines = []) {
	if (!runtime.BotToken || !runtime.ChatID) return;
	const sourceLines = [`IP: ${ip || 'Unknown'}`];
	if (ip && ip !== 'Unknown') {
		try {
			const response = await fetchWithTimeout(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`, {}, 3000);
			if (response.ok) {
				const ipInfo = await response.json();
				sourceLines.push(
					`国家: ${ipInfo.country || 'Unknown'}`,
					`城市: ${ipInfo.city || 'Unknown'}`,
					`组织: ${ipInfo.org || 'Unknown'}`,
					`ASN: ${ipInfo.as || 'Unknown'}`
				);
			}
		} catch (error) {
			console.error(JSON.stringify({ event: 'iplookup.failed', type: error.name }));
		}
	}
	const text = [
		`#${title}`,
		...sourceLines,
		`UA: ${details.userAgent || 'Unknown'}`,
		`域名: ${details.hostname || 'Unknown'}`,
		...detailLines
	].map(escapeHTML).join('\n');
	const url = 'https://api.telegram.org/bot' + runtime.BotToken + '/sendMessage?chat_id=' + runtime.ChatID + '&parse_mode=HTML&text=' + encodeURIComponent(text);
	return fetchWithTimeout(url, { method: 'get', headers: { 'Accept': 'application/json', 'User-Agent': 'Node2Link/' + APP_VERSION } });
}
