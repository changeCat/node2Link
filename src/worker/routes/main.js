import { MainValidationError } from '../../shared/main-subscription.js';
import { timed } from '../timing.js';
import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { readMainRecord, readMainBackup, saveMainRecord, MainConflictError } from '../storage/main.js';
import { readBoundedBody, BODY_LIMITS } from '../request-body.js';
import { summarizeMainSubscriptionContent } from '../domain/nodes.js';
import { queueTelegram, sendActionMessage } from '../adapters/telegram.js';
import { renderMainPage } from '../ui/home.js';

export async function handleMainPage(request, env, runtime, ctx, timings) {
	if (request.method === 'POST') {
		if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
		if (request.headers.get('X-Node2Link-Action') === 'get-backup') {
			const backup = await readMainBackup(env.KV);
			return backup ? jsonResponse({ ok: true, ...backup }) : jsonResponse({ ok: false, message: '暂无上次保存版本' }, 404);
		}
		let content = new TextDecoder().decode(await readBoundedBody(request, BODY_LIMITS.main));
		const structured = request.headers.get('X-Node2Link-Action') === 'save-config';
		if (structured) {
			try { content = JSON.parse(content); } catch { return jsonResponse({ ok: false, message: '主订阅配置不是有效的 JSON' }, 400); }
			if (!content || typeof content !== 'object' || Array.isArray(content)) return jsonResponse({ ok: false, message: '主订阅配置格式无效' }, 400);
		}
		let metadata;
		try {
			metadata = await timed(timings, 'main_write', () => saveMainRecord(env.KV, content, { expectedRevision: request.headers.get('X-Node2Link-Revision') ?? undefined }));
		} catch (error) {
			if (error instanceof MainConflictError) return jsonResponse({ ok: false, message: error.message }, 409);
			if (error instanceof MainValidationError) return jsonResponse({ ok: false, message: error.message }, 400);
			throw error;
		}
		const summary = structured ? { nodes: metadata.originalCount + metadata.extensionCount, sources: content.originals.filter(node => /^https?:\/\//i.test(node.content)).length } : summarizeMainSubscriptionContent(content);
		queueTelegram(ctx, sendActionMessage(runtime, '主订阅已修改', ['有效节点: ' + summary.nodes + ' 个', '订阅源: ' + summary.sources + ' 个'], request));
		return jsonResponse({ ok: true, metadata });
	}
	const record = await timed(timings, 'main_read', () => readMainRecord(env.KV));
	return renderMainPage(request, runtime, record);
}
