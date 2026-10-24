import { test, expect } from './fixtures';
import { chooseOption } from './select-control';

test('API request and environment controls follow the shared action styles', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API', exact: true }).click();
  await expect(page.locator('#api-sidebar').getByRole('heading', { name: 'API', exact: true })).toBeVisible();
  await page.locator('.workspace-empty').getByRole('button', { name: '새 요청', exact: true }).click();
  await chooseOption(page.getByRole('combobox', { name: 'HTTP 메서드' }), 'POST');
  await expect(page.getByRole('combobox', { name: 'HTTP 메서드' })).toContainText('POST');
  await expect(page.getByRole('button', { name: /^저장/ })).toHaveAttribute('data-variant', 'default');
  await page.getByRole('button', { name: '환경 변수 관리' }).click();
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('api-env-empty-copy.png') });
  await page.getByRole('button', { name: '변수 사용법·파일 형식', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('api-env-help-copy.png') });
  await page.getByRole('heading', { name: '환경 변수', exact: true }).hover();
  await page.getByRole('button', { name: '환경 추가' }).click();
  await expect(page.getByRole('button', { name: '환경 삭제' })).toHaveAttribute('data-variant', 'destructive');
  await page.screenshot({ path: testInfo.outputPath('api-environments.png') });
  await page.getByRole('button', { name: '환경 삭제' }).click();
  await expect(page.getByLabel('환경 이름')).toHaveCount(0);
});

test('API pair headers cycle sorting without changing edit targets or the blank last row', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: 'API', exact: true }).click();
 await page.locator('.workspace-empty').getByRole('button', { name: '새 요청', exact: true }).click();
 const table = page.locator('.api-pairs').first();
 const keys = table.getByRole('textbox', { name: '키', exact: true });
 await keys.last().fill('zebra'); await keys.last().fill('alpha'); await keys.last().fill('middle');
 const header = table.getByRole('columnheader', { name: '키', exact: true });
 await header.click(); await expect(header).toHaveAttribute('aria-sort','ascending');
 await expect.poll(() => keys.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(['alpha','middle','zebra','']);
 await table.getByRole('textbox', {name:'값',exact:true}).first().fill('alpha-value');
 await header.press('Enter'); await expect(header).toHaveAttribute('aria-sort','descending');
 await expect.poll(() => keys.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(['zebra','middle','alpha','']);
 await header.press('Space'); await expect(header).toHaveAttribute('aria-sort','none');
 await expect.poll(() => keys.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(['zebra','alpha','middle','']);
 await expect(table.getByRole('textbox', {name:'값',exact:true}).nth(1)).toHaveValue('alpha-value');
});
