import { chooseOption } from './select-control';
import { test, expect } from './fixtures';

test('settings apply immediately and persist without replacing the current query', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  const sql = await page.locator('.cm-content').innerText();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정', exact: true });
  await chooseOption(dialog.getByLabel('테마', { exact: true }), 'light');
  await dialog.getByLabel('사이드바 표시').uncheck();
  await chooseOption(dialog.getByLabel('언어 / Language', { exact: true }), 'en');
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByLabel('Theme', { exact: true })).toHaveAttribute('data-value', 'light');
  await page.keyboard.press('Control+Enter');
  // Radix hides the background from assistive technology while the modal is open.
  await expect(page.locator('.tab-list [role=tab]')).toHaveText('users');
  await page.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await expect(page.locator('.cm-content')).toHaveText(sql, { useInnerText: true });
  await page.reload();
  await page.keyboard.press('Control+,');
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel('Theme', { exact: true })).toHaveAttribute('data-value', 'light');
  await expect(settings.getByLabel('언어 / Language', { exact: true })).toHaveAttribute('data-value', 'en');
  await expect(settings.getByLabel('Show sidebar')).not.toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
});

test('system theme follows the OS and database and editor settings apply', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: '설정', exact: true });
  await chooseOption(dialog.getByLabel('테마', { exact: true }), 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await chooseOption(dialog.getByLabel('결과 최대 행 수'), '1000');
  await chooseOption(dialog.getByLabel('편집기 글꼴 크기'), '16');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: '이 테이블로 새 쿼리' }).click();
  await expect(page.locator('.cm-content')).toContainText('LIMIT 1000');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Control+,');
  await expect(dialog.getByLabel('결과 최대 행 수')).toHaveAttribute('data-value', '1000');
});
