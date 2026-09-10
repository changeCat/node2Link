import { handleSharesAPI } from './routes/shares.js';
import { createRuntimeConfig, isSubscriptionTokenRequest } from './config.js';
import { jsonResponse, textResponse, requestHasSameOrigin } from './http.js';
import { readPersistedSettings } from './storage/settings.js';
import { StorageError } from './storage/kv.js';
import { clearSessionCookie, isAuthenticated } from './auth.js';
import { serveSubscription } from './services/subscription.js';
import { handleNodeCandidates } from './services/candidates.js';
import { queueTelegram, sendActionMessage } from './adapters/telegram.js';
import { readMainSubscriptionData } from './storage/main.js';
import { renderLoginPage, renderSettingsPage, renderGeneratedNodesPage, renderSharesPage, renderRequestsPage } from './ui/pages.js';
import { handleMainPage } from './routes/main.js';
import { handleLogin } from './routes/login.js';
import { saveSettings } from './routes/settings.js';
export { normalizeV2rayNSubscription } from './domain/nodes.js';

// 管理端使用账号密码登录；订阅通过不可猜测的 /s/<id> 链接访问。

import { readShare } from './storage/shares.js';
import { handleGeneratedNodesAPI, handlePublicNodeImport } from './routes/generated-nodes.js';

export default {
	async fetch(request, env, ctx) {
		const startedAt = Date.now();
		try { return withServerTiming(await dispatch(request, env, ctx), startedAt); }
		catch (error) {
			console.error(JSON.stringify({ event: 'request.failed', type: error.name || 'Error' }));
			return jsonResponse({ ok: false, message: error instanceof StorageError ? error.message : '服务器暂时无法处理请求' }, error instanceof StorageError ? 503 : 500);
		}
	}
};

async function dispatch(request, env, ctx) {
	const url = new URL(request.url);
	const persistedSettings = await readPersistedSettings(env);
	const runtime = await createRuntimeConfig(env, persistedSettings);
	if (!runtime.apiSubscriptionEnabled && ['/api/import', '/api/generated-nodes', '/api-subscriptions'].includes(url.pathname)) {
		return url.pathname.startsWith('/api/')
			? jsonResponse({ ok: false, message: '接口不存在' }, 404)
			: textResponse('页面不存在', 404);
	}

	if (request.method === 'GET' && isSubscriptionTokenRequest(url, runtime.subscriptionToken)) {
		const mainData = await readMainSubscriptionData(env);
		return serveSubscription(request, env, ctx, runtime, mainData, 'main', true, runtime.mainSubscriptionId, runtime.FileName);
	}
	if (url.pathname === '/api/import') {
		return handlePublicNodeImport(request, env, url, { onImported(result) {
			if (result.added.length) queueTelegram(ctx, sendActionMessage(runtime, 'API 订阅已修改', [
				'API 订阅节点: ' + result.total + ' 个', '本次新增: ' + result.added.length + ' 个',
				'调用方式: ' + (result.mode === 'direct' ? '完整节点' : '地址模板')
			], request));
		} });
	}

	const shareMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{12,64})$/);
	if (shareMatch && request.method === 'GET') {
		const shareId = shareMatch[1];
		if (shareId === runtime.mainSubscriptionId) {
			const mainData = await readMainSubscriptionData(env);
			return serveSubscription(request, env, ctx, runtime, mainData, 'main', true, runtime.mainSubscriptionId, runtime.FileName);
		}
		if (!env.KV) return textResponse('分享链接不存在', 404);
		const shared = await readShare(env.KV, shareId);
		if (!shared) return textResponse('分享链接不存在或已被删除', 404);
		return serveSubscription(request, env, ctx, runtime, shared.content, 'share', false, shareId, shared.name);
	}

	if (url.pathname === '/api/login' && request.method === 'POST') return handleLogin(request, env, runtime, persistedSettings);
	if (url.pathname === '/login' && request.method === 'GET') {
		if (await isAuthenticated(request, env)) return Response.redirect(url.origin + '/', 303);
		return renderLoginPage(env, runtime);
	}

	if (!(await isAuthenticated(request, env))) {
		if (url.pathname.startsWith('/api/')) return jsonResponse({ ok: false, message: '登录已失效' }, 401);
		return Response.redirect(url.origin + '/login', 303);
	}

	if (url.pathname === '/api/logout' && request.method === 'POST') {
		if (!requestHasSameOrigin(request)) return textResponse('请求来源无效', 403);
		return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': clearSessionCookie() } });
	}
	if (url.pathname === '/api/settings' && request.method === 'POST') return saveSettings(request, env, persistedSettings);
	if (url.pathname === '/api/shares') return handleSharesAPI(request, env, url);
	if (url.pathname === '/api/generated-nodes') return handleGeneratedNodesAPI(request, env, url);
	if (url.pathname === '/api/node-candidates' && request.method === 'GET') return handleNodeCandidates(request, env, runtime.apiSubscriptionEnabled);
	if (url.pathname === '/settings' && request.method === 'GET') return renderSettingsPage(request, runtime);
	if (url.pathname === '/api-subscriptions' && request.method === 'GET') return renderGeneratedNodesPage(request, env, runtime);
	if (url.pathname === '/shares' && request.method === 'GET') return renderSharesPage(request, env, runtime);
	if (url.pathname === '/requests' && request.method === 'GET') return renderRequestsPage(request, env, runtime);
	if (url.pathname !== '/') return textResponse('页面不存在', 404);
	if (!env.KV) return handleMainPage(request, env, runtime, ctx);

	if (request.method === 'GET' || request.method === 'POST') {
		return handleMainPage(request, env, runtime, ctx);
	}
	return textResponse('Method Not Allowed', 405);
}

function withServerTiming(response, startedAt) {
	const headers = new Headers(response.headers);
	headers.append('Server-Timing', `app;dur=${Math.max(0, Date.now() - startedAt)}`);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
