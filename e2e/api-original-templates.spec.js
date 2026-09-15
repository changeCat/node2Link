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
  const response = await fetch('/api/generated-nodes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'browser-original-template-token', templates: [], nameTemplate: '{{name}}-{{address}}:{{port}}' }) });
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

test('template cards, duplicate prevention, optional ports and automatic original updates', async ({ page }) => {
 await page.goto('/api-subscriptions');
 await expect(page.locator('#templatePickerDialog')).not.toBeVisible();
 await expect(page.locator('.api-template-card')).toHaveCount(0);
 await expect(page.locator('#nodeTemplate')).toHaveCount(0);
 await expect(page.locator('#legacyTemplateSection')).toHaveCount(0);
 await page.locator('#addTemplate').click();
 await expect(page.locator('[data-template-id]')).toHaveCount(2);
 await expect(page.locator('#templateOriginalList')).not.toContainText('Preferred');
 await page.locator('#templateSearch').fill('Original-B');
 await page.locator('#selectTemplateResults').click();
 await page.locator('[data-pending-port="two"]').fill('2053');
 await page.locator('#templateSearch').fill('');
 await page.locator('[data-template-id="one"]').check();
 await page.screenshot({ path: test.info().outputPath('add-api-templates.png'), fullPage: true });
 await page.locator('#confirmAddTemplates').click();
 await expect(page.locator('#templatePickerDialog')).not.toBeVisible();
 await expect(page.locator('.api-template-card')).toHaveCount(2);
 await expect(page.locator('[data-template-port="two"]')).toHaveValue('2053');
 await expect(page.locator('[data-template-port="one"]')).toHaveValue('');
 await page.locator('#addTemplate').click();
 await expect(page.locator('[data-template-id="one"]')).toBeDisabled();
 await expect(page.locator('[data-template-id="two"]')).toBeDisabled();
 await expect(page.locator('#confirmAddTemplates')).toBeDisabled();
 await page.locator('#cancelTemplatePicker').click();
 await page.locator('[data-preview-template="one"]').click();
 await expect(page.locator('#templatePreview')).toHaveValue(/edge\.example\.com:8443.*sni=origin\.example\.com/);
 await page.locator('#closeTemplatePreview').click();
 await page.locator('[data-preview-template="two"]').click();
 await expect(page.locator('#templatePreview')).toHaveValue(/edge\.example\.com:2053/);
 await page.locator('#closeTemplatePreview').click();
 await page.route('**/api/generated-nodes', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { message: '保存失败测试' } }) : route.continue());
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toHaveText('保存失败测试');
 await expect(page.locator('.api-template-card')).toHaveCount(2);
 await expect(page.locator('[data-template-port="two"]')).toHaveValue('2053');
 await page.unroute('**/api/generated-nodes');
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toHaveText('配置已保存');
 await page.reload();
 await expect(page.locator('.api-template-card')).toHaveCount(2);
 await expect(page.locator('[data-template-port="two"]')).toHaveValue('2053');
 const token = await page.locator('#apiToken').inputValue();
 async function importAddress(address, port) {
  const response = await page.request.get('/api/import', { params: { token, address, ...(port ? { port } : {}) } });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  page.importedNodeIds.push(...result.nodes.map(node => node.id));
  return result;
 }
 const initial = await importAddress('auto-template.example.com');
 expect(initial.nodes.map(node => node.port)).toEqual([2053, 8443]);
 const supplied = await importAddress('port-template.example.com', '443');
 expect(supplied.nodes.map(node => node.port)).toEqual([2053, 443]);
 // Change the original without saving or refreshing any API configuration.
 const edited = { ...config, originals: [{ id: 'one', content: first.replace('secret@', 'new-secret@').replace('#Original-A', '#Updated-A') }, config.originals[1]] };
 await saveConfig(page, edited);
 const updated = await importAddress('updated-template.example.com', '443');
 expect(updated.nodes[1].name).toBe('Updated-A-updated-template.example.com:443');
 await page.reload();
 await expect(page.locator('[data-saved-template="one"]')).toContainText('Updated-A');
 await expect(page.locator('.node-card').filter({ hasText: 'updated-template.example.com' })).toHaveCount(2);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 if (test.info().project.name === 'desktop') {
  const left = await page.locator('#settingsForm').boundingBox(), right = await page.locator('.nodes-panel').boundingBox();
  expect(left.width / right.width).toBeCloseTo(2, 1);
 }
 await page.screenshot({ path: test.info().outputPath('api-template-cards.png'), fullPage: true });
 // A removed original is marked invalid and can be removed from the template list.
 await saveConfig(page, { version: 2, originals: [{ id: 'one', content: first }], endpoints: [] });
 await page.reload();
 await expect(page.locator('[data-saved-template="two"]')).toContainText('原始节点已删除');
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toContainText('已不存在');
 await page.locator('[data-remove-template="two"]').click();
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toHaveText('配置已保存');
 await page.locator('[data-remove-template="one"]').click();
 await page.locator('#saveSettings').click();
 await expect(page.locator('#settingsMessage')).toHaveText('配置已保存');
 await page.reload();
 await expect(page.locator('.api-template-card')).toHaveCount(0);
});
