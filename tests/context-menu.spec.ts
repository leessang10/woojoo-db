import { test, expect } from './fixtures';

test('cell menu copies, edits and reverts the selected cell, with read-only guards', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const cell = page.getByRole('cell', { name: 'Alex Morgan', exact: true });
  await cell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '셀 복사', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Alex Morgan');
  await cell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '셀 편집', exact: true }).click();
  await page.getByLabel('셀 값').fill('Context edit');
  await page.getByRole('button', { name: '변경 대기열에 추가' }).click();
  await page.getByRole('cell', { name: 'Context edit', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '셀 변경 취소' }).click();
  await expect(cell).toBeVisible();
  await page.getByRole('cell', { name: '1001', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '셀 편집' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).not.toBeVisible();
});

test('tab and editor menus support keyboard navigation and preserve original tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'users', exact: true }).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '새 쿼리' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: '쿼리 1' })).toHaveAttribute('aria-selected', 'true');

  await page.locator('.cm-content').fill('SELECT 1;');
  await page.getByRole('tab', { name: '쿼리 1' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '탭 닫기', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '버리고 닫기', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.locator('.cm-content').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '전체 SQL 복사' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('columnheader', { name: /name/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '내림차순 정렬' }).click();
  await expect(page.locator('.data-grid tbody tr').first()).toContainText('Sofia Chen');
});

test('context menu stays inside the viewport and dismisses outside', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 700 });
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.locator('.result-footer').click({ button: 'right', position: { x: 650, y: 15 } });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(960);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await page.locator('.sidebar .section-label').first().click({ position: { x: 4, y: 4 } });
  await expect(menu).not.toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.result-footer').click({ button: 'right' });
  await expect(menu).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
});
