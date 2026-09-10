import { requestHasSameOrigin, textResponse } from '../http.js';
import { adminPassword, adminUsername, safeEqual, createSessionCookie } from '../auth.js';
import { ensureMainIdentity } from '../storage/settings.js';
import { renderLoginPage } from '../ui/pages.js';
import { readBoundedBody, readJSONBody, BODY_LIMITS, RequestBodyError } from '../request-body.js';

export async function handleLogin(request, env, runtime, persistedSettings) {
	if (!requestHasSameOrigin(request)) return textResponse('Invalid origin', 403);
	const configuredPassword = adminPassword(env);
	if (!configuredPassword) return renderLoginPage(env, runtime, '尚未配置 ADMIN_PASSWORD，登录已禁用。');
	let username = '';
	let password = '';
	const contentType = request.headers.get('Content-Type') || '';
	if (contentType.includes('application/json')) {
		const body = await readJSONBody(request, BODY_LIMITS.login);
		username = body.username;
		password = body.password;
	} else {
		const body = await readBoundedBody(request, BODY_LIMITS.login);
		let form;
		try { form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData(); }
		catch { throw new RequestBodyError('登录表单格式无效', 400); }
		username = form.get('username');
		password = form.get('password');
	}
	if (!safeEqual(username, adminUsername(env)) || !safeEqual(password, configuredPassword)) {
		return renderLoginPage(env, runtime, '用户名或密码错误。', 401);
	}
	await ensureMainIdentity(env, runtime, persistedSettings);
	return new Response(null, {
		status: 303,
		headers: { Location: '/', 'Set-Cookie': await createSessionCookie(env), 'Cache-Control': 'no-store' }
	});
}
