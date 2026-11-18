import { test, expect } from './fixtures';

test('query tabs keep their execution schema and the breadcrumb follows it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.breadcrumb-path')).toContainText('users');
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  const picker = page.getByLabel('실행 스키마', { exact: true });
  await expect(picker).toHaveAttribute('data-value', '');
  await expect(page.locator('.breadcrumb-path')).toContainText('기본 스키마');
  await picker.click();
  await page.locator('.workspace-picker [data-workspace-option]').filter({hasText:'public'}).click();
  await expect(picker).toContainText('public');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByLabel('실행 스키마', { exact: true })).toHaveAttribute('data-value', 'public');
  await page.getByRole('button',{name:'테이블 선택',exact:true}).click();
  await page.locator('.workspace-picker [data-workspace-option]').filter({hasText:'users'}).click();
  await expect(page.getByRole('tab', { name: 'users',exact:true })).toHaveAttribute('aria-selected', 'true');
});

test('the execution schema picker only offers schemas shown in the sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tree-schema')).toHaveText(['public']);
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  const picker = page.getByLabel('실행 스키마', { exact: true });
  await picker.click();
  await expect(page.locator('.workspace-picker [data-workspace-option]')).toHaveText(['기본 스키마', 'public']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '스키마 선택', exact: true }).click();
  await page.getByRole('button', { name: '전체 해제', exact: true }).click();
  await page.keyboard.press('Escape');
  await picker.click();
  await expect(page.locator('.workspace-picker [data-workspace-option]')).toHaveText(['기본 스키마']);
});
