import { test, expect } from './fixtures';

const view = (page: import('@playwright/test').Page, name: string) => page.locator('.object-view-bar').getByRole('button', { name, exact: true });

test('structure selection survives an in-flight table read and loads its columns', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke: async (command: string) => {
      if (command === 'connect_db') return 'delayed-table';
      if (command === 'list_tables') return [{ schema: 'public', name: 'notes' }];
      if (command === 'read_table') return new Promise(resolve => {
        (window as any).finishTableRead = () => resolve({ columns: [], rows: [], elapsedMs: 0, affected: 0, truncated: false });
      });
      if (command === 'describe_table') return [{ name: 'id', dataType: 'bigint', primary: true, editable: false, nullable: false }];
      if (command === 'schema_info') return { info: { name: 'public' }, tables: [{ schema: 'public', name: 'notes' }] };
      if (command === 'table_info') return { indexes: [], constraints: [] };
      if (command === 'credential_status') return { supported: false, saved: false, available: false };
      if (command.startsWith('plugin:event|')) return 1;
      throw new Error(command);
    } } });
  });
  await page.goto('/');
  await page.getByLabel('새 연결', { exact: true }).click();
  await page.getByRole('button', { name: '연결하기', exact: true }).click();
  await page.locator('.tree-table').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishTableRead)).toBe('function');
  await view(page, '구조').click();
  await expect(view(page, '구조')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as any).finishTableRead());
  await expect(page.locator('.object-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.object-table tbody tr')).toContainText('id');
  await expect(view(page, '구조')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '컬럼 추가', exact: true })).toBeEnabled();
});

test('a table keeps one tab whose views are remembered and linked', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await expect(view(page, '데이터')).toHaveAttribute('aria-pressed', 'true');
  await view(page, '구조').click();
  await expect(page.locator('.object-table tbody tr')).toHaveCount(6);
  await view(page, '관계').click();
  await expect(page.getByRole('region', { name: '관계', exact: true })).toContainText('외래키 관계가 없습니다');
  await page.locator('.tree-table').click();
  await expect(view(page, '관계')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: '스키마 ERD에서 보기' }).click();
  await expect(page.getByRole('tab', { name: 'public', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(view(page, 'ERD')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.erd-table-node')).toHaveCount(1);
  await page.getByRole('tab', { name: 'users', exact: true }).click();
  await view(page, 'DDL').click();
  await expect(page.locator('.ddl-view')).toBeVisible();
  await view(page, '데이터').click();
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이 테이블로 새 쿼리' }).click();
  await expect(page.locator('.cm-content')).toContainText('SELECT *');
  await expect(page.getByLabel('실행 스키마', { exact: true })).toHaveAttribute('data-value', 'public');
});

test('DB headers cycle sorting and restore query order', async ({ page }) => {
 await page.goto('/');
 const table = page.locator('table.data-grid').first();
 const rows = table.locator('tbody tr');
 await expect(page.getByText('Alex Morgan', {exact:true})).toBeVisible();
 const original = await rows.allTextContents();
 const heading = table.getByRole('columnheader').filter({hasText:'name'}).first();
 await heading.click(); await expect(heading).toHaveAttribute('aria-sort','ascending');
 await heading.click(); await expect(heading).toHaveAttribute('aria-sort','descending');
 expect(await rows.allTextContents()).not.toEqual(original);
 await heading.click(); await expect(heading).toHaveAttribute('aria-sort','none');
 expect(await rows.allTextContents()).toEqual(original);
 await view(page,'구조').click();
 const metadata = page.locator('.object-table');
 const metadataRows = metadata.locator('tbody tr');
 await expect(metadataRows.first()).toBeVisible();
 const initial = await metadataRows.allTextContents();
 const field = metadata.getByRole('columnheader').first();
 await field.click(); await field.click(); await field.click();
 await expect(field).toHaveAttribute('aria-sort','none');
 expect(await metadataRows.allTextContents()).toEqual(initial);
});

test('a newly opened table shows data first and remembers when SQL is expanded', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.locator('.tab-close').click();
  await page.locator('.tree-table').click();
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await expect(page.locator('#sql-editor')).toBeHidden();
  await page.getByRole('button', { name: 'SQL 펼치기', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await view(page, '구조').click();
  await view(page, '데이터').click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('button', { name: '이 테이블로 새 쿼리' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('row details panel follows the selected row and steps through results', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.locator('.data-grid tbody td.row-number').nth(1).click();
  const panel = page.getByRole('complementary', { name: '행 상세' });
  await expect(panel.getByText('행 2 / 12')).toBeVisible();
  await expect(panel.getByText('Sofia Chen', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '이전 행' }).click();
  await expect(panel.getByText('행 1 / 12')).toBeVisible();
  await expect(panel.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '다음 행' }).click();
  await expect(panel.getByText('행 2 / 12')).toBeVisible();
  await expect(panel.getByText('Sofia Chen', { exact: true })).toBeVisible();
  await page.locator('.data-grid tbody tr').filter({ hasText: 'James Park' }).locator('td').nth(2).click();
  await expect(panel.getByText('행 3 / 12')).toBeVisible();
  await panel.getByLabel('열과 값 검색').fill('email');
  await expect(panel.locator('.row-inspector-field')).toHaveCount(1);
  await panel.getByRole('button', { name: '행 상세 닫기' }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: '행 상세 패널' }).click();
  await expect(page.getByRole('complementary', { name: '행 상세' })).toBeVisible();
});
