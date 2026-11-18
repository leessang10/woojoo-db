import { test, expect } from './fixtures';

test('breadcrumb choices follow the connection and schema and work with a collapsed sidebar', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke: async (command: string, args: any) => {
      if (command === 'credential_status') return { supported: false, saved: false, available: false };
      if (command === 'connect_db') return 'multi-schema';
      if (command === 'list_schemas') return ['app', 'analytics', 'empty'];
      if (command === 'list_tables') return [{ schema: 'app', name: 'users' }, { schema: 'analytics', name: 'events' }];
      if (command === 'schema_info') return { info: { name: args.schema }, tables: [] };
      if (command === 'read_table') {
        const result = { columns: [], rows: [], elapsedMs: 0, affected: 0, truncated: false };
        if ((window as any).holdRead) return new Promise(resolve => { (window as any).finishRead = () => resolve(result); });
        return result;
      }
      if (command === 'execution_state') return { manual: false, inTransaction: false, running: false, readOnly: false, transactionStateKnown: true };
      if (command.startsWith('plugin:event|')) return 1;
      throw new Error(command);
    } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '연결 전환', exact: true }).click();
  await page.getByRole('button', { name: '연결 추가', exact: true }).click();
  await page.getByRole('button', { name: '연결하기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '사이드바 접기', exact: true }).click();
  await expect(page.locator('#database-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: '스키마 목록', exact: true }).click();
  const options = page.locator('.workspace-picker [data-workspace-option]');
  await expect(options).toHaveText(['analytics', 'app', 'empty']);
  await options.filter({ hasText: /^analytics$/ }).click();
  await page.getByRole('button', { name: '테이블 선택', exact: true }).click();
  await expect(options).toHaveText(['events']);
  await page.evaluate(() => { (window as any).holdRead = true; });
  await options.click();
  await expect(page.getByRole('tab', { name: 'events', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^중지/ })).toBeVisible();
  await page.evaluate(() => { (window as any).holdRead = false; (window as any).finishRead(); });
  await expect(page.getByRole('button', { name: /^중지/ })).toHaveCount(0);
  await page.getByRole('button', { name: '스키마 목록', exact: true }).click();
  await options.filter({ hasText: /^empty$/ }).click();
  await page.getByRole('button', { name: '테이블 선택', exact: true }).click();
  await expect(page.locator('.workspace-picker')).toContainText('항목이 없습니다.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '연결 전환', exact: true }).click();
  await expect(page.locator('[data-connection-option] .live-dot')).toHaveCount(2);
  await page.locator('[data-connection-option]').filter({ hasText: 'Woojoo playground' }).click();
  await page.getByRole('button', { name: '스키마 목록', exact: true }).click();
  await expect(options).toHaveText(['public']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '사이드바 펼치기', exact: true }).click();
  await expect(page.locator('#database-sidebar')).toBeVisible();
  await page.screenshot({ path: 'test-results/breadcrumb-workspace.png' });
});
