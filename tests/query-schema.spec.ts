import { test, expect } from './fixtures';
import { chooseOption } from './select-control';

test('query tabs keep their execution schema and the breadcrumb follows it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.breadcrumb-path')).toContainText('users');
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  const picker = page.getByLabel('실행 스키마', { exact: true });
  await expect(picker).toHaveAttribute('data-value', '');
  await expect(page.locator('.breadcrumb-path')).toContainText('기본 스키마');
  await chooseOption(picker, 'public');
  await expect(page.locator('.breadcrumb-path .crumb-link').nth(1)).toHaveText('public');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByLabel('실행 스키마', { exact: true })).toHaveAttribute('data-value', 'public');
  await page.locator('.breadcrumb-path .crumb-link').nth(1).click();
  await expect(page.getByRole('tab', { name: 'public' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tree-schema.active')).toHaveText('public');
});

test('the execution schema picker only offers schemas shown in the sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tree-schema')).toHaveText(['public']);
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  const picker = page.getByLabel('실행 스키마', { exact: true });
  await picker.click();
  await expect(page.getByRole('option')).toHaveText(['기본 스키마', 'public']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '스키마 선택', exact: true }).click();
  await page.getByRole('button', { name: '전체 해제', exact: true }).click();
  await page.keyboard.press('Escape');
  await picker.click();
  await expect(page.getByRole('option')).toHaveText(['기본 스키마']);
});
