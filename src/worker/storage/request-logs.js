import { isValidShareId } from './shares.js';
import { cachedView, invalidateView } from './view-cache.js';

const REQUEST_LOG_PREFIX = 'requests.';
const REQUEST_LOG_TTL = 30 * 24 * 60 * 60;
const REQUEST_LOG_LIMIT = 500;

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

export function queueSubscriptionRequestLog(ctx, env, details, logging = { requestLogMode: 'full', requestLogSampleRate: 1 }) {
	if (typeof env.KV.put !== 'function') return;
	if (logging.requestLogMode === 'off') return;
	const rate = logging.requestLogMode === 'sample' ? logging.requestLogSampleRate : 1;
	const failed = Number(details.status) >= 400;
	if (!failed && rate < 1 && Math.random() >= rate) return;
	const task = recordSubscriptionRequest(env.KV, { ...details, sampleRate: failed ? 1 : rate, sampledMode: logging.requestLogMode === 'sample' })
		.catch(error => console.error('记录订阅请求时发生错误:', error));
	if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
}

async function recordSubscriptionRequest(kv, details) {
	invalidateView(kv, REQUEST_LOG_PREFIX);
	const now = Date.now();
	const reverseTimestamp = String(9999999999999 - now).padStart(13, '0');
	const randomID = typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + now.toString(36);
	const metadata = {
		client: String(details.client || '其他客户端').slice(0, 40),
		userAgent: String(details.userAgent || 'Unknown').slice(0, 120),
		format: String(details.format || 'base64').slice(0, 20),
		access: details.access === 'share' ? 'share' : 'main',
		subscriptionId: isValidShareId(details.subscriptionId) ? details.subscriptionId : '',
		requestedAt: new Date(now).toISOString(),
		status: Number(details.status) || 200,
		durationMs: Math.max(0, Number(details.durationMs) || 0),
		upstreamFailures: Math.max(0, Number(details.upstreamFailures) || 0),
		sampleRate: Number(details.sampleRate) || 1,
		sampledMode: details.sampledMode === true
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
		return { ...empty, unavailable: true };
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
			failed: records.filter(event => Number(event.status) >= 400).length,
			clients: [...clients.values()].sort((a, b) => b.count - a.count || b.lastRequestedAt.localeCompare(a.lastRequestedAt))
		};
	};

	const mainEvents = events.filter(event => event.access !== 'share');
	const shareEvents = events.filter(event => event.access === 'share');
	const shareGroups = new Map();
	for (const event of shareEvents) {
		if (!isValidShareId(event.subscriptionId)) continue;
		if (!shareGroups.has(event.subscriptionId)) shareGroups.set(event.subscriptionId, []);
		shareGroups.get(event.subscriptionId).push(event);
	}
	return {
		total: events.length,
		sampled: events.some(event => event.sampledMode || Number(event.sampleRate || 1) < 1),
		truncated,
		main: summarize(mainEvents),
		shares: [...shareGroups.entries()]
			.map(([subscriptionId, records]) => ({ subscriptionId, ...summarize(records) }))
			.sort((a, b) => b.total - a.total)
	};
}
