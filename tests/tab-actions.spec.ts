import { test, expect } from './fixtures';

test('bulk close respects clicked tab order and confirms dirty tabs atomically', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.locator('.tab-add').click();
  const tabs = page.locator('.tab-list').getByRole('tab');
  await page.getByRole('tab', { name: '쿼리 2', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '오른쪽 탭 닫기', exact: true }).click();
  await expect(tabs).toHaveText(['users', '쿼리 1', '쿼리 2']);
  await expect(page.getByRole('tab', { name: '쿼리 2', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '왼쪽 탭 닫기', exact: true }).click();
  await expect(tabs).toHaveText(['쿼리 1', '쿼리 2']);
  await page.locator('.cm-content').fill('SELECT unsaved;');
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '다른 탭 닫기', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(tabs).toHaveText(['쿼리 1', '쿼리 2']);
  await expect(page.locator('.cm-content')).toHaveText('SELECT unsaved;');
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '다른 탭 닫기', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(tabs).toHaveText(['쿼리 1']);
  await tabs.first().click({ button: 'right' });
  for (const name of ['다른 탭 닫기', '왼쪽 탭 닫기', '오른쪽 탭 닫기']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeDisabled();
  }
  await page.getByRole('menuitem', { name: '모든 탭 닫기', exact: true }).click();
  await expect(tabs).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('woojoo-workspace-v1') ?? '{}').tabs?.length)).toBe(0);
  await page.reload();
  await expect(tabs).toHaveCount(0);
});

test('narrow tab strip and SQL tools scroll without scrollbars and templates live with SQL tools', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  for (let i = 0; i < 9; i++) await page.locator('.tab-add').click();
  for (const selector of ['.tab-list', '.query-toolbar-scroll']) {
    const strip = page.locator(selector);
    await expect(strip).toHaveCSS('scrollbar-width', 'none');
    await strip.evaluate(element => { element.scrollLeft = 0; });
    await strip.hover();
    await page.mouse.wheel(0, 240);
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
  await expect(page.locator('.tabs').getByRole('button', { name: '자주 쓰는 SQL', exact: true })).toHaveCount(0);
  await page.locator('.query-toolbar').getByRole('button', { name: '자주 쓰는 SQL', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
