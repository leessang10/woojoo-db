import { test, expect } from './fixtures';

test('confirmation traps focus, cancels on Escape, and preserves dirty SQL', async ({ page }) => {
  page.on('dialog', () => { throw new Error('Unexpected native dialog'); });
  await page.goto('/');
  await page.getByRole('button', {name:'새 쿼리',exact:true}).click();
  await page.locator('.cm-content').fill('SELECT 42;');
  const close = page.getByRole('button', {name:'탭 닫기: 쿼리 1',exact:true});
  await close.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', {name:'취소',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', {name:'버리고 닫기',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(close).toBeFocused();
  await expect(page.locator('.cm-content')).toHaveText('SELECT 42;');
  await close.click();
  await page.screenshot({path:'test-results/confirmation-dark.png'});
  await page.evaluate(() => document.documentElement.dataset.theme='light');
  await page.waitForTimeout(300);
  await page.screenshot({path:'test-results/confirmation-light.png'});
  await dialog.getByRole('button', {name:'버리고 닫기',exact:true}).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('opening history in a new tab never replaces the current SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true');
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 1;');
  await page.locator('.query-tools').getByRole('button', {name:'스크립트 실행',exact:true}).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(1);
  await page.locator('.cm-content').fill('SELECT 42;');
  await page.locator('.topbar').getByRole('button',{name:'쿼리 기록',exact:true}).click();
  const history = page.getByRole('region', {name:'쿼리 기록',exact:true});
  await history.locator('.history-open').first().click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 1;');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.locator('.tab-list [role=tab]').first().click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT 42;');
});
