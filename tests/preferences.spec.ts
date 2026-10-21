import { chooseOption } from './select-control';
import { test, expect } from './fixtures';

test('sidebar can be collapsed, restored by keyboard, and remembers its state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: '사이드바 접기', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '사이드바 펼치기', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await page.keyboard.press('Control+b');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('English covers workspace, dialogs, errors and persists without changing SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  const sql = await page.locator('.cm-content').innerText();
  await chooseOption(page.getByLabel('언어 / Language'), 'en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText(sql, { useInnerText: true });
  await page.getByRole('button', { name: 'New connection', exact: true }).click();
  await expect(page.getByLabel('Host', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toBeDisabled();
  await expect(page.locator('.connection-availability')).toContainText('desktop');
  await page.keyboard.press('Escape');
  await page.getByText('Alex Morgan', { exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Edit cell' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.locator('.help-content')).not.toContainText(/[가-힣]/);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByLabel('언어 / Language')).toHaveAttribute('data-value', 'en');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await chooseOption(page.getByLabel('언어 / Language'), 'ko');
  await expect(page.getByRole('button', { name: '실행', exact: true })).toBeVisible();
});

test('connection dialog keeps keyboard focus inside until closed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('새 연결').click();
  const modal = page.locator('.connection-modal');
  await modal.locator('button:enabled').last().focus();
  await page.keyboard.press('Tab');
  await expect(modal.getByRole('button', { name: '닫기', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(modal.locator('button:enabled').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('새 연결')).toBeFocused();
});

test('result search matches staged cell values', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Alex Morgan', { exact: true }).dblclick();
  await page.getByLabel('셀 값').fill('Staged Name');
  await page.getByRole('button', { name: '변경 대기열에 추가' }).click();
  await page.getByLabel('결과 필터').fill('Staged Name');
  await expect(page.getByText('Staged Name', { exact: true })).toBeVisible();
});
