import { timed } from '../timing.js';
import { jsonResponse } from '../http.js';
import { readMainRecord } from '../storage/main.js';
import { readGeneratedNodes } from '../storage/generated-nodes.js';
import { ADD } from '../domain/nodes.js';
import { getSUB } from '../adapters/upstream.js';
export function nodeCandidateName(content, fallback) {
	const hashIndex = String(content).lastIndexOf('#');
	if (hashIndex >= 0 && hashIndex < content.length - 1) {
		try {
			const decoded = decodeURIComponent(content.slice(hashIndex + 1)).trim();
			if (decoded) return decoded.slice(0, 120);
		} catch {}
	}
	return fallback;
}

export async function handleNodeCandidates(request, env, apiSubscriptionEnabled, timings) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	try {
		const [manualContent, generatedNodes] = await timed(timings, 'candidates_read', () => Promise.all([
			readMainRecord(env.KV).then(record => record.content),
			apiSubscriptionEnabled ? readGeneratedNodes(env.KV) : Promise.resolve([])
		]));
		const input = await ADD(manualContent || '');
		const sourceURLs = input.filter(line => /^https?:\/\//i.test(line));
		const mainNodes = input.filter(line => !/^https?:\/\//i.test(line));
		let upstreamFailures = 0;
		if (sourceURLs.length && new URL(request.url).searchParams.get('source') !== 'local') {
			const resolved = await timed(timings, 'upstream', () => getSUB(sourceURLs, request, 'v2rayn', request.headers.get('User-Agent')));
			upstreamFailures = resolved.failures || 0;
			mainNodes.push(...(resolved[0] || []));
		}
		const supported = /^(vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|wireguard|socks|socks5):\/\//i;
		const uniqueMainNodes = [...new Set(mainNodes.map(line => String(line).trim()).filter(line => supported.test(line)))];
		const nodes = [
			...uniqueMainNodes.map((content, index) => ({ id: `main-${index}`, source: 'main', sourceName: '主订阅', name: nodeCandidateName(content, `主订阅节点 ${index + 1}`), content })),
			...generatedNodes.map(node => ({ id: `api-${node.id}`, source: 'api', sourceName: 'API 订阅', name: node.name || `${node.address}:${node.port}`, content: node.content }))
		];
		return jsonResponse({ ok: true, nodes, hasUpstream: sourceURLs.length > 0, upstreamFailures });
	} catch (error) {
		return jsonResponse({ ok: false, message: '读取可选节点失败：' + error.message }, 500);
	}
}
