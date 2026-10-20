import { test, expect } from './fixtures';

test('common SQL searches PostgreSQL templates and opens a new tab without execution or overwriting SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT 987654321;');
  const originalTab = await page.getByRole('tab', { selected: true }).getAttribute('id');
  const count = await page.getByRole('tab').count();
  await page.getByRole('button', { name: '자주 쓰는 SQL', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '자주 쓰는 SQL', exact: true });
  await expect(dialog).toContainText('PostgreSQL');
  await dialog.getByLabel('SQL 템플릿 검색').fill('없는템플릿');
  await expect(dialog.getByRole('status')).toHaveText('일치하는 SQL이 없습니다.');
  await dialog.getByLabel('SQL 템플릿 검색').fill('타임존');
  await dialog.getByRole('button', { name: /현재 타임존과 시간/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(count + 1);
  await expect(page.locator('.cm-content')).toContainText("current_setting('TimeZone')");
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(0);
  await page.locator(`[id="${originalTab}"]`).click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT 987654321;');
});

for (const engine of ['MySQL', 'MariaDB', 'SQLite']) {
  test(`${engine} connection shows only matching templates`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'isTauri', { value: true });
      Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke: async (command: string) => {
        if (command === 'connect_db') return 'template-test';
        if (command === 'list_tables') return [];
        throw new Error(command);
      } } });
    });
    await page.goto('/');
    await page.getByLabel('새 연결', { exact: true }).click();
    await page.getByRole('button', { name: engine, exact: true }).click();
    if (engine === 'SQLite') await page.getByRole('textbox', { name: '데이터베이스', exact: true }).fill('templates.db');
    await page.getByRole('button', { name: '연결하기', exact: true }).click();
    await page.getByRole('button', { name: '자주 쓰는 SQL', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '자주 쓰는 SQL', exact: true });
    await expect(dialog.locator('h2')).toContainText(engine);
    if (engine === 'SQLite') {
      await expect(dialog.getByRole('button', { name: /현재 실행 중인 쿼리/ })).toHaveCount(0);
      await dialog.getByRole('button', { name: /현재 연결 정보/ }).click();
      await expect(page.locator('.cm-content')).toContainText('PRAGMA database_list;');
    } else {
      await dialog.getByRole('button', { name: /현재 실행 중인 쿼리/ }).click();
      await expect(page.locator('.cm-content')).toContainText(engine === 'MySQL' ? 'performance_schema.processlist' : 'information_schema.PROCESSLIST');
    }
  });
}
