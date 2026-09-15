import { expect } from '@playwright/test';
export async function setOriginals(page, content, mode = 'replace') {
 if (!content && mode === 'replace') {
  await page.locator('#originalSearch').fill('');
  if (!await page.locator('#selectOriginals').isEnabled()) return;
  if (await page.locator('#selectOriginals').getAttribute('aria-pressed') !== 'true') await page.locator('#selectOriginals').click();
  await page.locator('#deleteOriginals').click();
  await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.locator('#nodeCount')).toHaveText('0');
  await expect(page.locator('#originalSaveStatus')).toHaveText('原始节点已保存');
  return;
 }
 await page.locator('#addOriginals').click();
 await page.locator('#batchValue').fill(content);
 await page.locator(`#batchForm button[value="${mode}"]`).click();
 if (mode === 'replace') await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
 await expect(page.locator('#batchDialog')).not.toBeVisible();
 await expect(page.locator('#originalSaveStatus')).toHaveText('原始节点已保存');
}
