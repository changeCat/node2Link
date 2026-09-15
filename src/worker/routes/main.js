import { MainValidationError, legacyMainConfig, normalizeMainConfig, reconcileMainEndpoints } from '../../shared/main-subscription.js';
import { DEFAULT_MAIN_DATA } from '../config.js';
import { timed } from '../timing.js';
import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { readMainRecord, readMainBackup, readOriginalHistory, readOriginalVersion, saveMainRecord, MainConflictError } from '../storage/main.js';
import { readBoundedBody, BODY_LIMITS } from '../request-body.js';
import { summarizeMainSubscriptionContent } from '../domain/nodes.js';
import { queueTelegram, sendActionMessage } from '../adapters/telegram.js';
import { renderMainPage } from '../ui/home.js';

export async function handleMainPage(request, env, runtime, ctx, timings) {
	if (request.method === 'POST') {
		if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
		const action = request.headers.get('X-Node2Link-Action');
		if (action === 'list-original-history') return jsonResponse({ ok: true, limit: runtime.originalHistoryLimit, versions: await readOriginalHistory(env.KV, runtime.originalHistoryLimit) });
		if (action === 'get-backup') {
			const backup = await readMainBackup(env.KV);
			return backup ? jsonResponse({ ok: true, ...backup }) : jsonResponse({ ok: false, message: '暂无上次保存版本' }, 404);
		}
		let content = new TextDecoder().decode(await readBoundedBody(request, BODY_LIMITS.main));
		const partial = ['save-originals', 'save-endpoints', 'restore-originals'].includes(action);
		const structured = partial || action === 'save-config' || action === 'get-original-version';
		if (structured) {
			try { content = JSON.parse(content); } catch { return jsonResponse({ ok: false, message: '主订阅配置不是有效的 JSON' }, 400); }
			if (!content || typeof content !== 'object' || Array.isArray(content)) return jsonResponse({ ok: false, message: '主订阅配置格式无效' }, 400);
		}
		let metadata;
		try {
   if (action === 'get-original-version') return jsonResponse({ ok: true, ...await readOriginalVersion(env.KV, content.revision, runtime.originalHistoryLimit) });
   if (partial) {
    if (!request.headers.has('X-Node2Link-Revision')) throw new MainConflictError();
    const record = await readMainRecord(env.KV);
    if (request.headers.get('X-Node2Link-Revision') !== record.revision) throw new MainConflictError();
    const current = record.config || legacyMainConfig(record.exists ? record.content : env.LINK || DEFAULT_MAIN_DATA);
    if (action === 'save-endpoints') content = { ...current, endpoints: content.endpoints };
    else {
     const originals = action === 'restore-originals' ? (await readOriginalVersion(env.KV, content.revision, runtime.originalHistoryLimit)).originals : content.originals;
     normalizeMainConfig({ version: 2, originals, endpoints: [] });
     content = { ...current, originals, endpoints: reconcileMainEndpoints(current.endpoints, originals, current.originals) };
    }
   }
			metadata = await timed(timings, 'main_write', () => saveMainRecord(env.KV, content, { expectedRevision: request.headers.get('X-Node2Link-Revision') ?? undefined, historyLimit: runtime.originalHistoryLimit }));
		} catch (error) {
			if (error instanceof MainConflictError) return jsonResponse({ ok: false, message: error.message }, 409);
			if (error instanceof MainValidationError) return jsonResponse({ ok: false, message: error.message }, 400);
			throw error;
		}
		const summary = structured ? { nodes: metadata.originalCount + metadata.extensionCount, sources: content.originals.filter(node => /^https?:\/\//i.test(node.content)).length } : summarizeMainSubscriptionContent(content);
		queueTelegram(ctx, sendActionMessage(runtime, '主订阅已修改', ['有效节点: ' + summary.nodes + ' 个', '订阅源: ' + summary.sources + ' 个'], request));
		return jsonResponse({ ok: true, metadata, ...(partial ? { config: content } : {}) });
	}
	const record = await timed(timings, 'main_read', () => readMainRecord(env.KV));
	return renderMainPage(request, runtime, record);
}
