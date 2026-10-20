import { test, expect } from '@playwright/test';

test('database and schema expanders actually collapse their children', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tree-table')).toBeVisible();
  await page.locator('.schema-expander').click();
  await expect(page.locator('.tree-table')).not.toBeVisible();
  await page.locator('.schema-expander').click();
  await expect(page.locator('.tree-table')).toBeVisible();
  await page.locator('.tree-db').click();
  await expect(page.locator('.tree-schema')).not.toBeVisible();
  await page.locator('.tree-db').click();
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
  await expect(page.getByText('쿼리 결과 · 읽기 전용')).toBeVisible();
  await page.getByLabel('테이블 새로고침').click();
  await expect(page.locator('.run-button')).toBeEnabled();
  await expect(page.getByText('쿼리 결과 · 읽기 전용')).toBeVisible();
});

test('query shortcut does not execute behind a connection dialog', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByLabel('새 연결').click();
  await page.getByLabel('호스트').press('Control+Enter');
  await expect(page.locator('.run-button')).toBeEnabled();
  await expect(page.getByText('쿼리 결과 · 읽기 전용')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.connection-modal')).not.toBeVisible();
});
