import { test, expect } from '@playwright/test';

const first = 'vless://uuid@first.example.com:443#First';
const second = 'trojan://password@second.example.com:443#Second';

test.beforeEach(async ({ page }) => {
	page.runtimeErrors = [];
	page.on('pageerror', error => page.runtimeErrors.push(error.message));
	// Browser assets must work without third-party CDNs.
	await page.route(/^https?:\/\/(?!127\.0\.0\.1:8790)/, route => route.abort());
	await page.goto('/login');
	await page.locator('[name="username"]').fill('admin');
	await page.locator('[name="password"]').fill('browser-test-password');
	await page.locator('button[type="submit"]').click();
	await expect(page).toHaveURL(/\/$/);
});

test.afterEach(async ({ page }, testInfo) => {
	expect(page.runtimeErrors).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true });
});

async function saveMain(page, content) {
	await page.locator('#content').fill(content);
	await page.locator('#saveButton').click();
	await expect(page.locator('#saveStatus')).toHaveText(/^(刚刚已保存|已同步)$/);
	// Filtered runs may already have this content. Verify storage rather than
	// requiring a redundant write, and never mistake a false "synced" UI for a save.
	const stored = await page.evaluate(async () => {
		// Use the browser's authenticated request path, including its localhost cookie handling.
		const response = await fetch('/', { cache: 'no-store' });
		if (!response.ok) throw new Error('Saved content read failed: ' + response.status);
		return new DOMParser().parseFromString(await response.text(), 'text/html').getElementById('content')?.value;
	});
	expect(stored).toBe(content);
}

test('edits entered while the client script is loading remain unsaved until published', async ({ page }) => {
	await page.waitForLoadState('domcontentloaded');
	let releaseScript;
	const scriptReady = new Promise(resolve => { releaseScript = resolve; });
	await page.route('**/assets/home.js?*', async route => { await scriptReady; await route.continue(); });
	const content = 'vless://uuid@slow-load.example.com:443#Early-' + Date.now();
	try {
		await page.reload({ waitUntil: 'commit' });
		await page.locator('#content').fill(content);
		await expect(page.locator('#saveButton')).toBeDisabled();
	} finally { releaseScript(); }
	await page.waitForLoadState('domcontentloaded');
	await expect(page.locator('#saveStatus')).toHaveText('有未保存更改');
	await page.locator('#saveButton').click();
	await expect(page.locator('#saveStatus')).toHaveText('刚刚已保存');
	await page.reload();
	await expect(page.locator('#content')).toHaveValue(content);
});

test('manual save, reload, version restore, local draft, copy and QR', async ({ page }) => {
	await saveMain(page, first);
	await saveMain(page, second);
	await page.reload();
	await expect(page.locator('#content')).toHaveValue(second);
	await page.locator('[onclick="loadLastSavedVersion()"], [onclick="loadLastSavedVersion();"]').click();
	await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
	await expect(page.locator('#content')).toHaveValue(first);
	await page.locator('#content').fill(first + '\n' + second);
	await page.reload();
	await expect(page.locator('#mainConfirmTitle')).toHaveText('恢复本地草稿');
	await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
	await expect(page.locator('#content')).toHaveValue(first + '\n' + second);
	await page.locator('#saveButton').click();
	await expect(page.locator('#saveStatus')).toHaveText('刚刚已保存');
	const copy = page.locator('[onclick^="copySubscription"]').first();
	const link = await copy.getAttribute('data-url');
	await copy.click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);
	await page.locator('[onclick^="showQRCode"]').first().click();
	await expect(page.locator('#qrDialog')).toBeVisible();
	await expect(page.locator('#qrcode canvas')).toHaveCount(1);
	await expect(page.locator('#qrUrl')).toHaveText(link);
});

test('share picker, edit, copy, QR, reset and delete', async ({ page }) => {
	await saveMain(page, first + '\n' + second + '\n' + 'vless://uuid@picker.example.com:443#Picker');
	await page.goto('/shares');
	await page.locator('#shareName').fill('Browser share');
	await page.locator('#openNodePicker').click();
	await page.locator('#nodeSearch').fill('Picker');
	await page.locator('#selectVisibleNodes').click();
	await page.locator('#addSelectedNodes').click();
	await expect(page.locator('#shareContent')).toHaveValue(/picker\.example\.com/);
	await page.locator('#submitShare').click();
	await expect(page.locator('#formMessage')).toContainText('已保存');
	let card = page.locator('.share-card').filter({ hasText: 'Browser share' });
	await card.locator('[data-edit]').click();
	await expect(page.locator('#formTitle')).toHaveText('修改分享');
	await expect(page.locator('#shareName')).toHaveValue('Browser share');
	await page.locator('#shareName').fill('Browser edited');
	await page.locator('#submitShare').click();
	card = page.locator('.share-card').filter({ hasText: 'Browser edited' });
	const oldLink = await card.locator('[data-copy]').getAttribute('data-copy');
	await card.locator('[data-copy]').click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(oldLink);
	await card.locator('[data-qr]').click();
	await expect(page.locator('#qrcode canvas')).toHaveCount(1);
	await page.locator('#closeQR').click();
	await card.locator('[data-reset]').click();
	await page.locator('#sharePromptAccept').click();
	await expect(page.locator('#sharePromptText')).toContainText('订阅链接已重置');
	await page.locator('#sharePromptAccept').click();
	const newLink = await card.locator('[data-copy]').getAttribute('data-copy');
	expect(newLink).not.toBe(oldLink);
	expect((await page.request.get(oldLink)).status()).toBe(404);
	expect((await page.request.get(newLink + '?b64')).status()).toBe(200);
	await card.locator('[data-delete]').click();
	await page.locator('#sharePromptAccept').click();
	await expect(card).toHaveCount(0);
	expect((await page.request.get(newLink)).status()).toBe(404);
});

test('settings sections save independently and failed saves retain input', async ({ page }) => {
	await page.goto('/settings');
	await page.locator('#subscriptionToken').fill('browser-entry-token');
	await page.locator('#entryForm button[type="submit"]').click();
	await expect(page.locator('#entryMessage')).toHaveText('已保存');
	await page.locator('#pageTitle').fill('Browser title');
	await page.locator('#displayForm button[type="submit"]').click();
	await expect(page.locator('#displayMessage')).toHaveText('已保存');
	await page.reload();
	await expect(page.locator('#pageTitle')).toHaveValue('Browser title');
	await expect(page.locator('#subscriptionToken')).toHaveValue('browser-entry-token');
	await page.route('**/api/settings', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '模拟存储暂时不可用' }) }));
	await page.locator('#pageTitle').fill('Keep unsaved input');
	await page.locator('#displayForm button[type="submit"]').click();
	await expect(page.locator('#displayMessage')).toHaveText('模拟存储暂时不可用');
	await expect(page.locator('#pageTitle')).toHaveValue('Keep unsaved input');
	await expect(page.locator('#displayForm button[type="submit"]')).toBeEnabled();
});

test('stale tabs keep their edits on conflict and clearing the editor stays empty', async ({ page, context }) => {
	await saveMain(page, first);
	const stale = await context.newPage();
	try {
		await stale.goto('/');
		await saveMain(page, second);
		await stale.locator('#content').fill(first + '\n' + second);
		await stale.locator('#saveButton').click();
		await expect(stale.locator('#saveStatus')).toContainText('已在其他页面更新');
		await expect(stale.locator('#content')).toHaveValue(first + '\n' + second);
		await expect(stale.locator('#saveButton')).toBeEnabled();
		// The older edit was rejected; the current tab can still publish its version.
		await saveMain(page, '');
		const link = await page.locator('[onclick^="copySubscription"]').first().getAttribute('data-url');
		const response = await page.request.get(link + (link.includes('?') ? '&' : '?') + 'base64');
		expect(response.status()).toBe(200);
		expect(await response.text()).toBe('');
		await page.reload();
		await expect(page.locator('#content')).toHaveValue('');
	} finally { await stale.close(); }
});

test('share pause, expiry and renewal retain the same link', async ({ page }) => {
	await page.goto('/shares');
	await page.locator('#shareName').fill('Temporary personal share');
	await page.locator('#shareContent').fill(first);
	await page.locator('#shareExpiresAt').fill('2099-01-01T12:00');
	await page.locator('#submitShare').click();
	const card = page.locator('.share-card').filter({ hasText: 'Temporary personal share' });
	await expect(card).toContainText('使用中');
	const link = await card.locator('[data-copy]').getAttribute('data-copy');
	await card.locator('[data-toggle]').click();
	await expect(card).toContainText('已暂停');
	await page.reload();
	await expect(card).toContainText('已暂停');
	await page.screenshot({ path: test.info().outputPath('paused-share.png'), fullPage: true });
	expect((await page.request.get(link)).status()).toBe(410);
	await card.locator('[data-toggle]').click();
	await expect(card).toContainText('使用中');
	expect((await page.request.get(link + '?base64')).status()).toBe(200);
	await card.locator('[data-edit]').click();
	await expect(page.locator('#formTitle')).toHaveText('修改分享');
	await expect(page.locator('#shareExpiresAt')).toHaveValue('2099-01-01T12:00');
	await page.locator('#shareExpiresAt').fill('2000-01-01T12:00');
	await page.locator('#submitShare').click();
	await expect(card).toContainText('已到期');
	expect((await page.request.get(link)).status()).toBe(410);
	await card.locator('[data-edit]').click();
	await expect(page.locator('#formTitle')).toHaveText('修改分享');
	await page.locator('#shareExpiresAt').fill('');
	await page.locator('#submitShare').click();
	await expect(card).toContainText('长期有效');
	expect(await card.locator('[data-copy]').getAttribute('data-copy')).toBe(link);
	expect((await page.request.get(link + '?base64')).status()).toBe(200);
	await card.locator('[data-delete]').click();
	await page.locator('#sharePromptAccept').click();
	await expect(card).toHaveCount(0);
});

test('API template save, token rotation, import, copy and deletion', async ({ page }) => {
	await page.goto('/api-subscriptions');
	await expect(page.locator('#apiToken')).toHaveValue(/^[A-Za-z0-9_-]{16,128}$/);
	const oldToken = await page.locator('#apiToken').inputValue();
	expect(oldToken).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
	await page.locator('#nodeTemplate').fill('vless://uuid@{{address}}:{{port}}#{{name}}');
	await page.locator('#nameTemplate').fill('Browser-{{address}}');
	await page.locator('#saveSettings').click();
	await expect(page.locator('#settingsMessage')).toContainText('已保存');
	await page.locator('#regenerateToken').click();
	await page.locator('#confirmAccept').click();
	await expect(page.locator('#settingsMessage')).toHaveText('新 Token 尚未保存');
	await page.locator('#saveSettings').click();
	await expect(page.locator('#settingsMessage')).toContainText('已保存');
	const token = await page.locator('#apiToken').inputValue();
	expect(token).not.toBe(oldToken);
	expect((await page.request.post('/api/import', { headers: { 'X-API-Token': oldToken, 'Content-Type': 'text/plain' }, data: first })).status()).toBe(401);
	expect((await page.request.get('/api/import', { params: { token, address: 'browser-import.example.com', port: '443' } })).status()).toBe(201);
	await page.reload();
	await expect(page.locator('#apiToken')).toHaveValue(token);
	const card = page.locator('.node-card').filter({ hasText: 'Browser-browser-import.example.com' });
	await card.locator('[data-copy-node]').click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('browser-import.example.com:443');
	await card.locator('[data-delete]').click();
	await page.locator('#confirmAccept').click();
	await expect(card).toHaveCount(0);
});

test('editor coalesces draft writes and flushes the latest edit before reload or save', async ({ page }) => {
	await saveMain(page, first);
	const latest = first + '\n' + second;
	const immediate = await page.evaluate(content => {
		window.draftWrites = 0;
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = function(key, value) {
			if (key.startsWith('node2link:draft:')) window.draftWrites++;
			return original.call(this, key, value);
		};
		const editor = document.getElementById('content');
		for (let i = 0; i < 20; i++) {
			editor.value = content + i;
			editor.dispatchEvent(new Event('input', { bubbles: true }));
		}
		return { writes: window.draftWrites, status: document.getElementById('saveStatus').textContent };
	}, latest);
	expect(immediate).toEqual({ writes: 0, status: '有未保存更改' });
	await expect.poll(() => page.evaluate(() => window.draftWrites)).toBe(1);
	await expect(page.locator('#nodeCount')).toHaveText('2');
	await page.locator('#content').fill(latest);
	await page.reload();
	await expect(page.locator('#mainConfirmTitle')).toHaveText('恢复本地草稿');
	await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
	await expect(page.locator('#content')).toHaveValue(latest);
	await saveMain(page, second);
	// Advancing beyond the debounce must not resurrect a draft after successful save.
	await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
	expect(await page.evaluate(() => localStorage.getItem('node2link:draft:' + location.host + location.pathname))).toBeNull();
});

test('picker loads on demand and pages large results without limiting selection', async ({ page }) => {
	let requests = 0;
	const nodes = Array.from({ length: 250 }, (_, i) => ({ id: 'main-' + i, source: 'main', sourceName: '主订阅', name: 'Node ' + i, content: 'vless://id@node' + i + '.example.com:443#Node-' + i }));
	await page.route('**/api/node-candidates*', route => {
		requests++;
		return route.fulfill({ json: { ok: true, nodes, hasUpstream: false } });
	});
	await page.goto('/shares');
	expect(requests).toBe(0);
	await page.locator('#openNodePicker').click();
	await expect(page.locator('.picker-node')).toHaveCount(100);
	await page.locator('#morePickerNodes').click();
	await expect(page.locator('.picker-node')).toHaveCount(200);
	await page.locator('#nodeSearch').fill('node249.example.com');
	await expect(page.locator('.picker-node')).toHaveCount(1);
	await page.locator('#selectVisibleNodes').click();
	await expect(page.locator('#selectedNodeCount')).toHaveText('已选择 1 个');
	await page.locator('#nodeSearch').fill('');
	await page.locator('#selectVisibleNodes').click();
	await expect(page.locator('#selectedNodeCount')).toHaveText('已选择 250 个');
	await page.locator('#addSelectedNodes').click();
	expect((await page.locator('#shareContent').inputValue()).split('\n')).toHaveLength(250);
	expect(requests).toBe(1);
});

test('picker keeps local selections when slow upstream results arrive', async ({ page }) => {
	let release;
	const ready = new Promise(resolve => { release = resolve; });
	const local = { id: 'main-0', source: 'main', sourceName: '主订阅', name: 'Local', content: first };
	const remote = { ...local, name: 'Remote', content: second };
	await page.route('**/api/node-candidates*', async route => {
		if (new URL(route.request().url()).searchParams.get('source') === 'local') {
			await route.fulfill({ json: { ok: true, nodes: [local], hasUpstream: true } });
		} else {
			await ready;
			await route.fulfill({ json: { ok: true, nodes: [remote, { ...local, id: 'main-1' }], hasUpstream: true, upstreamFailures: 0 } });
		}
	});
	try {
		await page.goto('/shares');
		await page.locator('#openNodePicker').click();
		await expect(page.locator('#nodePickerStatus')).toContainText('本地节点已就绪');
		await page.locator('.picker-node input').check();
		await expect(page.locator('#selectedNodeCount')).toHaveText('已选择 1 个');
	} finally { release(); }
	await expect(page.locator('.picker-node')).toHaveCount(2);
	await expect(page.locator('.picker-node').filter({ hasText: 'Local' }).locator('input')).toBeChecked();
	await expect(page.locator('.picker-node').filter({ hasText: 'Remote' }).locator('input')).not.toBeChecked();
	await page.locator('#addSelectedNodes').click();
	await expect(page.locator('#shareContent')).toHaveValue(first);
});

test('picker offers retry and keeps local nodes when the upstream request fails', async ({ page }) => {
	let fullRequests = 0;
	const node = { id: 'main-0', source: 'main', sourceName: '主订阅', name: 'Local', content: first };
	const remote = { ...node, id: 'main-1', name: 'Remote', content: second };
	await page.route('**/api/node-candidates*', route => {
		if (!new URL(route.request().url()).search) {
			fullRequests++;
			if (fullRequests === 2) return route.fulfill({ status: 503, json: { message: '暂时不可用' } });
			return route.fulfill({ json: { ok: true, nodes: [node, remote], hasUpstream: true, upstreamFailures: fullRequests === 1 ? 1 : 0 } });
		}
		return route.fulfill({ json: { ok: true, nodes: [node], hasUpstream: true, upstreamFailures: 0 } });
	});
	await page.goto('/shares');
	await page.locator('#openNodePicker').click();
	await expect(page.locator('#retryNodePicker')).toBeVisible();
	await expect(page.locator('.picker-node')).toHaveCount(2);
	await page.locator('.picker-node').filter({ hasText: 'Remote' }).locator('input').check();
	await page.locator('#retryNodePicker').click();
	await expect(page.locator('#nodePickerStatus')).toContainText('暂时不可用');
	await expect(page.locator('.picker-node').filter({ hasText: 'Remote' }).locator('input')).toBeChecked();
	await page.locator('#retryNodePicker').click();
	await expect(page.locator('#retryNodePicker')).toBeHidden();
	await expect(page.locator('#nodePickerStatus')).toContainText('节点已加载');
	await expect(page.locator('.picker-node').filter({ hasText: 'Remote' }).locator('input')).toBeChecked();
	expect(fullRequests).toBe(3);
	await page.screenshot({ path: test.info().outputPath('node-picker.png'), fullPage: true });
});
