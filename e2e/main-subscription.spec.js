import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const first = 'vless://uuid@origin.example.com:443?security=tls&type=ws&host=origin.example.com&sni=origin.example.com&path=%2Fws#Main-HK';
const second = 'hysteria2://secret@origin2.example.com:443?sni=origin2.example.com#Main-HY2';
test.beforeEach(async ({ page }) => {
 page.runtimeErrors = [];
 page.on('pageerror', error => page.runtimeErrors.push(error.message));
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:8790)/, route => route.abort());
 await page.goto('/login');
 await page.locator('[name="username"]').fill('admin');
 await page.locator('[name="password"]').fill('browser-test-password');
 await page.locator('button[type="submit"]').click();
 await expect(page).toHaveURL(/\/$/);
 await page.evaluate(async () => {
  localStorage.clear();
  const response = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '' });
  if (!response.ok) throw new Error('Unable to reset main fixture');
 });
 await page.reload();
});
test.afterEach(async ({ page }, testInfo) => {
 expect(page.runtimeErrors).toEqual([]);
 await page.screenshot({ path: testInfo.outputPath('main-page.png'), fullPage: true });
 await page.evaluate(async () => { await fetch('/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '' }); localStorage.clear(); });
});
async function save(page) {
 await page.locator('#saveButton').click();
 await expect(page.locator('#saveStatus')).toHaveText('刚刚已保存');
}
async function seed(page) { await page.locator('#content').fill(first + '\n' + second); await save(page); }
async function addEndpoints(page, addresses = 'cf.example.com\n203.0.113.10:8443') {
 await page.locator('#addEndpoint').click();
 await page.locator('#endpointAddresses').fill(addresses);
 await page.locator('#selectTargets').click();
 await page.locator('#endpointForm button[type="submit"]').click();
 await expect(page.locator('#endpointDialog')).not.toBeVisible();
}
async function subscription(page) {
 const href = await page.locator('[onclick^="copySubscription"]').first().getAttribute('data-url');
 const url = new URL(href); url.search = '?b64';
 const response = await page.request.get(url.href);
 expect(response.status()).toBe(200);
 return Buffer.from(await response.text(), 'base64').toString().trim().split('\n').filter(Boolean);
}
test('main associations generate on save, retain identity on edit and feed share selection', async ({ page }) => {
 await seed(page); await addEndpoints(page);
 await expect(page.locator('#duplicateCount')).toHaveText('4');
 await expect(page.locator('#moreOriginals')).toBeHidden();
 await expect(page.locator('#moreEndpoints')).toBeHidden();
 await expect(page.locator('#morePreview')).toBeHidden();
 expect(await subscription(page)).toEqual([first, second]);
 await page.screenshot({ path: test.info().outputPath('configured-main.png'), fullPage: true });
 await save(page);
 expect(await subscription(page)).toHaveLength(6);
 await page.reload();
 await expect(page.locator('#endpointList .main-endpoint-row')).toHaveCount(2);
 const before = await page.evaluate(() => JSON.parse(document.getElementById('page-data-home').textContent).mainConfig);
 await page.locator('[data-edit-original]').first().click();
 await page.locator('#originalValue').fill(first.replace('uuid@', 'updated-secret@'));
 await page.locator('#originalForm button[type="submit"]').click();
 await expect(page.locator('#duplicateCount')).toHaveText('4');
 await save(page); await page.reload();
 const after = await page.evaluate(() => JSON.parse(document.getElementById('page-data-home').textContent).mainConfig);
 expect(after.originals[0].id).toBe(before.originals[0].id);
 expect(after.endpoints.map(item => item.originalIds)).toEqual(before.endpoints.map(item => item.originalIds));
 const lines = await subscription(page);
 expect(lines.filter(line => line.includes('updated-secret@'))).toHaveLength(3);
 expect(lines.filter(line => line.startsWith('hysteria2://'))).toHaveLength(3);
 await page.goto('/shares');
 await page.locator('#openNodePicker').click();
 await page.locator('#nodeSource').selectOption('main-extension');
 await expect(page.locator('.picker-node')).toHaveCount(4);
 await page.locator('[data-main-group]').first().click();
 await expect(page.locator('#selectedNodeCount')).toHaveText('已选择 2 个');
 await page.locator('#selectVisibleNodes').click();
 await page.locator('#addSelectedNodes').click();
 const selected = (await page.locator('#shareContent').inputValue()).split('\n');
 expect(selected).toHaveLength(4);
 expect(selected.every(line => lines.includes(line))).toBe(true);
 await page.goto('/');
 await page.locator('[data-toggle-endpoint]').first().click();
 await expect(page.locator('#duplicateCount')).toHaveText('2');
 await save(page);
 expect(await subscription(page)).toHaveLength(4);
});
test('complete JSON backup, undo, deletion and invalid drafts preserve main associations', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com'); await save(page);
 const downloadPromise = page.waitForEvent('download');
 await page.locator('[onclick="downloadBackup()"]').click();
 const backup = await downloadPromise;
 expect(backup.suggestedFilename()).toMatch(/\.json$/);
 const path = await backup.path();
 await page.locator('[data-delete-original]').first().click();
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#nodeCount')).toHaveText('1');
 await expect(page.locator('#duplicateCount')).toHaveText('1');
 await page.locator('#undoButton').click();
 await expect(page.locator('#duplicateCount')).toHaveText('2');
 await page.locator('#content').fill(first.replace('uuid@', 'bulk-new@') + '\n' + second);
 await expect(page.locator('#validationIssues')).toContainText('原始节点已不存在');
 await page.reload();
 await expect(page.locator('#mainConfirmTitle')).toHaveText('恢复本地草稿');
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#validationIssues')).toContainText('原始节点已不存在');
 await expect(page.locator('#content')).toHaveValue(/bulk-new@/);
 await page.locator('#restoreInput').setInputFiles({ name: backup.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(path) });
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#content')).toHaveValue(first + '\n' + second);
 await expect(page.locator('#duplicateCount')).toHaveText('2');
});
test('endpoint validation retains input, and failed saves keep the current subscription', async ({ page }) => {
 await seed(page);
 await page.locator('#addEndpoint').click();
 await page.locator('#endpointAddresses').fill('cf.example.com');
 await page.locator('#endpointForm button[type="submit"]').click();
 await expect(page.locator('#endpointError')).toContainText('至少勾选');
 await expect(page.locator('#endpointAddresses')).toHaveValue('cf.example.com');
 await page.locator('#endpointTargets input').first().check();
 await page.locator('#endpointForm button[type="submit"]').click();
 await page.route('http://127.0.0.1:8790/', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { message: '模拟保存失败' } }) : route.continue());
 await page.locator('#saveButton').click();
 await expect(page.locator('#saveStatus')).toContainText('模拟保存失败');
 await expect(page.locator('#endpointList .main-endpoint-row')).toHaveCount(1);
 expect(await subscription(page)).toEqual([first, second]);
 await page.unroute('http://127.0.0.1:8790/');
 await save(page);
 expect(await subscription(page)).toHaveLength(3);
});