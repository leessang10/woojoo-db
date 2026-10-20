import { test, expect } from '@playwright/test';

test('tabs preserve SQL, results and filters independently', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(2);
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.getByLabel('결과 필터').fill('Sofia');
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 1;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(1);
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 2;');
  await expect(page.getByLabel('결과 필터')).toHaveValue('Sofia');
  await expect(page.getByText('Sofia Chen', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'users', exact: true }).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(12);
});

test('closing a dirty tab can be cancelled and never erases another tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 3;');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '탭 닫기: 쿼리 1', exact: true }).click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 3;');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '탭 닫기: 쿼리 1', exact: true }).click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(1);
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '탭 닫기: users', exact: true }).click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toHaveText('');
  await expect(page.locator('.run-button')).toBeDisabled();
});

test('opening a table preserves staged edits and query text', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Alex Morgan', { exact: true }).dblclick();
  await page.getByLabel('셀 값').fill('Uncommitted');
  await page.getByRole('button', { name: '변경 대기열에 추가' }).click();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 4;');
  await page.locator('.tree-table').click({button:'right'});
  await page.getByRole('menuitem', {name:'데이터 보기',exact:true}).click();
  await expect(page.getByText('Uncommitted', { exact: true })).toBeVisible();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 4;');
});

test('query completion stays in its originating tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2;');
  await page.locator('.run-button').click();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('');
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.getByRole('tab', { name: '쿼리 2', exact: true }).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(0);
});

test('history opens a new tab instead of overwriting an unfinished query', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 7;');
  await page.getByRole('button', { name: '쿼리 기록', exact: true }).click();
  await page.locator('.history-item').click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(3);
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 2;');
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 7;');
});

test('opening the table after a query restores an editable table without losing the SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.locator('.tree-table').click({button:'right'});
  await page.getByRole('menuitem', {name:'데이터 보기',exact:true}).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(12);
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 2;');
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
});

test('switching tabs preserves the editor undo history', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').pressSequentially('SELECT');
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.getByRole('tab', { name: '쿼리 1', exact: true }).click();
  await page.locator('.cm-content').press('Control+z');
  await expect(page.locator('.cm-content')).toHaveText('');
});

test('connections keep separate tabs while a query completes in the background', async ({ page }) => {
  // Mock only the native transport. This is a UI isolation test, not a live DB test.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'connect_db') return 'test-session';
          if (command === 'list_tables') return [{ schema: 'public', name: 'widgets' }];
          if (command === 'run_query') await new Promise(resolve => setTimeout(resolve, 250));
          if (command === 'read_table' || command === 'run_query') return {
            columns: [{ name: 'name', dataType: 'text', primary: false, editable: false }],
            rows: [{ name: command === 'run_query' ? 'Mock query result' : 'Mock row' }],
            affected: 0, elapsedMs: 1, truncated: false,
          };
          throw new Error(`Unexpected command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.getByLabel('새 연결').click();
  await page.getByLabel('연결 이름').fill('Mock DB');
  await page.getByRole('button', { name: '연결하기', exact: true }).click();
  await expect(page.getByText('Mock row', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT name FROM widgets');
  await page.locator('.run-button').click();
  await page.locator('.connection').filter({ hasText: 'Woojoo playground' }).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 2;');
  await page.locator('.connection').filter({ hasText: 'Mock DB' }).click();
  await expect(page.getByText('Mock query result', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText('SELECT name FROM widgets');
});
