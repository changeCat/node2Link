import { appendGeneratedNodes } from '../services/generated-nodes.js';
import { normalizeGeneratedNodeSettings } from '../domain/generated-nodes.js';
import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { StorageError } from '../storage/kv.js';
import { deleteNodeRecord } from '../storage/node-records.js';
import { readGeneratedNodeSettings, readGeneratedNodes, saveGeneratedNodeSettings } from '../storage/generated-nodes.js';
function keyValueInput(entries, allowedKeys = ['address', 'port', 'node', 'nodes', 'content']) {
	const input = {};
	const token = entries.get('token');
	if (token !== null) input.token = token;
	for (const key of allowedKeys) {
		const values = entries.getAll(key);
		if (values.length === 1) input[key] = values[0];
		else if (values.length > 1) input[key] = values;
	}
	return input;
}

export async function handlePublicNodeImport(request, env, url = new URL(request.url), { onImported } = {}) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	try {
		const contentType = request.headers.get('Content-Type') || '';
		const input = request.method === 'GET'
			? keyValueInput(url.searchParams, ['address', 'port'])
			: contentType.includes('application/json')
				? await request.json().then(value => Array.isArray(value) ? { addresses: value } : value)
				: contentType.includes('text/plain')
					? { node: await request.text() }
					: keyValueInput(await request.formData());
		const settings = await readGeneratedNodeSettings(env.KV);
		const token = String(input.token || request.headers.get('X-API-Token') || '');
		if (!settings.token || token !== settings.token) return jsonResponse({ ok: false, message: 'API Token 无效' }, 401);
		const result = await appendGeneratedNodes(env.KV, settings, input);
		try { onImported?.(result); } catch { console.error(JSON.stringify({ event: "import.notification.failed" })); }
		return jsonResponse({ ok: true, message: result.added.length ? `已追加 ${result.added.length} 个节点` : '节点已存在，未重复追加', added: result.added.length, duplicates: result.duplicateCount, total: result.total, bytes: result.bytes, mode: result.mode, nodes: result.added.map(node => ({ id: node.id, name: node.name, address: node.address, port: node.port })) }, result.added.length ? 201 : 200);
	} catch (error) { return jsonResponse({ ok: false, message: error.message || '追加节点失败' }, error instanceof StorageError ? 503 : 400); }
}

export async function handleGeneratedNodesAPI(request, env) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (request.method === 'GET') {
		const [settings, nodes] = await Promise.all([readGeneratedNodeSettings(env.KV, { ensureToken: true }), readGeneratedNodes(env.KV)]);
		return jsonResponse({ ok: true, settings, nodes });
	}
	if (!requestHasSameOrigin(request, { allowMissing: false })) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
	try {
		const payload = await request.json();
		if (request.method === 'PUT') {
			const previous = await readGeneratedNodeSettings(env.KV);
			const settings = normalizeGeneratedNodeSettings(payload, previous);
			settings.savedAt = new Date().toISOString();
			await saveGeneratedNodeSettings(env.KV, settings);
			return jsonResponse({ ok: true, settings });
		}
		if (request.method === 'DELETE') {
			const id = String(payload.id || '');
			const nodes = await readGeneratedNodes(env.KV);
			if (!nodes.some(node => node.id === id)) return jsonResponse({ ok: false, message: '节点不存在' }, 404);
			await deleteNodeRecord(env.KV, id);
			return jsonResponse({ ok: true });
		}
		return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	} catch (error) { return jsonResponse({ ok: false, message: error.message || '操作失败' }, error instanceof StorageError ? 503 : 400); }
}
