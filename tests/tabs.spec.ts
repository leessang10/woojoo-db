import { test, expect } from './fixtures';

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
  await page.getByRole('button', { name: '탭 닫기: 쿼리 1', exact: true }).click();
await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 3;');
  await page.getByRole('button', { name: '탭 닫기: 쿼리 1', exact: true }).click();
await page.getByRole('alertdialog').getByRole('button', { name: '버리고 닫기', exact: true }).click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(1);
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '탭 닫기: users', exact: true }).click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('woojoo-workspace-v1') ?? '{}').tabs?.length)).toBe(0);
  await page.reload();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(0);
  await page.locator('.tab-add').click();
  await expect(page.locator('.tab-list').getByRole('tab')).toHaveCount(1);
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

test('rail navigation restores the workspace without toggling the sidebar or losing SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 7;');
  const explorer = page.locator('.rail').getByRole('button', { name: '탐색기', exact: true });
  const history = page.locator('.rail').getByRole('button', { name: '쿼리 기록', exact: true });
  await expect(explorer).toHaveAttribute('aria-pressed','true');
  await history.click();
  await expect(history).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('region',{name:'쿼리 기록',exact:true})).toBeVisible();
  await expect(page.locator('.tree')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 7;');
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await history.click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await explorer.click();
  await expect(page.locator('.sidebar')).toHaveCount(1);
  await expect(page.locator('.tree')).toBeVisible();
  await expect(explorer).toHaveAttribute('aria-pressed','true');
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
  await page.getByRole('button',{name:'연결 전환',exact:true}).click();
  await page.locator('[data-connection-option]').filter({hasText:'Woojoo playground'}).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 2;');
  await page.getByRole('button',{name:'연결 전환',exact:true}).click();
  await page.locator('[data-connection-option]').filter({hasText:'Mock DB'}).click();
  await expect(page.getByText('Mock query result', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText('SELECT name FROM widgets');
});


test('sidebar objects leave executed queries for new and existing tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const selector of ['.tree-table', '.tree-schema']) {
      await page.locator('.rail').getByRole('button', {name:'쿼리 기록',exact:true}).click();
      await page.locator('.rail').getByRole('button', {name:'탐색기',exact:true}).click();
      await page.locator(selector).first().click();
      await expect(page.getByRole('region',{name:'쿼리 기록',exact:true})).toHaveCount(0);
      await expect(page.locator(selector === '.tree-table' ? '.object-view-bar' : '.object-page')).toBeVisible();
    }
  }
});

test('tab names and dragged order persist without changing SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.locator('.tab-add').click();
  await page.locator('.cm-content').fill('SELECT 42;');
  await page.getByRole('tab',{name:'쿼리 1',exact:true}).dblclick();
  await page.getByRole('textbox',{name:'탭 이름',exact:true}).fill('분석');
  await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('tab',{name:'분석',exact:true})).toHaveAttribute('aria-selected','true');
  await page.locator('.tab-add').click();
  const source = await page.getByRole('tab',{name:'쿼리 2',exact:true}).boundingBox();
  const target = await page.getByRole('tab',{name:'users',exact:true}).boundingBox();
  await page.mouse.move(source!.x+source!.width/2,source!.y+source!.height/2);
  await page.mouse.down();
  await page.mouse.move(target!.x+4,target!.y+target!.height/2,{steps:12});
  await page.mouse.up();
  await expect(page.getByRole('tab')).toHaveText(['쿼리 2','users','분석']);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('woojoo-workspace-v1') ?? '{}').tabs?.map((t:any)=>t.customName||t.number))).toEqual([2,0,'분석']);
  await page.reload();
  await expect(page.getByRole('tab')).toHaveText(['쿼리 2','users','분석']);
  await page.getByRole('tab',{name:'분석',exact:true}).click();
  await expect(page.locator('.cm-content')).toHaveText('SELECT 42;');
  await page.getByRole('tab',{name:'분석',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'탭 이름 변경',exact:true}).click();
  await page.getByRole('textbox',{name:'탭 이름',exact:true}).fill('취소할 이름');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab',{name:'분석',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'분석',exact:true}).press('F2');
  await page.getByRole('textbox',{name:'탭 이름',exact:true}).fill('   ');
  await expect(page.getByRole('dialog').getByRole('button',{name:'저장',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'분석',exact:true}).press('Alt+ArrowLeft');
  await expect(page.getByRole('tab')).toHaveText(['쿼리 2','분석','users']);
  await expect(page.locator('.cm-content')).toHaveText('SELECT 42;');
  await page.screenshot({path:'test-results/workspace-tabs.png'});
});
