import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('woojoo-work-area', 'redis'); if (!localStorage.getItem('woojoo-language')) localStorage.setItem('woojoo-language', 'ko'); });
  await page.goto('/');
});
test('Redis demo is explicit and supports typed values, cache and queue observation', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Redis', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('user:1001')).not.toBeVisible();
  await page.getByRole('button', { name: '데모 살펴보기' }).click();
  const table = page.getByTestId('redis-key-list');
  await table.getByRole('button', { name: 'user:1001', exact: true }).click();
  await expect(page.getByTestId('redis-detail')).toContainText('Sangmu');
  await table.getByRole('button', { name: 'queue:emails', exact: true }).click();
  await expect(page.getByTestId('redis-detail')).toContainText('welcome');
  await page.getByRole('button', { name: '캐시', exact: true }).click();
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await page.getByRole('button', { name: /1분 이내/ }).click();
  await expect(table).toContainText('cache:weather');
  await expect(table).not.toContainText('user:1001');
  await page.getByRole('button', { name: '큐', exact: true }).click();
  await page.locator('.redis-queue-picker').getByRole('button', { name: '주문 이벤트', exact: true }).click();
  await expect(page.getByTestId('redis-queue-info')).toContainText('orders-worker');
  await expect(page.getByTestId('redis-queue-info')).toContainText('ACK');
  await page.getByRole('button', { name: 'orders-worker', exact: true }).click();
  await expect(page.getByTestId('redis-queue-info')).toContainText('worker-1');
  await page.screenshot({ path: 'artifacts/redis-queue.png' });
});
test('Redis connection form validates endpoint and supports explicit browser limitation', async ({ page }) => {
  await page.getByRole('button', { name: '연결 추가', exact: true }).first().click();
  await page.getByLabel('연결 이름', { exact: true }).fill('Local');
  await page.getByLabel('호스트', { exact: true }).fill('redis://localhost');
  await page.getByRole('button', { name: '연결 테스트', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('호스트');
});
test('Redis search and data-type views remain independent of app switching', async ({ page }) => {
  await page.getByRole('button', { name: '데모 살펴보기' }).click();
  await page.getByLabel('키 패턴 검색', { exact: true }).fill('cache:*');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.getByTestId('redis-key-list')).toContainText('cache:weather');
  await expect(page.getByTestId('redis-key-list')).not.toContainText('user:1001');
  await page.getByLabel('키 패턴 검색', { exact: true }).fill('user:1001');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.getByTestId('redis-key-list').getByRole('button', { name: 'user:1001', exact: true }).click();
  await expect(page.getByTestId('redis-detail')).toContainText('Sangmu');
  await page.getByRole('button', { name: '데이터베이스', exact: true }).click();
  await page.getByRole('button', { name: 'Redis', exact: true }).click();
  await expect(page.getByTestId('redis-detail')).toContainText('Sangmu');
});

test('all six Redis types render and saved views can be created and removed', async ({ page }) => {
  await page.getByRole('button', { name: '데모 살펴보기' }).click();
  const table = page.getByTestId('redis-key-list');
  for (const [key, content] of [['cache:catalog', 'Keyboard'], ['online:users', '1003'], ['leaderboard:weekly', '980'], ['events:orders', 'shipped']]) {
    await table.getByRole('button', { name: key, exact: true }).click();
    await expect(page.getByTestId('redis-detail')).toContainText(content);
  }
  await page.getByRole('button', { name: '즐겨찾기', exact: true }).click();
  await page.getByRole('dialog').getByLabel('이름', { exact: true }).fill('My events');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('.redis-sidebar').getByRole('button', { name: 'My events', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '보기 삭제 My events', exact: true }).click();
  await expect(page.getByRole('button', { name: 'My events', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '키', exact: true }).click();
  await page.screenshot({ path: 'artifacts/redis-keys.png' });
});

test('compact English light layout allows closing detail and returning to key list', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('woojoo-language', 'en'); localStorage.setItem('woojoo-theme', 'light'); });
  await page.reload(); await page.setViewportSize({ width: 960, height: 640 });
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByTestId('redis-key-list').getByRole('button', { name: 'user:1001', exact: true }).click();
  await expect(page.getByTestId('redis-detail')).toContainText('Sangmu');
  await page.getByRole('button', { name: 'Close detail', exact: true }).click();
  await expect(page.getByTestId('redis-key-list')).toBeVisible();
  await page.screenshot({ path: 'artifacts/redis-compact-light.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('demo is visibly isolated and can return to real connection mode', async ({ page }) => {
  await page.getByRole('button', { name: '데모 살펴보기' }).click();
  await page.getByRole('button', { name: '데모 종료', exact: true }).click();
  await expect(page.getByRole('button', { name: '데모 살펴보기' })).toBeVisible();
  await expect(page.getByText('Redis playground', { exact: true })).not.toBeVisible();
});

test('Redis table sorting cycles, compares numeric values and keeps selection on refresh', async ({ page }) => {
  await page.getByRole('button', { name: '데모 살펴보기' }).click();
  const table = page.getByRole('table', { name: '키 목록', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(9);
  const names = () => table.locator('tbody tr td:first-child button').allTextContents();
  const original = await names();
  const heading = table.getByRole('columnheader', { name: '키', exact: true });
  await heading.click();
  await expect(heading).toHaveAttribute('aria-sort', 'ascending');
  expect((await names())[0]).toBe('cache:catalog');
  await heading.click();
  await expect(heading).toHaveAttribute('aria-sort', 'descending');
  expect((await names())[0]).toBe('user:1001');
  await heading.click();
  expect(await names()).toEqual(original);
  const ttl = table.getByRole('columnheader', { name: 'TTL', exact: true });
  await ttl.click();
  expect((await names()).slice(-4)).toEqual(['cache:weather', 'cache:catalog', 'online:users', 'leaderboard:weekly']);
  await table.getByRole('button', { name: 'cache:catalog', exact: true }).click();
  const detail = page.getByTestId('redis-detail');
  const fields = detail.getByRole('columnheader', { name: '필드', exact: true });
  await fields.click();
  await expect(detail.locator('tbody tr').first()).toContainText('name');
  await page.getByRole('button', { name: '키 새로고침', exact: true }).click();
  await expect(detail).toContainText('Keyboard');
  await expect(table.locator('tr.selected')).toContainText('cache:catalog');
  await expect(ttl).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: '사이드바 전환', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Redis 연결 선택', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '연결 추가', exact: true })).toHaveCount(1);
});

for (const language of ['ko', 'en']) for (const theme of ['dark', 'light']) {
  test(`Redis visual check: ${language} ${theme} at minimum desktop size`, async ({ page }, testInfo) => {
    await page.evaluate(({ language, theme }) => {
      localStorage.setItem('woojoo-language', language);
      localStorage.setItem('woojoo-theme', theme);
    }, { language, theme });
    await page.setViewportSize({ width: 960, height: 640 });
    await page.reload();
    const ko = language === 'ko';
    await page.getByRole('button', { name: ko ? '연결 추가' : 'Add connection', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: ko ? '연결' : 'Connect', exact: true })).toBeInViewport();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('connection.png') });
    await dialog.getByRole('button', { name: ko ? '취소' : 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: ko ? '데모 살펴보기' : 'Explore demo' }).click();
    const filter = page.getByRole('combobox', { name: ko ? '자료형 필터' : 'Type filter', exact: true });
    await filter.click();
    await expect(page.getByRole('option', { name: 'stream', exact: true })).toBeInViewport();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('select.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: ko ? '캐시' : 'Cache', exact: true }).click();
    await page.getByRole('button', { name: ko ? '목록' : 'List', exact: true }).click();
    await expect(page.getByTestId('redis-key-list')).toBeInViewport();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('cache.png') });
    await page.getByRole('button', { name: ko ? '패턴 저장' : 'Save pattern', exact: true }).click();
    await expect(dialog.getByRole('button', { name: ko ? '저장' : 'Save', exact: true })).toBeInViewport();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('save-view.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
