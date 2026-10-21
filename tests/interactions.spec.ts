import { test, expect } from './fixtures';

test('schema expanders collapse their children without a redundant connection row', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tree-table')).toBeVisible();
  await page.locator('.schema-expander').click();
  await expect(page.locator('.tree-table')).not.toBeVisible();
  await page.locator('.schema-expander').click();
  await expect(page.locator('.tree-table')).toBeVisible();
  await expect(page.locator('.tree-db')).toHaveCount(0);
  await expect(page.locator('.tree-table')).toBeVisible();
});

test('demo SQL respects LIMIT including zero', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  const editor = page.locator('.cm-content');
  await editor.fill('SELECT * FROM users LIMIT 2;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await editor.fill('SELECT * FROM users LIMIT 0;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(0);
});

test('query refresh never silently replaces SQL results with table data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.locator('.run-button').click();
  await expect(page.getByText('쿼리 결과 · 편집 가능')).toBeVisible();
  await page.getByLabel('마지막 쿼리 다시 실행').click();
  await expect(page.locator('.run-button')).toBeEnabled();
  await expect(page.getByText('쿼리 결과 · 편집 가능')).toBeVisible();
});

test('query shortcut does not execute behind a connection dialog', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByLabel('새 연결').click();
  await page.getByLabel('호스트').press('Control+Enter');
  await expect(page.locator('.run-button')).toBeEnabled();
  await expect(page.getByText('쿼리 결과 · 편집 가능')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.connection-modal')).not.toBeVisible();
});
