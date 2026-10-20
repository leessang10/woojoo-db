import { test, expect } from './fixtures';
import { readFile, writeFile } from 'node:fs/promises';

async function openDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '스키마 상세: public', exact: true }).click();
  await page.getByRole('button', { name: 'ERD 열기' }).click();
  await expect(page.locator('.erd-table-node')).toHaveCount(1);
}

test('ERD filters columns, edits table style, saves, and preserves the workspace', async ({ page }) => {
  await openDemo(page);
  await expect(page.locator('.erd-column')).toHaveCount(6);
  await page.getByLabel('컬럼 표시', { exact: true }).selectOption('pk');
  await expect(page.locator('.erd-column')).toHaveCount(1);
  await page.getByLabel('컬럼 표시', { exact: true }).selectOption('keys');
  await expect(page.locator('.erd-column')).toHaveCount(1);
  await page.getByLabel('선택 항목').selectOption(JSON.stringify(['public', 'users']));
  await page.getByLabel('테이블 색상').fill('#bb3344');
  await page.getByLabel('테이블 모양').selectOption('square');
  await expect(page.locator('.erd-table-node')).toHaveClass(/square/);
  await expect(page.locator('.erd-table-node header')).toHaveCSS('background-color', 'rgb(187, 51, 68)');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('.erd-table-node')).toHaveClass(/rounded/);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await page.getByRole('tab', { name: 'users', exact: true }).click();
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'public · ERD' }).click();
  await expect(page.locator('.erd-table-node')).toHaveClass(/square/);
  await openDemo(page);
  await expect(page.locator('.erd-table-node')).toHaveClass(/square/);
  await expect(page.getByLabel('컬럼 표시', { exact: true })).toHaveValue('keys');
});

test('ERD exports valid PNG and PDF containing the full diagram', async ({ page }) => {
  await openDemo(page);
  for (const format of ['PNG', 'PDF']) {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const download = await downloaded;
    await download.saveAs(`test-results/erd-export.${format.toLowerCase()}`);
    const content = await readFile((await download.path())!);
    expect(content.length).toBeGreaterThan(1000);
    if (format === 'PNG') {
      expect(content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(content.readUInt32BE(16)).toBeGreaterThan(400);
    } else expect(content.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(page.getByRole('alert')).not.toBeVisible();
  }
});

test('real FK transport generates editable relations with PK/FK filtering and refresh', async ({ page }) => {
  await page.addInitScript(() => {
    const col = (name: string, primary = false) => ({ name, primary, dataType: 'integer', editable: !primary });
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string, args?: { bytes: number[] }) => {
        if (command === 'save_erd_export') {
          (window as unknown as { exported: number[] }).exported = args!.bytes;
          return true;
        }
        if (command === 'connect_db') return 'erd-test';
        if (command === 'list_tables') return [{ schema: 'public', name: 'orders' }, { schema: 'public', name: 'users' }];
        if (command === 'read_table') return { columns: [], rows: [], elapsedMs: 0, affected: 0, truncated: false };
        if (command === 'read_erd') return {
          tables: [{ table: { schema: 'public', name: 'users' }, columns: [col('id', true), col('name')] },
            { table: { schema: 'public', name: 'orders' }, columns: [col('id', true), col('user_id'), col('total')] }],
          foreignKeys: [{ id: 'fk_orders_user', name: 'orders_user_id_fkey', source: { schema: 'public', name: 'orders' }, target: { schema: 'public', name: 'users' }, sourceColumns: ['user_id'], targetColumns: ['id'] }],
        };
        throw new Error(command);
      },
    } });
  });
  await page.goto('/');
  await page.getByLabel('새 연결').click();
  await page.getByRole('button', { name: '연결하기', exact: true }).click();
  await expect(page.locator('.tree-table')).toHaveCount(2);
  await page.getByRole('button', { name: '스키마 상세: public', exact: true }).click();
  await page.getByRole('button', { name: 'ERD 열기' }).click();
  await expect(page.locator('.erd-table-node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByLabel('컬럼 표시', { exact: true }).selectOption('pk');
  await expect(page.locator('.erd-column')).toHaveCount(2);
  await page.getByLabel('컬럼 표시', { exact: true }).selectOption('keys');
  await expect(page.locator('.erd-column')).toHaveCount(3);
  await page.getByLabel('선택 항목').selectOption('fk_orders_user');
  await page.getByLabel('선 색상').fill('#ff6600');
  await page.getByLabel('연결선 모양').selectOption('straight');
  await page.getByLabel('화살표', { exact: true }).selectOption('both');
  await expect(page.locator('.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(255, 102, 0)');
  await expect(page.locator('.react-flow__edge-path')).toHaveAttribute('marker-start', /url/);
  await page.getByRole('button', { name: '관계 삭제', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: '메타데이터 새로고침' }).click();
  await expect(page.getByRole('button', { name: '메타데이터 새로고침' })).toBeEnabled();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'DB 관계 복원' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const node = page.locator('.erd-table-node').first();
  const before = await node.boundingBox();
  await node.locator('header').hover();
  await page.mouse.down();
  await page.mouse.move(before!.x + 160, before!.y + 120, { steps: 8 });
  await page.mouse.up();
  const after = await node.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeGreaterThan(20);
  await page.screenshot({ path: 'test-results/erd-dark.png' });
  await page.getByRole('button', { name: '관계 추가', exact: true }).click();
  await page.getByLabel('관계 이름', { exact: true }).fill('Manual relation');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByRole('button', { name: '라이트 모드로 전환' }).click();
  await page.getByLabel('언어 / Language').selectOption('en');
  await expect(page.getByLabel('Relationship name')).toHaveValue('Manual relation');
  await page.setViewportSize({ width: 960, height: 700 });
  await page.locator('.erd-toolbar').getByRole('button', { name: 'Fit view', exact: true }).click();
  await page.screenshot({ path: 'test-results/erd-light.png' });
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Export complete' })).toBeVisible();
  const bytes = await page.evaluate(() => (window as unknown as { exported: number[] }).exported);
  await writeFile('test-results/erd-relations.png', Buffer.from(bytes));
  expect(Buffer.from(bytes).readUInt32BE(16)).toBeGreaterThan(700);
});
