// Attach only to a test-launched WebView2 with a disposable user-data folder.
import { chromium, expect } from '@playwright/test';

/** Language lives in Settings; open it, pick the language and close it again. */
async function chooseLanguage(page, value) {
  await page.keyboard.press('Control+,');
  const trigger = page.getByLabel('언어 / Language');
  await trigger.click();
  await page.getByRole('option').and(page.locator(`[data-value="${value}"]`)).click();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
try {
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!window.__TAURI_INTERNALS__)).toBe(true);
  await chooseLanguage(page, 'ko');
  await page.getByRole('button', { name: '사이드바 접기', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '사이드바 펼치기', exact: true })).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.sidebar')).toBeVisible();
  await chooseLanguage(page, 'en');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'New connection', exact: true }).click();
  await expect(page.getByLabel('Host', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.connection-modal')).toHaveCount(0);
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2;');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/native-ui-light.png' });
  expect(errors).toEqual([]);
  console.log('Packaged Windows app: sidebar, shortcut, persisted preferences, English dialog, theme and SQL passed.');
} finally {
  await browser.close();
}
