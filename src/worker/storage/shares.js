const SHARE_INDEX_KEY = 'NODE2LINK.shares.json';
const SHARE_KEY_PREFIX = 'NODE2LINK.share.';

export function isValidShareId(value) {
	return /^[A-Za-z0-9_-]{12,64}$/.test(String(value || ''));
}

export async function readShare(kv, id) {
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

export function normalizeShareSummary(share) {
	if (!share || !isValidShareId(share.id)) return null;
	const name = String(share.name || '').trim().slice(0, 80);
	if (!name) return null;
	return {
		id: share.id,
		name,
		nodeCount: Math.max(0, Number.parseInt(share.nodeCount, 10) || 0),
		createdAt: String(share.createdAt || ''),
		updatedAt: String(share.updatedAt || share.createdAt || '')
	};
}

function serializeShareIndex(summaries) {
	// 前半段 ID 供旧部署读取，后半段摘要供新版列表页单次读取。
	return JSON.stringify([...summaries.map(item => item.id), ...summaries]);
}

export async function readShareIndex(kv) {
	try {
		const value = await kv.get(SHARE_INDEX_KEY);
		const parsed = value ? JSON.parse(value) : [];
		if (!Array.isArray(parsed)) return [];
		const embedded = parsed.map(item => typeof item === 'object' ? normalizeShareSummary(item) : null).filter(Boolean);
		const legacyIds = parsed.filter(isValidShareId);
		const ids = legacyIds.length ? legacyIds : embedded.map(item => item.id);
		const embeddedById = new Map(embedded.map(item => [item.id, item]));
		if (ids.length && ids.every(id => embeddedById.has(id))) {
			return ids.map(id => embeddedById.get(id));
		}

		// 旧版索引只保存 ID。首次读取时自动补充摘要，之后列表页不再逐条读取详情。
		const shares = await Promise.all(ids.map(id => readShare(kv, id)));
		const summaries = shares.map(normalizeShareSummary).filter(Boolean);
		await kv.put(SHARE_INDEX_KEY, serializeShareIndex(summaries));
		return summaries;
	} catch (error) {
		console.error('读取分享索引失败:', error);
		return [];
	}
}

export async function listShareSummaries(kv) {
	if (!kv) return [];
	const shares = await readShareIndex(kv);
	return shares.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
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

export function createShareId() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
	});
}

function requestHasSameOrigin(request) {
	const origin = request.headers.get('Origin');
	if (!origin) return false;
	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
}

export async function handleSharesAPI(request, env, url = new URL(request.url)) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (request.method === 'GET') {
		const id = String(url.searchParams.get('id') || '');
		if (!id) return jsonResponse({ ok: true, shares: await listShareSummaries(env.KV) });
		if (!isValidShareId(id)) return jsonResponse({ ok: false, message: '分享不存在' }, 404);
		const share = await readShare(env.KV, id);
		return share ? jsonResponse({ ok: true, share }) : jsonResponse({ ok: false, message: '分享不存在' }, 404);
	}
	if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);

	try {
		const payload = await request.json();
		const index = await readShareIndex(env.KV);
		if (request.method === 'POST') {
			const normalized = normalizeSharePayload(payload);
			const now = new Date().toISOString();
			const share = { id: createShareId(), ...normalized, createdAt: now, updatedAt: now };
			const summary = normalizeShareSummary(share);
			await Promise.all([
				env.KV.put(SHARE_KEY_PREFIX + share.id, JSON.stringify(share)),
				env.KV.put(SHARE_INDEX_KEY, serializeShareIndex([summary, ...index.filter(item => item.id !== share.id)]))
			]);
			return jsonResponse({ ok: true, share }, 201);
		}
		if (request.method === 'PUT') {
			const id = String(payload.id || '');
			const previous = await readShare(env.KV, id);
			if (!previous) return jsonResponse({ ok: false, message: '分享不存在' }, 404);
			const share = { ...previous, ...normalizeSharePayload(payload), updatedAt: new Date().toISOString() };
			const summary = normalizeShareSummary(share);
			await Promise.all([
				env.KV.put(SHARE_KEY_PREFIX + id, JSON.stringify(share)),
				env.KV.put(SHARE_INDEX_KEY, serializeShareIndex([summary, ...index.filter(item => item.id !== id)]))
			]);
			return jsonResponse({ ok: true, share });
		}
		if (request.method === 'PATCH') {
			const id = String(payload.id || '');
			const previous = await readShare(env.KV, id);
			if (!previous) return jsonResponse({ ok: false, message: '分享不存在' }, 404);
			const newId = createShareId();
			const share = { ...previous, id: newId, updatedAt: new Date().toISOString() };
			const summary = normalizeShareSummary(share);
			const newIndex = index.some(item => item.id === id)
				? index.map(item => item.id === id ? summary : item)
				: [summary, ...index];
			await env.KV.put(SHARE_KEY_PREFIX + newId, JSON.stringify(share));
			await env.KV.put(SHARE_INDEX_KEY, serializeShareIndex(newIndex));
			await env.KV.delete(SHARE_KEY_PREFIX + id);
			return jsonResponse({ ok: true, share });
		}
		if (request.method === 'DELETE') {
			const id = String(payload.id || '');
			if (!index.some(item => item.id === id)) return jsonResponse({ ok: false, message: '分享不存在' }, 404);
			await Promise.all([
				env.KV.delete(SHARE_KEY_PREFIX + id),
				env.KV.put(SHARE_INDEX_KEY, serializeShareIndex(index.filter(item => item.id !== id)))
			]);
			return jsonResponse({ ok: true });
		}
		return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	} catch (error) {
		return jsonResponse({ ok: false, message: error.message || '操作失败' }, 400);
	}
}
