export async function setOriginals(page, content, mode = 'replace') {
 if (!content && mode === 'replace') {
  await page.locator('#originalSearch').fill('');
  if (!await page.locator('#selectOriginals').isEnabled()) return;
  await page.locator('#selectOriginals').click();
  await page.locator('#deleteOriginals').click();
  await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
  return;
 }
 await page.locator('#addOriginals').click();
 await page.locator('#batchValue').fill(content);
 await page.locator(`#batchForm button[value="${mode}"]`).click();
 if (mode === 'replace') await page.locator('#mainConfirmDialog').getByRole('button', { name: '确认', exact: true }).click();
}
