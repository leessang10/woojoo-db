import { test, expect } from './fixtures';
import { chooseOption } from './select-control';

test('calendar filters use accessible popovers and can select and clear a date', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      transformCallback: () => 1,
      invoke: async (command: string) => {
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'execution_connections') return [];
        if (command === 'execution_list') return { entries: [], total: 0 };
        throw new Error(command);
      },
    } });
  });
  await page.goto('/');
  await page.locator('.rail').getByRole('button', { name: '쿼리 기록', exact: true }).click();
  const start = page.getByRole('button', { name: '시작일', exact: true });
  await start.click();
  await expect(page.locator('.ui-calendar')).toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(start).toHaveText(/\d{4}-\d{2}-\d{2}/);
  await expect(page.locator('.ui-calendar')).not.toBeVisible();
  await start.click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(start).toHaveText('YYYY-MM-DD');
  await page.getByRole('button', { name: '종료일', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '종료일', exact: true })).toBeFocused();
  await chooseOption(page.getByRole('combobox', { name: '실행 상태', exact: true }), 'failed');
  await chooseOption(page.getByRole('combobox', { name: '실행 상태', exact: true }), '');
  await expect(page.getByRole('combobox', { name: '실행 상태', exact: true })).toHaveAttribute('data-value', '');
});
