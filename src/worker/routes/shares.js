import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { StorageError } from '../storage/kv.js';
import { normalizeSharePayload, normalizeShareAvailability } from '../domain/shares.js';
import { readJSONBody, BODY_LIMITS, RequestBodyError } from '../request-body.js';
import { createShareId, readShare, listShareSummaries, saveShare, deleteShare } from '../storage/shares.js';

export async function handleSharesAPI(request, env, url = new URL(request.url)) {
	try {
		if (request.method === 'GET') {
			const id = String(url.searchParams.get('id') || '');
			if (!id) return jsonResponse({ ok: true, shares: await listShareSummaries(env.KV) });
			const share = await readShare(env.KV, id);
			return share ? jsonResponse({ ok: true, share }) : jsonResponse({ ok: false, message: '分享不存在' }, 404);
		}
		if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
		if (!requestHasSameOrigin(request, { allowMissing: false })) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
		const payload = await readJSONBody(request, BODY_LIMITS.share);
		if (request.method === 'PATCH' && payload.action !== undefined && !['availability', 'reset'].includes(payload.action)) return jsonResponse({ ok: false, message: '未知的分享操作' }, 400);
		if (request.method === 'POST') {
			const now = new Date().toISOString();
			const share = { id: createShareId(), ...normalizeSharePayload(payload), createdAt: now, updatedAt: now };
			await saveShare(env.KV, share);
			return jsonResponse({ ok: true, share }, 201);
		}
		const previous = await readShare(env.KV, String(payload.id || ''));
		if (!previous) return jsonResponse({ ok: false, message: '分享不存在' }, 404);
		if (request.method === 'DELETE') {
			await deleteShare(env.KV, previous.id);
			return jsonResponse({ ok: true });
		}
		const share = {
			...previous,
			...(request.method === 'PUT' ? normalizeSharePayload(payload, previous)
				: payload.action === 'availability' ? normalizeShareAvailability(payload, previous) : { id: createShareId() }),
			updatedAt: new Date().toISOString()
		};
		await saveShare(env.KV, share, previous.id);
		return jsonResponse({ ok: true, share });
	} catch (error) {
		return jsonResponse({ ok: false, message: error.message || '操作失败' }, error instanceof StorageError ? 503 : error instanceof RequestBodyError ? error.status : 400);
	}
}
