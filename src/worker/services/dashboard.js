import { SUPPORTED_NODE_PROTOCOLS } from '../config.js';
import { isShareAvailable } from '../domain/shares.js';
import { readMainRecord } from '../storage/main.js';
import { readGeneratedNodes } from '../storage/generated-nodes.js';
import { listShareSummaries } from '../storage/shares.js';

const DAY = 24 * 60 * 60 * 1000;
export function summarizeDashboard(main, generated, shares, now = Date.now()) {
	const protocols = new Map();
	const nodes = new Set();
	const sources = new Set();
	const manualNodes = new Set();
	const apiNodes = new Set();
	function addNode(line, group) {
		const protocol = line.match(/^([a-z0-9+.-]+):\/\//i)?.[1].toLowerCase();
		if (!SUPPORTED_NODE_PROTOCOLS.includes(protocol)) return;
		group.add(line);
		if (nodes.has(line)) return;
		nodes.add(line);
		protocols.set(protocol, (protocols.get(protocol) || 0) + 1);
	}
	for (const line of String(main.content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
		if (/^https?:\/\//i.test(line)) sources.add(line);
		else addNode(line, manualNodes);
	}
	for (const node of generated) addNode(String(node.content || '').trim(), apiNodes);
	const shareCounts = { active: 0, paused: 0, expired: 0 };
	for (const share of shares) {
		if (share.paused) shareCounts.paused++;
		else if (isShareAvailable(share, now)) shareCounts.active++;
		else shareCounts.expired++;
	}
	const expiring = shares.filter(share => {
		const expiry = Date.parse(share.expiresAt);
		return expiry > now && expiry <= now + 7 * DAY;
	}).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
	const recent = [
		{ name: '主订阅', kind: '保存', at: main.metadata?.savedAt, href: '/' },
		...shares.map(share => ({ name: share.name, kind: '分享', at: share.updatedAt, href: '/shares' })),
		...generated.map(node => ({ name: node.name || 'API 节点', kind: '导入', at: node.createdAt, href: '/api-subscriptions' }))
	].filter(item => Number.isFinite(Date.parse(item.at)))
		.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
	return {
		generatedAt: new Date(now).toISOString(), nodeCount: nodes.size, mainCount: manualNodes.size,
		apiCount: apiNodes.size, sourceCount: sources.size,
		protocols: [...protocols].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
		shareCount: shares.length, shareCounts, expiringCount: expiring.length,
		expiring: expiring.slice(0, 8).map(share => ({ name: share.name, expiresAt: share.expiresAt, paused: share.paused })), recent
	};
}

export async function readDashboard(env, runtime) {
	if (!env.KV) return summarizeDashboard({}, [], []);
	const [main, generated, shares] = await Promise.all([
		readMainRecord(env.KV),
		runtime.apiSubscriptionEnabled ? readGeneratedNodes(env.KV, { fresh: false }) : [],
		listShareSummaries(env.KV)
	]);
	return summarizeDashboard(main, generated, shares);
}
