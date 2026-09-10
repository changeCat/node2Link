import { jsonResponse, requestHasSameOrigin } from '../http.js';
import { readMainRecord, readMainBackup, saveMainRecord } from '../storage/main.js';
import { summarizeMainSubscriptionContent } from '../domain/nodes.js';
import { queueTelegram, sendActionMessage } from '../adapters/telegram.js';
import { renderMainPage } from '../ui/home.js';

export async function handleMainPage(request, env, runtime, ctx) {
	if (request.method === 'POST') {
		if (!env.KV) return jsonResponse({ ok: false, message: '未绑定 KV 命名空间' }, 400);
		if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
		if (request.headers.get('X-Node2Link-Action') === 'get-backup') {
			const backup = await readMainBackup(env.KV);
			return backup ? jsonResponse({ ok: true, ...backup }) : jsonResponse({ ok: false, message: '暂无上次保存版本' }, 404);
		}
		const content = await request.text();
		const metadata = await saveMainRecord(env.KV, content);
		const summary = summarizeMainSubscriptionContent(content);
		queueTelegram(ctx, sendActionMessage(runtime, '主订阅已修改', ['有效节点: ' + summary.nodes + ' 个', '订阅源: ' + summary.sources + ' 个'], request));
		return jsonResponse({ ok: true, metadata });
	}
	const record = env.KV ? await readMainRecord(env.KV) : { content: '', metadata: null };
	return renderMainPage(request, runtime, record, Boolean(env.KV));
}
