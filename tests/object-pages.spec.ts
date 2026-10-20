import { test, expect } from './fixtures';

test('schema list opens searchable table details and returns to existing editable data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByText('Alex Morgan', { exact: true }).dblclick();
  await page.getByLabel('셀 값').fill('Keep pending');
  await page.getByRole('button', { name: '변경 대기열에 추가' }).click();
  await page.locator('.tree-schema').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '스키마 상세' }).click();
  await expect(page.getByRole('heading', { name: 'public', exact: true })).toBeVisible();
  await expect(page.locator('.object-subtabs [role=tab]')).toHaveText([/테이블/, '뷰','루틴','트리거']);
  await page.getByRole('tab',{name:'뷰',exact:true}).click();
  await expect(page.getByLabel('스키마 내 테이블 검색')).toHaveCount(0);
  await page.getByRole('tab',{name:/^테이블/}).click();
  await page.getByLabel('스키마 내 테이블 검색').fill('missing');
  await expect(page.locator('.object-table tbody tr')).toHaveCount(0);
  await page.getByLabel('스키마 내 테이블 검색').fill('users');
  await page.getByRole('button', { name: '테이블 상세', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'users', exact: true })).toBeVisible();
  await expect(page.locator('.object-table tbody tr')).toHaveCount(6);
  await expect(page.locator('.object-table tbody tr').first()).toContainText('PK');
  await page.getByLabel('컬럼 검색').fill('email');
  await expect(page.locator('.object-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '데이터 보기', exact: true }).click();
  await expect(page.getByText('Keep pending', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '테이블 상세', exact: true }).click();
  await expect(page.getByLabel('컬럼 검색')).toHaveValue('email');
  await page.getByRole('tabpanel').getByRole('button', { name: 'public', exact: true }).click();
  await expect(page.getByLabel('스키마 내 테이블 검색')).toHaveValue('users');
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(3);
});

test('object pages translate and SELECT opens a separate query tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.locator('.tree-table').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Table details' }).click();
  await expect(page.getByRole('columnheader', { name: 'Nullable' })).toBeVisible();
  await expect(page.locator('.object-table tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: 'Open SELECT query' }).click();
  await expect(page.locator('.cm-content')).toContainText('SELECT *');
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(3);
  await page.getByRole('tab', { name: 'users · Structure' }).click();
  await page.getByRole('button', { name: 'Refresh details' }).click();
  await expect(page.locator('.object-table tbody tr')).toHaveCount(6);
});

test('native metadata errors can be retried without reading table data again', async ({ page }) => {
  await page.addInitScript(() => {
    let reads = 0;
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string) => {
        if (command === 'connect_db') return 'metadata-test';
        if (command === 'list_tables') return [{ schema: 'app', name: 'widgets' }];
        if (command === 'read_table') {
          if (++reads > 1) throw new Error('Unexpected data read');
          return { columns: [], rows: [], elapsedMs: 0, affected: 0, truncated: false };
        }
        if (command === 'schema_info') return {info:{name:'app'},tables:[{schema:'app',name:'widgets'}]};
        if (command === 'table_info') return {indexes:[],constraints:[]};
        if (command === 'describe_table') {
          if (!(window as any).allowMetadata) throw new Error('Metadata unavailable');
          return [{ name: 'widget_id', dataType: 'uuid', primary: true, editable: false, nullable: false, defaultValue: 'gen_random_uuid()' }];
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    } });
  });
  await page.goto('/');
  await page.getByLabel('새 연결').click();
  await page.getByRole('button', { name: '연결하기', exact: true }).click();
  await expect(page.locator('.tree-table')).toHaveText('widgets');
  await page.locator('.tree-table').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '테이블 상세' }).click();
  await expect(page.getByRole('alert')).toContainText('Metadata unavailable');
  await page.evaluate(()=>{(window as any).allowMetadata=true;});
  await page.getByRole('button', { name: '상세 새로고침' }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.locator('.object-table tbody')).toContainText('gen_random_uuid()');
  await expect(page.locator('.object-table tbody')).toContainText('허용 안 함');
});
