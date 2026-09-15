import { test, expect } from '@playwright/test';
const first = 'vless://secret@origin.example.com:443?security=tls&sni=origin.example.com&host=origin.example.com&path=%2Fws#Original-A';
const second = 'hysteria2://password@other.example.com:443?sni=other.example.com#Original-B';
const config = { version: 2, originals: [{ id: 'one', content: first }, { id: 'two', content: second }], endpoints: [{ id: 'edge', address: 'preferred.example.com', port: 443, enabled: true, label: 'Preferred', originalIds: ['one'] }] };
async function saveConfig(page, value) {
 const status = await page.evaluate(async body => (await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Node2Link-Action': 'save-config' }, body: JSON.stringify(body) })).status, value);
 expect(status).toBe(200);
}
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
 await saveConfig(page, config);
 await page.evaluate(async () => {
  const response = await fetch('/api/generated-nodes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'browser-original-template-token', nodeTemplate: '', nameTemplate: '{{name}}-{{address}}:{{port}}' }) });
  if (!response.ok) throw new Error('Unable to reset API settings');
 });
});
test.afterEach(async ({ page }) => {
 await page.evaluate(async ids => {
  for (const id of ids) {
   const response = await fetch('/api/generated-nodes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
   if (!response.ok) throw new Error('Unable to remove imported test node');
  }
 }, page.importedNodeIds);
 expect(page.runtimeErrors).toEqual([]);
});

test('originals are flat, extensions grouped and API nodes isolated in the share picker', async ({ page }) => {
 const imported = await page.request.post('/api/import', { headers: { 'X-API-Token': 'browser-original-template-token', 'Content-Type': 'text/plain' }, data: 'vless://api@independent.example.com:443#Independent-API' });
 expect(imported.ok()).toBe(true);
 page.importedNodeIds = (await imported.json()).nodes.map(node => node.id);
 await page.goto('/shares');
 await page.locator('#openNodePicker').click();
 await expect(page.locator('[data-picker-section="original"] .picker-node')).toHaveCount(2);
 await expect(page.locator('[data-picker-section="extension:one"] .picker-node')).toHaveCount(1);
 await expect(page.locator('[data-picker-section="api"]')).toContainText('Independent-API');
 await expect(page.locator('[data-picker-section="extension:one"]')).not.toContainText('Independent-API');
 await page.locator('[data-main-group]').click();
 await expect(page.locator('#selectedNodeCount')).toHaveText('已选择 1 个');
 await expect(page.locator('[data-picker-section="original"] input:checked')).toHaveCount(0);
 await expect(page.locator('[data-picker-section="api"] input:checked')).toHaveCount(0);
 await page.locator('#nodeSource').selectOption('main-original');
 await expect(page.locator('.picker-node')).toHaveCount(2);
 await expect(page.locator('.picker-main-group')).toHaveCount(0);
 await expect(page.locator('[data-main-group]')).toHaveCount(0);
 await page.locator('#nodeSource').selectOption('all');
 await page.screenshot({ path: test.info().outputPath('share-picker-groups.png'), fullPage: true });
});

test('select multiple original templates, preview, save, reload, import and retain input on failure', async ({ page }) => {
 await page.goto('/api-subscriptions');
 await expect(page.locator('[data-template-id]')).toHaveCount(2);
 await expect(page.locator('#templateOriginalList')).not.toContainText('Preferred');
 await page.locator('#templateSearch').fill('Original-B');
 await page.locator('#selectTemplateResults').click();
 await expect(page.locator('#templateCount')).toHaveText('已选 1 / 20');
 await page.locator('#templateSearch').fill('');
 await page.locator('[data-template-id="one"]').check();
 await page.locator('#nameTemplate').fill('{{name}}-{{address}}:{{port}}');
 await expect(page.locator('#templatePreview .example-box')).toHaveCount(2);
 await expect(page.locator('#templatePreview')).toContainText('sni=origin.example.com');
 await expect(page.locator('#templatePreview')).toContainText('edge.example.com:443');
 await page.route('**/api/generated-nodes', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { message: '保存失败测试' } }) : route.continue());
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toHaveText('保存失败测试');
 await expect(page.locator('[data-template-id]:checked')).toHaveCount(2);
 await page.unroute('**/api/generated-nodes');
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toHaveText('配置已保存');
 await page.reload();
 await expect(page.locator('[data-template-id]:checked')).toHaveCount(2);
 await expect(page.locator('#legacyTemplateSection')).toBeHidden();
 const token = await page.locator('#apiToken').inputValue();
 const imported = await page.request.get('/api/import', { params: { token, address: 'auto-template.example.com', port: '8443' } });
 expect(imported.ok()).toBe(true);
 const result = await imported.json();
 page.importedNodeIds = result.nodes.map(node => node.id);
 expect(result.added + result.duplicates).toBe(2);
 await page.reload();
 await expect(page.locator('.node-card').filter({ hasText: 'auto-template.example.com' })).toHaveCount(2);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: test.info().outputPath('api-original-templates.png'), fullPage: true });
 // Removing a saved original is visible, and cannot silently replace a saved API template.
 await saveConfig(page, { version: 2, originals: [{ id: 'one', content: first }], endpoints: [] });
 await page.locator('#reloadTemplateOriginals').click();
 await expect(page.locator('#templateOriginalList')).toContainText('原始节点已删除');
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toContainText('已不存在');
 await expect(page.locator('[data-template-id="two"]')).toBeChecked();
 await page.locator('[data-template-id="two"]').click();
 await expect(page.locator('[data-template-id="two"]')).toHaveCount(0);
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toHaveText('配置已保存');
});