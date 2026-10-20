import { test, expect } from './fixtures';

test('theme switches the workspace and editor, preserves edits, and survives reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByText('Alex Morgan', { exact: true }).dblclick();
  await page.getByLabel('셀 값').fill('Theme test');
  await page.getByRole('button', { name: '변경 대기열에 추가' }).click();
  await page.getByRole('button', { name: '라이트 모드로 전환' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.main')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByText('Theme test', { exact: true })).toBeVisible();
  await page.locator('.result-toolbar').getByRole('button', { name: '취소', exact: true }).click();
  await page.getByLabel('새 연결').click();
  await expect(page.locator('.modal')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(22, 23, 25)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('switching still works if browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '라이트 모드로 전환' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.workspace-empty')).toBeVisible();
});
