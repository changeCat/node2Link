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
	await expect(page.locator('#saveStatus')).toHaveText('刚刚已保存');
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
