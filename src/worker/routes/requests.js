import { jsonResponse } from '../http.js';
import { isValidShareId, shareExists } from '../storage/shares.js';
import { REQUEST_PAGE_SIZE } from '../storage/request-logs.js';
import { StorageError } from '../storage/kv.js';

const cursorPattern = /^requests\.\d{13}\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function handleRequestHistory(env, params) {
	const scope = params.get('scope');
	const client = params.get('client') || '';
	const after = params.get('after') || '', start = params.get('start') || '';
	const failed = params.get('failed') || '';
	if ((scope !== 'main' && !isValidShareId(scope)) || client.length > 40 ||
		(failed && failed !== '1') || [after, start].some(key => key && !cursorPattern.test(key)) ||
		(after && start && after < start)) return jsonResponse({ message: '请求筛选或分页参数无效' }, 400);
	if (scope !== 'main' && !await shareExists(env.KV, scope)) return jsonResponse({ message: '分享不存在或链接已重置' }, 404);
	try {
		return jsonResponse(await env.KV.requestPage({ scope, client, failed: failed === '1', after, start }, REQUEST_PAGE_SIZE));
	} catch (cause) { throw new StorageError('暂时无法读取请求明细', { cause }); }
}
