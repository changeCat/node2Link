import { isValidShareId } from './shares.js';
import { cachedView, invalidateView } from './view-cache.js';

const REQUEST_LOG_PREFIX = 'requests.';
const REQUEST_LOG_TTL = 30 * 24 * 60 * 60;
export const REQUEST_PAGE_SIZE = 20;

export function detectSubscriptionClient(userAgentHeader) {
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

export function queueSubscriptionRequestLog(ctx, env, details) {
	const task = recordSubscriptionRequest(env.KV, details)
		.catch(error => console.error('记录订阅请求时发生错误:', error));
	if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
}

async function recordSubscriptionRequest(kv, details) {
	invalidateView(kv, REQUEST_LOG_PREFIX);
	const now = Date.now();
	const reverseTimestamp = String(9999999999999 - now).padStart(13, '0');
	const randomID = crypto.randomUUID();
	const metadata = {
		client: String(details.client || '其他客户端').slice(0, 40),
		userAgent: String(details.userAgent || 'Unknown').slice(0, 120),
		ip: String(details.ip || '').slice(0, 45),
		country: String(details.country || '').slice(0, 2),
		region: String(details.region || '').slice(0, 80),
		city: String(details.city || '').slice(0, 80),
		format: String(details.format || 'base64').slice(0, 20),
		access: details.access === 'share' ? 'share' : 'main',
		subscriptionId: isValidShareId(details.subscriptionId) ? details.subscriptionId : '',
		requestedAt: new Date(now).toISOString(),
		status: Number(details.status) || 200,
		durationMs: Math.max(0, Number(details.durationMs) || 0),
		upstreamFailures: Math.max(0, Number(details.upstreamFailures) || 0)
	};
	try {
		await kv.put(REQUEST_LOG_PREFIX + reverseTimestamp + '.' + randomID, '1', {
			metadata, expirationTtl: REQUEST_LOG_TTL
		});
	} finally { invalidateView(kv, REQUEST_LOG_PREFIX); }
}

export async function readSubscriptionRequestStats(kv) {
	return cachedView(kv, REQUEST_LOG_PREFIX, () => loadSubscriptionRequestStats(kv), {
		fresh: false, ttlMs: 15_000, cacheable: value => !value.unavailable
	});
}

async function loadSubscriptionRequestStats(kv) {
	const empty = () => ({ total: 0, failed: 0, latest: '', clients: [] });
	const main = empty(), shares = new Map();
	try {
		for (const row of await kv.requestGroups()) {
			if (row.scope !== 'main' && !isValidShareId(row.scope)) continue;
			if (row.scope !== 'main' && !shares.has(row.scope)) shares.set(row.scope, empty());
			const group = row.scope === 'main' ? main : shares.get(row.scope);
			group.total += row.total;
			group.failed += row.failed;
			if (row.latest > group.latest) group.latest = row.latest;
			group.clients.push({ name: row.client, count: row.total });
		}
	} catch (error) {
		console.error('读取订阅请求统计时发生错误:', error);
		return { unavailable: true };
	}
	return { main, shares, total: main.total + [...shares.values()].reduce((sum, group) => sum + group.total, 0) };
}
