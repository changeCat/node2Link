import { setOriginals } from './main-helpers.js';
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
async function seed(page) { await setOriginals(page, first + '\n' + second); await save(page); }
async function addEndpoints(page, addresses = 'cf.example.com\n203.0.113.10:8443') {
 await page.locator('#addEndpoint').click();
 for (const [i, value] of addresses.split('\n').entries()) {
  if (i) await page.locator('#addEndpointRow').click();
  const [address, port = '443'] = value.split(':');
  const row = page.locator('.endpoint-input-row').nth(i);
  await row.locator('[data-address]').fill(address);
  await row.locator('[data-port]').fill(port);
  await row.locator('[data-label]').fill('优选 ' + (i + 1));
 }
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
 await setOriginals(page, first.replace('uuid@', 'bulk-new@') + '\n' + second);
 await expect(page.locator('#validationIssues')).toHaveText('');
 await expect(page.locator('#duplicateCount')).toHaveText('1');
 await page.reload();
 await expect(page.locator('#mainConfirmTitle')).toHaveText('恢复本地草稿');
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#validationIssues')).toHaveText('');
 await expect(page.locator('#duplicateCount')).toHaveText('1');
 await expect(page.locator('#content')).toHaveValue(/bulk-new@/);
 await page.locator('#restoreInput').setInputFiles({ name: backup.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(path) });
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#content')).toHaveValue(first + '\n' + second);
 await expect(page.locator('#duplicateCount')).toHaveText('2');
});
test('endpoint validation retains input, and failed saves keep the current subscription', async ({ page }) => {
 await seed(page);
 await page.locator('#addEndpoint').click();
 await page.locator('#endpointRows [data-address]').fill('cf.example.com');
 await page.locator('#endpointForm button[type="submit"]').click();
 await expect(page.locator('#endpointError')).toContainText('至少勾选');
 await expect(page.locator('#endpointRows [data-address]')).toHaveValue('cf.example.com');
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

test('single save action preserves edits made during publication', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com');
 await expect(page.locator('[data-save-main]')).toHaveCount(1);
 await expect(page.locator('#previewSection #saveButton')).toHaveCount(1);
 let releaseSave, markStarted;
 const gate = new Promise(resolve => { releaseSave = resolve; });
 const started = new Promise(resolve => { markStarted = resolve; });
 await page.route('http://127.0.0.1:8790/', async route => {
  if (route.request().headers()['x-node2link-action'] !== 'save-config') return route.continue();
  markStarted(); await gate; await route.continue();
 });
 try {
  await page.locator('#previewSection [data-save-main]').click();
  await started;
  for (const button of await page.locator('[data-save-main]').all()) {
   await expect(button).toBeDisabled();
   await expect(button).toHaveText('保存中');
  }
  await setOriginals(page, first.replace('#Main-HK', '#During-save'), 'append');
 } finally { releaseSave(); }
 await expect(page.locator('#saveStatus')).toHaveText('保存期间有新修改，请再次保存');
 expect(await subscription(page)).toHaveLength(4);
 for (const button of await page.locator('[data-save-main]').all()) {
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('保存全部并生效');
 }
 await page.unroute('http://127.0.0.1:8790/');
 await save(page);
 expect(await subscription(page)).toHaveLength(5);
});

test('closing a changed original requires a choice and keeps its associations', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com'); await save(page);
 await page.locator('[data-edit-original]').first().click();
 const edited = first.replace('uuid@', 'edited-uuid@');
 await page.locator('#originalValue').fill(edited);
 await page.locator('#closeOriginal').click();
 await expect(page.locator('#mainConfirmTitle')).toHaveText('放弃节点编辑');
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '取消', exact: true }).click();
 await expect(page.locator('#originalValue')).toHaveValue(edited);
 await page.locator('#originalValue').press('Escape');
 await expect(page.locator('#mainConfirmTitle')).toHaveText('放弃节点编辑');
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#originalDialog')).not.toBeVisible();
 await expect(page.locator('#content')).toHaveValue(first + '\n' + second);
 await expect(page.locator('#duplicateCount')).toHaveText('2');
 await page.locator('[data-edit-original]').first().click();
 await page.locator('#cancelOriginal').click();
 await expect(page.locator('#mainConfirmDialog')).not.toBeVisible();
});
test('compact cards, append, independent endpoints, exports and replacement cleanup', async ({ page }) => {
 await setOriginals(page, first, 'append');
 await setOriginals(page, second, 'append');
 await expect(page.locator('#content')).toBeHidden();
 await expect(page.locator('#originalList .main-node-row')).toHaveCount(2);
 await expect(page.locator('#originalList')).not.toContainText('uuid');
 await page.locator('[data-view-original]').first().click();
 await expect(page.locator('#nodeViewValue')).toHaveValue(first);
 await page.locator('#closeNodeView').click();
 await addEndpoints(page);
 await page.locator('[data-edit-original]').first().click();
 const updated = first.replace('uuid@', 'reset-uuid@').replace('#Main-HK', '#Renamed').replace('security=tls', 'security=none');
 await page.locator('#originalValue').fill(updated);
 await page.locator('#originalForm button[type="submit"]').click();
 await expect(page.locator('#duplicateCount')).toHaveText('4');
 await expect(page.locator('#mainPreview')).toContainText('Renamed-优选 1');
 await save(page);
 const output = await subscription(page);
 expect(output.filter(line => line.includes('reset-uuid@'))).toHaveLength(3);
 expect(output.some(line => line.includes('@cf.example.com:443') && decodeURIComponent(line).endsWith('-优选 1'))).toBe(true);
 expect(output.some(line => line.includes('@203.0.113.10:8443') && decodeURIComponent(line).endsWith('-优选 2'))).toBe(true);
 await page.locator('#previewSearch').fill('no matches');
 for (const [button, kind, count] of [['exportOriginals', 'originals', 2], ['exportExtensions', 'extensions', 4], ['exportMain', 'all', 6]]) {
  const pending = page.waitForEvent('download');
  await page.locator('#' + button).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain(kind);
  const lines = (await readFile(await download.path(), 'utf8')).split('\n');
  expect(lines).toHaveLength(count);
  if (kind === 'originals') expect(lines).toEqual([updated, second]);
  if (kind === 'extensions') expect(lines.every(line => ![updated, second].includes(line))).toBe(true);
 }
 await setOriginals(page, 'vless://new@new.example.com:443#New');
 await expect(page.locator('#duplicateCount')).toHaveText('0');
 await expect(page.locator('#endpointList .main-badge')).toHaveText(['停用', '停用']);
 await page.locator('#undoButton').click();
 await expect(page.locator('#duplicateCount')).toHaveText('4');
 const converter = await page.locator('.workspace-config').boundingBox();
 const subscriptions = await page.locator('#owner-title').boundingBox();
 expect(converter.y + converter.height).toBeLessThan(subscriptions.y);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty batches are rejected and bulk deletion preserves undo and associations', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com'); await save(page);
 await expect(page.locator('.editor-toolbar button')).toHaveCount(0);
 await expect(page.locator('#originalSection #undoButton')).toHaveCount(1);
 await expect(page.locator('#originalSection #saveButton')).toHaveCount(0);
 await expect(page.locator('#originalSection > .editor-actions #exportOriginals')).toHaveCount(1);
 await expect(page.locator('#originalSection > .editor-actions #addOriginals')).toHaveCount(1);
 await page.locator('#addOriginals').click();
 for (const mode of ['append', 'replace']) {
  await page.locator('#batchValue').fill(' \n\t ');
  await page.locator(`#batchForm button[value="${mode}"]`).click();
  await expect(page.locator('#batchError')).toContainText('请至少填写');
  await expect(page.locator('#mainConfirmDialog')).not.toBeVisible();
  await expect(page.locator('#content')).toHaveValue(first + '\n' + second);
 }
 await page.locator('#closeBatch').click();
 await page.locator('[data-select-original]').first().check();
 await page.locator('#originalSearch').fill('Main-HY2');
 await page.locator('#selectOriginals').click();
 await expect(page.locator('#originalSelectionCount')).toContainText('已选 2 项');
 await expect(page.locator('#selectOriginals')).toHaveText('取消全选');
 await page.locator('#selectOriginals').click();
 await expect(page.locator('#originalSelectionCount')).toContainText('已选 1 项');
 await expect(page.locator('#selectOriginals')).toHaveText('全选筛选结果');
 await page.locator('#originalSearch').fill('no matches');
 await expect(page.locator('#selectOriginals')).toBeDisabled();
 await expect(page.locator('#deleteOriginals')).toBeEnabled();
 await page.locator('#originalSearch').fill('Main-HY2');
 await page.locator('#selectOriginals').click();
 await page.locator('#deleteOriginals').click();
 await expect(page.locator('#mainConfirmText')).toContainText('2 个优选关联');
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '取消', exact: true }).click();
 await expect(page.locator('#nodeCount')).toHaveText('2');
 await page.locator('#deleteOriginals').click();
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#nodeCount')).toHaveText('0');
 await expect(page.locator('#endpointList')).toContainText('停用');
 await expect(page.locator('#deleteOriginals')).toBeDisabled();
 await page.locator('#undoButton').click();
 await expect(page.locator('#duplicateCount')).toHaveText('2');
 expect(await subscription(page)).toHaveLength(4);
});

test('lists scroll independently and selection includes unloaded matching nodes', async ({ page }) => {
 const lines = Array.from({ length: 105 }, (_, i) => first.replace('#Main-HK', '#Node-' + i));
 await setOriginals(page, lines.join('\n'));
 await addEndpoints(page, Array.from({ length: 8 }, (_, i) => `cf${i}.example.com`).join('\n'));
 for (const id of ['originalList', 'endpointList', 'mainPreview']) {
  const metrics = await page.locator('#' + id).evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
  expect(metrics.height).toBeLessThanOrEqual(480);
  expect(metrics.scroll).toBeGreaterThan(metrics.height);
  expect(metrics.overflow).toBe('auto');
 }
 await expect(page.locator('[data-select-original]')).toHaveCount(100);
 await page.locator('#selectOriginals').click();
 await expect(page.locator('#originalSelectionCount')).toContainText('已选 105 项');
 await expect(page.locator('#selectOriginals')).toHaveText('取消全选');
 await page.locator('#selectOriginals').click();
 await expect(page.locator('#selectOriginals')).toHaveText('全选筛选结果');
 await expect(page.locator('#deleteOriginals')).toBeDisabled();
 await page.locator('#selectOriginals').click();
 await page.locator('#deleteOriginals').click();
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#nodeCount')).toHaveText('0');
 await page.locator('#undoButton').click();
 await expect(page.locator('#nodeCount')).toHaveText('105');
 await expect(page.locator('#duplicateCount')).toHaveText('840');
});

test('custom converter addresses display in full without copy controls or fallback notice', async ({ page }) => {
 const url = 'https://converter.example.com/' + 'long-path-'.repeat(20);
 await page.goto('/settings');
 await page.locator('#addConverter').click();
 await page.locator('#converterName').fill('换行测试');
 await page.locator('#converterURL').fill(url);
 await page.locator('#applyConverter').click();
 const profile = page.locator('.converter-profile').filter({ hasText: '换行测试' });
 await profile.locator('input[type="radio"]').check();
 await page.locator('#saveConverterSelection').click();
 await expect(page.locator('#conversionMessage')).toHaveText('已保存');
 await page.goto('/');
 const entry = page.locator('.converter-entry').first();
 const full = entry.locator('.converter-full-url');
 await expect(full).toBeVisible();
 await expect(full).toHaveText(url);
 await expect(entry.locator('button, details, summary')).toHaveCount(0);
 await expect(page.locator('.converter-warning')).toHaveCount(0);
 expect(await full.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
 expect((await full.boundingBox()).height).toBeGreaterThan(40);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: test.info().outputPath('converter-full.png'), fullPage: true });
 await page.goto('/settings');
 await page.locator('input[name="converterMode"][value="default"]').check();
 await page.locator('#saveConverterSelection').click();
 await expect(page.locator('#conversionMessage')).toHaveText('已保存');
 await page.locator('.converter-profile').filter({ hasText: '换行测试' }).locator('[data-remove]').click();
 await expect(page.locator('#conversionMessage')).toHaveText('已保存');
 await page.goto('/');
});

test('wheel scrolling passes from short lists and list boundaries to the page', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com');
 async function wheelOnList(id) {
  const list = page.locator('#' + id);
  await list.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await list.hover();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -350);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(before);
 }
 for (const id of ['originalList', 'mainPreview']) {
  expect(await page.locator('#' + id).evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  await wheelOnList(id);
 }
 await setOriginals(page, Array.from({ length: 30 }, (_, i) => first.replace('#Main-HK', '#Scroll-' + i)).join('\n'));
 await addEndpoints(page, 'scroll.example.com');
 for (const id of ['originalList', 'mainPreview']) {
  expect(await page.locator('#' + id).evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator('#' + id).evaluate(el => { el.scrollTop = 0; });
  await wheelOnList(id);
 }
});
