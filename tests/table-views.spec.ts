import { test, expect } from './fixtures';

const view = (page: import('@playwright/test').Page, name: string) => page.locator('.object-view-bar').getByRole('button', { name, exact: true });

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
