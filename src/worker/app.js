import { handleSharesAPI } from './routes/shares.js';
import { createRuntimeConfig, isSubscriptionTokenRequest, isAPISubscriptionEnabled, couldBeSubscriptionTokenRequest, sanitizeSubscriptionToken } from './config.js';
import { jsonResponse, textResponse, requestHasSameOrigin } from './http.js';
import { readLoginPresentation, readPersistedSettings, readPublicSubscriptionSettings, readSubscriptionEntry } from './storage/settings.js';
import { StorageError } from './storage/kv.js';
import { RequestBodyError } from './request-body.js';
import { isShareAvailable } from './domain/shares.js';
import { clearSessionCookie, isAuthenticated } from './auth.js';
import { serveSubscription } from './services/subscription.js';
import { handleNodeCandidates } from './services/candidates.js';
import { queueTelegram, sendActionMessage } from './adapters/telegram.js';
import { readMainSubscriptionData } from './storage/main.js';
import { renderLoginPage, renderSettingsPage, renderGeneratedNodesPage, renderSharesPage, renderRequestsPage } from './ui/pages.js';
import { handleMainPage } from './routes/main.js';
import { handleLogin } from './routes/login.js';
import { saveSettings } from './routes/settings.js';
// 管理端使用账号密码登录；订阅通过不可猜测的 /s/<id> 链接访问。

import { renderDashboardPage } from './ui/dashboard.js';
import { timed } from './timing.js';
import { readShare } from './storage/shares.js';
import { handleGeneratedNodesAPI, handlePublicNodeImport } from './routes/generated-nodes.js';
import { withStorageBindings } from './storage/d1.js';

const PAGE_METHODS = new Map([
	['/', ['GET', 'POST']], ['/login', ['GET']], ['/api/login', ['POST']],
	['/api/settings', ['POST']], ['/dashboard', ['GET']], ['/settings', ['GET']],
	['/api-subscriptions', ['GET']], ['/shares', ['GET']], ['/requests', ['GET']]
]);

export default {
	async fetch(request, env, ctx) {
		const startedAt = Date.now();
		const timings = [];
		try {
			env = withStorageBindings(env);
			return withServerTiming(await dispatch(request, env, ctx, timings), startedAt, timings);
		}
		catch (error) {
			console.error(JSON.stringify({ event: 'request.failed', type: error.name || 'Error' }));
			const expected = error instanceof StorageError || error instanceof RequestBodyError;
			return withServerTiming(jsonResponse({ ok: false, message: expected ? error.message : '服务器暂时无法处理请求' }, expected ? error.status : 500), startedAt, timings);
		}
	}
};

async function dispatch(request, env, ctx, timings) {
	const url = new URL(request.url);
	const apiSubscriptionEnabled = isAPISubscriptionEnabled(env);
	let authentication;
	const authenticated = () => authentication ??= isAuthenticated(request, env);
	const shareMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{12,64})$/);
	const publicShareRequest = Boolean(shareMatch && request.method === 'GET');
	const loginPageRequest = url.pathname === '/login' && request.method === 'GET';
	// Percent-encoded slashes can belong to an existing /<Token> entry.
	const tokenCandidate = request.method === 'GET' && !loginPageRequest && couldBeSubscriptionTokenRequest(url);
	if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
		&& ['/', '/api/login', '/api/settings', '/api/shares', '/api/generated-nodes', '/api/logout'].includes(url.pathname)
		&& !requestHasSameOrigin(request)) return textResponse('请求来源无效', 403);
	if (!apiSubscriptionEnabled && ['/api/import', '/api/generated-nodes', '/api-subscriptions'].includes(url.pathname)) {
		return url.pathname.startsWith('/api/')
			? jsonResponse({ ok: false, message: '接口不存在' }, 404)
			: textResponse('页面不存在', 404);
	}

	// These administrative APIs need authentication, but no display/conversion settings.
	if (['/api/shares', '/api/generated-nodes', '/api/node-candidates', '/api/logout'].includes(url.pathname)) {
		if (!(await authenticated())) return jsonResponse({ ok: false, message: '登录已失效' }, 401);
		if (url.pathname === '/api/logout' && request.method === 'POST') {
			if (!requestHasSameOrigin(request)) return textResponse('请求来源无效', 403);
			return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': clearSessionCookie() } });
		}
		if (url.pathname === '/api/shares') return handleSharesAPI(request, env, url);
		if (url.pathname === '/api/generated-nodes') return handleGeneratedNodesAPI(request, env, url);
		if (url.pathname === '/api/node-candidates' && request.method === 'GET') return handleNodeCandidates(request, env, apiSubscriptionEnabled, timings);
		return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	}
	if (url.pathname === '/api/import') {
		return handlePublicNodeImport(request, env, url, { onImported(result) {
			if (!result.added.length || !env.TGTOKEN || !env.TGID) return;
			queueTelegram(ctx, (async () => {
				const runtime = await createRuntimeConfig(env, await readPersistedSettings(env));
				return sendActionMessage(runtime, 'API 订阅已修改', [
					'API 订阅节点: ' + result.total + ' 个', '本次新增: ' + result.added.length + ' 个',
					'调用方式: ' + (result.mode === 'direct' ? '完整节点' : '地址模板')
				], request);
			})());
		} });
	}
	if (loginPageRequest) {
		if (await authenticated()) return Response.redirect(url.origin + '/', 303);
		const presentation = await timed(timings, 'settings', () => readLoginPresentation(env));
		const runtime = await timed(timings, 'config', () => createRuntimeConfig(env, presentation));
		return renderLoginPage(env, runtime);
	}

	if (!tokenCandidate && !publicShareRequest) {
		const methods = PAGE_METHODS.get(url.pathname);
		if (!methods) return textResponse('页面不存在', 404);
		if (!methods.includes(request.method)) return textResponse('Method Not Allowed', 405);
		if (url.pathname !== '/api/login' && !(await authenticated())) {
			if (url.pathname.startsWith('/api/')) return jsonResponse({ ok: false, message: '登录已失效' }, 401);
			return Response.redirect(url.origin + '/login', 303);
		}
	}
	let entry;
	if (tokenCandidate) {
		entry = await timed(timings, 'settings', () => readSubscriptionEntry(env));
		const token = sanitizeSubscriptionToken(Object.hasOwn(entry, 'subscriptionToken') ? entry.subscriptionToken : env.TOKEN);
		if (!isSubscriptionTokenRequest(url, token) && url.pathname !== '/login' && !(await authenticated())) {
			return Response.redirect(url.origin + '/login', 303);
		}
	}
	const persistedSettings = await timed(timings, 'settings', () => publicShareRequest
		? readPublicSubscriptionSettings(env) : readPersistedSettings(env, { entry }));
	const runtime = await timed(timings, 'config', () => createRuntimeConfig(env, persistedSettings));

	if (tokenCandidate && isSubscriptionTokenRequest(url, runtime.subscriptionToken)) {
		const mainData = await timed(timings, 'main_read', () => readMainSubscriptionData(env));
		return serveSubscription(request, env, ctx, runtime, mainData, 'main', true, runtime.mainSubscriptionId, runtime.FileName, { timings });
	}

	if (publicShareRequest) {
		const shareId = shareMatch[1];
		if (shareId === runtime.mainSubscriptionId) {
			const mainData = await timed(timings, 'main_read', () => readMainSubscriptionData(env));
			return serveSubscription(request, env, ctx, runtime, mainData, 'main', true, runtime.mainSubscriptionId, runtime.FileName, { timings });
		}
		const shared = await timed(timings, 'share_read', () => readShare(env.KV, shareId));
		if (!shared) return textResponse('分享链接不存在或已被删除', 404);
		if (!isShareAvailable(shared)) return textResponse('分享已暂停或已到期', 410);
		return serveSubscription(request, env, ctx, runtime, shared.content, 'share', false, shareId, shared.name, { timings });
	}

	if (url.pathname === '/api/login' && request.method === 'POST') return handleLogin(request, env, runtime, persistedSettings);
	if (!(await authenticated())) {
		if (url.pathname.startsWith('/api/')) return jsonResponse({ ok: false, message: '登录已失效' }, 401);
		return Response.redirect(url.origin + '/login', 303);
	}

	if (url.pathname === '/api/settings' && request.method === 'POST') return saveSettings(request, env, persistedSettings);
	if (url.pathname === '/dashboard' && request.method === 'GET') return timed(timings, 'dashboard', () => renderDashboardPage(env, runtime));
	if (url.pathname === '/settings' && request.method === 'GET') return renderSettingsPage(request, runtime);
	if (url.pathname === '/api-subscriptions' && request.method === 'GET') return renderGeneratedNodesPage(request, env, runtime);
	if (url.pathname === '/shares' && request.method === 'GET') return renderSharesPage(request, env, runtime);
	if (url.pathname === '/requests' && request.method === 'GET') return renderRequestsPage(request, env, runtime);
	if (url.pathname !== '/') return textResponse('页面不存在', 404);
	if (request.method === 'GET' || request.method === 'POST') {
		return handleMainPage(request, env, runtime, ctx, timings);
	}
	return textResponse('Method Not Allowed', 405);
}

function withServerTiming(response, startedAt, timings) {
	const headers = new Headers(response.headers);
	headers.append('Server-Timing', [...timings, `app;dur=${Math.max(0, Date.now() - startedAt)}`].join(', '));
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
