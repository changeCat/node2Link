import { setOriginals } from './main-helpers.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const first = 'vless://uuid@origin.example.com:443?security=tls&type=ws&host=origin.example.com&sni=origin.example.com&path=%2Fws#Main-HK';
const second = 'hysteria2://secret@origin2.example.com:443?sni=origin2.example.com#Main-HY2';
test.beforeEach(async ({ page }) => {
 page.runtimeErrors = [];
 page.importedNodeIds = [];
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
 await page.evaluate(async ids => { for (const id of ids) await fetch('/api/generated-nodes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); }, page.importedNodeIds);
 await page.screenshot({ path: testInfo.outputPath('main-page.png'), fullPage: true });
 await page.evaluate(async () => { await fetch('/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '' }); localStorage.clear(); });
});
async function save(page) {
 await page.locator('#saveButton').click();
 await expect(page.locator('#saveStatus')).toHaveText(/^(刚刚已保存|已同步)$/);
}
async function restorePreviousOriginals(page) {
 await page.locator('[onclick="openOriginalHistory()"]').click();
 await expect(page.locator('#originalHistorySelect option').nth(1)).toBeAttached();
 await page.locator('#originalHistorySelect').selectOption({ index: 1 });
 await expect(page.locator('#restoreOriginalVersion')).toBeEnabled();
 await page.locator('#restoreOriginalVersion').click();
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#originalHistoryDialog')).not.toBeVisible();
}
async function seed(page) { await setOriginals(page, first + '\n' + second); }
async function addEndpoints(page, addresses = 'cf.example.com\n203.0.113.10:8443') {
 await page.locator('#addEndpoint').click();
 for (const [i, value] of addresses.split('\n').entries()) {
  if (i) await page.locator('#addEndpointRow').click();
  const [address, port = '443'] = value.split(':');
  const row = page.locator('.endpoint-input-row').nth(i);
  await row.locator('[data-address]').fill(address);
  await row.locator('[data-port-preset]').selectOption(port);
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
 await expect(page.locator('#originalDialog')).not.toBeVisible();
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
test('original history can inspect, download and restore without publishing endpoint drafts', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com'); await save(page);
 await addEndpoints(page, 'pending.example.com');
 const updated = first.replace('uuid@', 'updated@');
 await page.locator('[data-edit-original]').first().click();
 await page.locator('#originalValue').fill(updated);
 await page.locator('#originalForm button[type="submit"]').click();
 await expect(page.locator('#originalDialog')).not.toBeVisible();
 const output = await subscription(page);
 expect(output).toHaveLength(4);
 expect(output.filter(line => line.includes('updated@'))).toHaveLength(2);
 expect(output.some(line => line.includes('pending.example.com'))).toBe(false);
 await expect(page.locator('#endpointList .main-endpoint-row')).toHaveCount(2);
 await page.locator('[onclick="openOriginalHistory()"]').click();
 await expect(page.locator('#originalHistoryContent')).toHaveValue(updated + '\n' + second);
 await page.locator('#originalHistorySelect').selectOption({ index: 1 });
 await expect(page.locator('#originalHistoryContent')).toHaveValue(first + '\n' + second);
 const pending = page.waitForEvent('download');
 await page.locator('#downloadOriginalVersion').click();
 const download = await pending;
 expect(download.suggestedFilename()).toMatch(/\.txt$/);
 expect(await readFile(await download.path(), 'utf8')).toBe(first + '\n' + second);
 await page.screenshot({ path: test.info().outputPath('original-history.png'), fullPage: true });
 await page.locator('#restoreOriginalVersion').click();
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#originalHistoryDialog')).not.toBeVisible();
 expect((await subscription(page)).filter(line => line.includes('uuid@'))).toHaveLength(2);
 await expect(page.locator('#endpointList .main-endpoint-row')).toHaveCount(2);
 await expect(page.locator('#saveStatus')).toContainText('未保存');
 await save(page);
 expect(await subscription(page)).toHaveLength(6);
});

test('TXT import preserves matching associations and original failures retain input', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com'); await save(page);
 await expect(page.getByText('备份 JSON', { exact: true })).toHaveCount(0);
 await expect(page.getByRole('button', { name: '导入 TXT', exact: true }).locator('svg.lucide-arrow-down-to-line')).toHaveCount(1);
 await page.locator('#restoreInput').setInputFiles({ name: 'originals.txt', mimeType: 'text/plain', buffer: Buffer.from(first) });
 await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#nodeCount')).toHaveText('1');
 expect(await subscription(page)).toHaveLength(2);
 await page.locator('[data-edit-original]').first().click();
 await page.locator('#originalValue').fill(first.replace('uuid@', 'retry@'));
 await page.route('http://127.0.0.1:8790/', route => route.request().headers()['x-node2link-action'] === 'save-originals' ? route.fulfill({ status: 503, json: { message: '模拟保存失败' } }) : route.continue());
 await page.locator('#originalForm button[type="submit"]').click();
 await expect(page.locator('#originalError')).toContainText('输入已保留');
 await expect(page.locator('#originalValue')).toHaveValue(/retry@/);
 expect((await subscription(page))[0]).toBe(first);
 await page.unroute('http://127.0.0.1:8790/');
 await page.locator('#originalForm button[type="submit"]').click();
 await expect(page.locator('#originalDialog')).not.toBeVisible();
 expect((await subscription(page)).filter(line => line.includes('retry@'))).toHaveLength(2);
 await page.reload();
 await expect(page.locator('#content')).toHaveValue(/retry@/);
});

test('Cloudflare port groups include every official port and retain custom ports', async ({ page }) => {
 await seed(page);
 await page.locator('#addEndpoint').click();
 const preset = page.locator('[data-port-preset]').first();
 await expect(preset).toHaveValue('443');
 expect(await preset.locator('optgroup[label="Cloudflare HTTPS"] option').evaluateAll(options => options.map(option => option.value))).toEqual(['443', '2053', '2083', '2087', '2096', '8443']);
 expect(await preset.locator('optgroup[label="Cloudflare HTTP"] option').evaluateAll(options => options.map(option => option.value))).toEqual(['80', '8080', '8880', '2052', '2082', '2086', '2095']);
 await page.locator('[data-address]').fill('cf.example.com');
 await preset.selectOption('2096');
 await page.locator('#endpointTargets input').first().check();
 await page.locator('#endpointForm button[type="submit"]').click();
 await expect(page.locator('#mainPreview')).toContainText('cf.example.com:2096');
 expect(await subscription(page)).toEqual([first, second]);
 await save(page);
 expect((await subscription(page)).some(line => line.includes('@cf.example.com:2096?'))).toBe(true);
 await page.locator('[data-edit-endpoint]').click();
 await expect(preset).toHaveValue('2096');
 await preset.selectOption('custom');
 await page.getByRole('spinbutton', { name: '自定义端口' }).fill('12345');
 await page.locator('#endpointForm button[type="submit"]').click();
 await save(page); await page.reload();
 await page.locator('[data-edit-endpoint]').click();
 await expect(preset).toHaveValue('custom');
 await expect(page.getByRole('spinbutton', { name: '自定义端口' })).toHaveValue('12345');
 await page.screenshot({ path: test.info().outputPath('endpoint-ports.png'), fullPage: true });
 await preset.selectOption('2087');
 await page.locator('#endpointForm button[type="submit"]').click();
 await save(page);
 expect((await subscription(page)).some(line => line.includes('@cf.example.com:2087?'))).toBe(true);
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
 await expect(page.locator('.editor-toolbar #saveButton')).toHaveCount(1);
 let releaseSave, markStarted;
 const gate = new Promise(resolve => { releaseSave = resolve; });
 const started = new Promise(resolve => { markStarted = resolve; });
 await page.route('http://127.0.0.1:8790/', async route => {
  if (route.request().headers()['x-node2link-action'] !== 'save-endpoints') return route.continue();
  markStarted(); await gate; await route.continue();
 });
 try {
  await page.locator('.editor-toolbar [data-save-main]').click();
  await started;
  for (const button of await page.locator('[data-save-main]').all()) {
   await expect(button).toBeDisabled();
   await expect(button).toHaveText('保存中');
  }
  await expect(page.locator('#addOriginals')).toBeDisabled();
  await addEndpoints(page, 'during-save.example.com');
 } finally { releaseSave(); }
 await expect(page.locator('#saveStatus')).toHaveText('保存期间有新修改，请再次保存');
 expect(await subscription(page)).toHaveLength(4);
 for (const button of await page.locator('[data-save-main]').all()) {
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('保存全部并生效');
 }
 await page.unroute('http://127.0.0.1:8790/');
 await save(page);
 expect(await subscription(page)).toHaveLength(6);
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
 await expect(page.locator('#originalDialog')).not.toBeVisible();
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
 await restorePreviousOriginals(page);
 await expect(page.locator('#saveButton')).toBeEnabled();
 await expect(page.locator('#duplicateCount')).toHaveText('0');
 await expect(page.locator('#nodeCount')).toHaveText('2');
 const converter = await page.locator('.workspace-config').boundingBox();
 const subscriptions = await page.locator('#owner-title').boundingBox();
 expect(converter.y + converter.height).toBeLessThan(subscriptions.y);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty batches are rejected and bulk deletion supports history restore and cleans associations', async ({ page }) => {
 await seed(page); await addEndpoints(page, 'cf.example.com'); await save(page);
 await expect(page.locator('.editor-toolbar button')).toHaveCount(1);
 await expect(page.locator('#originalSection #undoButton')).toHaveCount(0);
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
 await restorePreviousOriginals(page);
 await expect(page.locator('#saveButton')).toBeEnabled();
 await expect(page.locator('#duplicateCount')).toHaveText('0');
 await expect(page.locator('#nodeCount')).toHaveText('2');
 expect(await subscription(page)).toHaveLength(2);
});

test('lists scroll independently and selection includes unloaded matching nodes', async ({ page }) => {
 const lines = Array.from({ length: 105 }, (_, i) => first.replace('#Main-HK', '#Node-' + i));
 await setOriginals(page, lines.join('\n'));
 // Enough compact cards to overflow the desktop grid as well as the mobile list.
 await addEndpoints(page, Array.from({ length: 16 }, (_, i) => `cf${i}.example.com`).join('\n'));
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
 await restorePreviousOriginals(page);
 await expect(page.locator('#saveButton')).toBeEnabled();
 await expect(page.locator('#nodeCount')).toHaveText('105');
 await expect(page.locator('#duplicateCount')).toHaveText('0');
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


test('history retention settings apply independently and survive reload', async ({ page }) => {
 await page.goto('/settings');
 await expect(page.locator('#originalHistoryLimit')).toHaveValue('3');
 await page.locator('#pageTitle').fill('Unsaved display change');
 await page.locator('#originalHistoryLimit').fill('2');
 await page.locator('#historyForm button[type="submit"]').click();
 await expect(page.locator('#historyMessage')).toHaveText('已保存');
 await page.reload();
 await expect(page.locator('#originalHistoryLimit')).toHaveValue('2');
 await expect(page.locator('#pageTitle')).not.toHaveValue('Unsaved display change');
 await page.goto('/');
 await setOriginals(page, first);
 await setOriginals(page, second);
 await setOriginals(page, first + '\n' + second);
 await page.locator('[onclick="openOriginalHistory()"]').click();
 await expect(page.locator('#originalHistorySelect option')).toHaveCount(2);
 await expect(page.locator('#originalHistoryHelp')).toContainText('最近 2 个');
 await page.locator('#closeOriginalHistory').click();
 await page.goto('/settings');
 await page.locator('#originalHistoryLimit').fill('3');
 await page.locator('#historyForm button[type="submit"]').click();
 await expect(page.locator('#historyMessage')).toHaveText('已保存');
 await page.goto('/');
});


test('navigation only warns for unsaved configuration or changed open dialogs', async ({ page }) => {
 const shouldWarn = () => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event); return event.defaultPrevented;
 });
 const prompts = [];
 page.on('dialog', async dialog => { prompts.push(dialog.type()); await dialog.accept(); });
 // Legacy plain-text records may contain blank lines and CRLF; rendering trims them.
 await page.evaluate(async text => {
  await fetch('/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text });
 }, '  ' + first + '\r\n\r\n' + second + '\r\n');
 await page.reload();
 expect(await shouldWarn()).toBe(false);
 await page.locator('#originalSearch').fill('Main');
 await page.getByRole('link', { name: '分享管理', exact: true }).click();
 await expect(page).toHaveURL(/\/shares$/);
 expect(prompts).toEqual([]);
 await page.goto('/');
 await page.locator('[data-edit-original]').first().click();
 expect(await shouldWarn()).toBe(false);
 await page.locator('#originalValue').fill(first.replace('uuid@', 'unsaved@'));
 expect(await shouldWarn()).toBe(true);
 await page.locator('#originalValue').fill(first);
 expect(await shouldWarn()).toBe(false);
 await page.locator('#cancelOriginal').click();
 await addEndpoints(page, 'saved.example.com');
 expect(await shouldWarn()).toBe(true);
 await save(page);
 expect(await shouldWarn()).toBe(false);
 await page.reload();
 expect(await shouldWarn()).toBe(false);
 // Old drafts with different JSON field order and redundant raw text are equivalent.
 await page.evaluate(() => {
  const config = JSON.parse(document.getElementById('page-data-home').textContent).mainConfig;
  const reorder = value => Object.fromEntries(Object.entries(value).reverse());
  const draftConfig = { endpoints: config.endpoints.map(reorder), originals: config.originals.map(reorder), version: 2 };
  localStorage.setItem('node2link:draft:' + location.host + location.pathname, JSON.stringify({ text: '\r\n', config: draftConfig }));
 });
 await page.reload();
 await expect(page.locator('#mainConfirmDialog')).not.toBeVisible();
 expect(await shouldWarn()).toBe(false);
 expect(await page.evaluate(() => localStorage.getItem('node2link:draft:' + location.host + location.pathname))).toBeNull();
 await page.locator('#addEndpoint').click();
 expect(await shouldWarn()).toBe(false);
 await page.locator('#targetSearch').fill('Main-HK');
 expect(await shouldWarn()).toBe(false);
 await page.locator('[data-address]').fill('temporary.example.com');
 expect(await shouldWarn()).toBe(true);
 await page.locator('[data-address]').fill('');
 expect(await shouldWarn()).toBe(false);
 await page.locator('#cancelEndpoint').click();
 await expect(page.locator('#mainConfirmDialog')).not.toBeVisible();
 await page.getByRole('link', { name: '分享管理', exact: true }).click();
 await expect(page).toHaveURL(/\/shares$/);
 expect(prompts).toEqual([]);
 await page.goto('/');
 await addEndpoints(page, 'unsaved.example.com');
 await page.getByRole('link', { name: '分享管理', exact: true }).click();
 await expect(page).toHaveURL(/\/shares$/);
 expect(prompts).toEqual(['beforeunload']);
});

async function dragCardBefore(page, source, target, touch) {
 await source.locator('..').scrollIntoViewIfNeeded();
 await source.scrollIntoViewIfNeeded();
 const from = await source.locator('[data-sort-handle]').boundingBox();
 const to = await target.boundingBox();
 const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
 const end = { x: to.x + 6, y: to.y + 6 };
 if (touch) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let step = 1; step <= 8; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
 } else {
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
 }
}

test('card sorting publishes grouped subscription order and keeps API nodes at the end', async ({ page, isMobile }) => {
 await seed(page); await addEndpoints(page); await save(page); await page.reload();
 const initialized = await page.evaluate(async () => { const response = await fetch('/api/generated-nodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'initialize' }) }); if (!response.ok) throw new Error(await response.text()); return response.json(); });
 const apiNodes = ['vless://api@api-first.example.com:443#API-First', 'vless://api@api-second.example.com:443#API-Second'];
 const imported = await page.request.post('/api/import', { headers: { 'X-API-Token': initialized.settings.token, 'Content-Type': 'text/plain' }, data: apiNodes.join('\n') });
 expect(imported.ok()).toBe(true);
 page.importedNodeIds = (await imported.json()).nodes.map(node => node.id);
 const apiTail = await page.evaluate(async () => (await (await fetch('/api/generated-nodes')).json()).nodes.map(node => node.content));
 const published = await subscription(page);
 const names = id => page.locator('#' + id + ' .subscription-card-heading strong');
 const outputNames = lines => lines.map(line => decodeURIComponent(line.slice(line.indexOf('#') + 1)));
 await expect(names('originalList')).toHaveText(['Main-HK', 'Main-HY2']);
 await expect(names('endpointList')).toHaveText(['优选 1', '优选 2']);
 await dragCardBefore(page, page.locator('#endpointList [data-display-id]').nth(1), page.locator('#endpointList [data-display-id]').first(), isMobile);
 await expect(names('endpointList')).toHaveText(['优选 2', '优选 1']);
 await expect(page.locator('#saveStatus')).toHaveText('优选顺序已修改，保存后生效');
 expect(await subscription(page)).toEqual(published);
 // Publishing original order must preserve the preferred-address draft without publishing it.
 await page.locator('#originalList [data-select-original]').first().check();
 await dragCardBefore(page, page.locator('#originalList [data-display-id]').nth(1), page.locator('#originalList [data-display-id]').first(), isMobile);
 await expect(names('originalList')).toHaveText(['Main-HY2', 'Main-HK']);
 await expect(page.locator('#originalList [data-select-original]').nth(1)).toBeChecked();
 await expect(names('endpointList')).toHaveText(['优选 2', '优选 1']);
 await expect(page.locator('#saveStatus')).toHaveText('优选配置有未保存更改');
 const originalOnly = await subscription(page);
 expect(outputNames(originalOnly.slice(0, 6))).toEqual(['Main-HY2', 'Main-HY2-优选 1', 'Main-HY2-优选 2', 'Main-HK', 'Main-HK-优选 1', 'Main-HK-优选 2']);
 expect(originalOnly.slice(6)).toEqual(apiTail);
 const expected = ['Main-HY2', 'Main-HY2-优选 2', 'Main-HY2-优选 1', 'Main-HK', 'Main-HK-优选 2', 'Main-HK-优选 1'];
 await page.locator('#previewKind').selectOption('all');
 await expect(names('mainPreview')).toHaveText(expected);
 await save(page);
 const reordered = await subscription(page);
 expect(outputNames(reordered.slice(0, 6))).toEqual(expected);
 expect(reordered.slice(6)).toEqual(apiTail);
 expect(reordered.slice(-2)).toEqual(apiNodes);
 await expect(page.locator('.subscription-card-port')).toHaveCount(0);
 const downloadEvent = page.waitForEvent('download'); await page.locator('#exportMain').click();
 const download = await downloadEvent;
 expect((await readFile(await download.path(), 'utf8')).trim().split('\n')).toEqual(reordered.slice(0, 6));
 // Ordering is in the server configuration, independent of browser preferences.
 await page.evaluate(() => localStorage.clear()); await page.reload();
 await expect(names('originalList')).toHaveText(['Main-HY2', 'Main-HK']);
 await expect(names('endpointList')).toHaveText(['优选 2', '优选 1']);
 await page.locator('#previewKind').selectOption('all');
 await expect(names('mainPreview')).toHaveText(expected);
 await page.screenshot({ path: test.info().outputPath('published-sort.png'), fullPage: true });
 await page.locator('#originalList [data-sort-handle]').first().focus(); await page.keyboard.press('ArrowDown');
 await expect(names('originalList')).toHaveText(['Main-HK', 'Main-HY2']);
 await expect(page.locator('#originalSaveStatus')).toHaveText('原始节点已保存');
 await setOriginals(page, 'vless://third@third.example.com:443#Main-New', 'append');
 const appended = ['Main-HK', 'Main-HK-优选 2', 'Main-HK-优选 1', 'Main-HY2', 'Main-HY2-优选 2', 'Main-HY2-优选 1', 'Main-New'];
 await expect(names('mainPreview')).toHaveText(appended);
 const final = await subscription(page);
 expect(outputNames(final.slice(0, 7))).toEqual(appended);
 expect(final.slice(7)).toEqual(apiTail);
});

test('failed sorting saves retain published order and allow retry', async ({ page, isMobile }) => {
 await seed(page); await addEndpoints(page); await save(page); await page.reload();
 const before = await subscription(page);
 const names = id => page.locator('#' + id + ' .subscription-card-heading strong');
 await page.route('**/*', route => {
  const action = route.request().headers()['x-node2link-action'];
  if (action === 'save-originals' || action === 'save-endpoints') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '模拟排序保存失败' }) });
  return route.fallback();
 });
 await dragCardBefore(page, page.locator('#originalList [data-display-id]').nth(1), page.locator('#originalList [data-display-id]').first(), isMobile);
 await expect(page.locator('#originalSaveStatus')).toContainText('模拟排序保存失败');
 await expect(names('originalList')).toHaveText(['Main-HK', 'Main-HY2']);
 expect(await subscription(page)).toEqual(before);
 await dragCardBefore(page, page.locator('#endpointList [data-display-id]').nth(1), page.locator('#endpointList [data-display-id]').first(), isMobile);
 await page.locator('#saveButton').click();
 await expect(page.locator('#saveStatus')).toContainText('模拟排序保存失败');
 await expect(names('endpointList')).toHaveText(['优选 2', '优选 1']);
 expect(await subscription(page)).toEqual(before);
 await page.unroute('**/*');
 await save(page);
 await dragCardBefore(page, page.locator('#originalList [data-display-id]').nth(1), page.locator('#originalList [data-display-id]').first(), isMobile);
 await expect(names('originalList')).toHaveText(['Main-HY2', 'Main-HK']);
 await page.reload();
 await expect(names('originalList')).toHaveText(['Main-HY2', 'Main-HK']);
 await expect(names('endpointList')).toHaveText(['优选 2', '优选 1']);
});
