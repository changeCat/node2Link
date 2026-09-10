import { appendGeneratedNodes } from '../services/generated-nodes.js';
import { normalizeGeneratedNodeSettings } from '../domain/generated-nodes.js';
import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { safeEqual } from '../auth.js';
import { readBoundedBody, readJSONBody, BODY_LIMITS, RequestBodyError } from '../request-body.js';
import { StorageError } from '../storage/kv.js';
import { deleteNodeRecord } from '../storage/node-records.js';
import { readGeneratedNodeSettings, readGeneratedNodes, saveGeneratedNodeSettings, initializeGeneratedNodeSettings } from '../storage/generated-nodes.js';
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
		const settings = await readGeneratedNodeSettings(env.KV);
		const headerToken = request.headers.get('X-API-Token');
		const earlyToken = headerToken ?? url.searchParams.get('token');
		const unauthorized = () => {
			void request.body?.cancel().catch(() => {});
			return jsonResponse({ ok: false, message: 'API Token 无效' }, 401);
		};
		if (!settings.token || (earlyToken !== null && !safeEqual(earlyToken, settings.token))) return unauthorized();
		const contentType = request.headers.get('Content-Type') || '';
		if (earlyToken === null && (request.method === 'GET' || contentType.includes('text/plain'))) return unauthorized();
		const body = request.method === 'POST' ? new Response(await readBoundedBody(request), { headers: { 'Content-Type': contentType } }) : null;
		const input = request.method === 'GET'
			? keyValueInput(url.searchParams, ['address', 'port'])
			: contentType.includes('application/json')
				? await body.json().then(value => Array.isArray(value) ? { addresses: value } : value)
				: contentType.includes('text/plain')
					? { node: await body.text() }
					: keyValueInput(await body.formData());
		if (!input || typeof input !== 'object') throw new Error('请求内容必须是 JSON 对象或地址数组');
		const token = String(earlyToken ?? input.token ?? '');
		if (!safeEqual(token, settings.token)) return jsonResponse({ ok: false, message: 'API Token 无效' }, 401);
		const result = await appendGeneratedNodes(env.KV, settings, input);
		try { onImported?.(result); } catch { console.error(JSON.stringify({ event: "import.notification.failed" })); }
		return jsonResponse({ ok: true, message: result.added.length ? `已追加 ${result.added.length} 个节点` : '节点已存在，未重复追加', added: result.added.length, duplicates: result.duplicateCount, total: result.total, bytes: result.bytes, mode: result.mode, nodes: result.added.map(node => ({ id: node.id, name: node.name, address: node.address, port: node.port })) }, result.added.length ? 201 : 200);
	} catch (error) { return jsonResponse({ ok: false, message: error.message || '追加节点失败' }, error instanceof StorageError ? 503 : error instanceof RequestBodyError ? error.status : 400); }
}

export async function handleGeneratedNodesAPI(request, env) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (request.method === 'GET') {
		const [settings, nodes] = await Promise.all([readGeneratedNodeSettings(env.KV), readGeneratedNodes(env.KV, { fresh: false })]);
		return jsonResponse({ ok: true, settings, nodes });
	}
	if (!requestHasSameOrigin(request, { allowMissing: false })) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
	try {
		const payload = await readJSONBody(request, BODY_LIMITS.apiSettings);
		if (request.method === 'POST' && payload.action === 'initialize') {
			return jsonResponse({ ok: true, settings: await initializeGeneratedNodeSettings(env) });
		}
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
	} catch (error) { return jsonResponse({ ok: false, message: error.message || '操作失败' }, error instanceof StorageError ? 503 : error instanceof RequestBodyError ? error.status : 400); }
}
