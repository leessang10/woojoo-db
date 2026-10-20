import { test, expect } from '@playwright/test';

test('settings apply immediately and persist without replacing the current query', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  const sql = await page.locator('.cm-content').innerText();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정', exact: true });
  await dialog.getByLabel('테마', { exact: true }).selectOption('light');
  await dialog.getByLabel('사이드바 표시').uncheck();
  await dialog.getByLabel('언어', { exact: true }).selectOption('en');
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByLabel('Theme', { exact: true })).toHaveValue('light');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('tab', { name: 'users' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await expect(page.locator('.cm-content')).toHaveText(sql, { useInnerText: true });
  await page.reload();
  await page.keyboard.press('Control+,');
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel('Theme', { exact: true })).toHaveValue('light');
  await expect(settings.getByLabel('Language', { exact: true })).toHaveValue('en');
  await expect(settings.getByLabel('Show sidebar')).not.toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
});
