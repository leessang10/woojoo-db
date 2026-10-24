import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('woojoo-work-area', 'redis'); if (!localStorage.getItem('woojoo-language')) localStorage.setItem('woojoo-language', 'ko'); });
  await page.goto('/');
  await page.getByRole('button', { name: '데모 살펴보기' }).click();
});

test('queue cylinder animates actual demo entry and exit, preserves zoom and pauses', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: '큐', exact: true }).click();
  const cylinder = page.getByTestId('queue-cylinder');
  await expect(cylinder).toBeVisible();
  const count = cylinder.locator('.rf-queue-count');
  await expect(count).toContainText('3');
  await page.getByRole('button', { name: 'job 유입', exact: true }).click();
  const incoming = page.getByTestId('queue-job-motion').filter({ hasText: 'job-' }).first();
  await expect(incoming).toHaveAttribute('data-kind', 'enqueue');
  await expect(count).toContainText('4');
  const animations = await incoming.evaluate(el => el.getAnimations().map(a => ({ playState: a.playState, duration: a.effect?.getTiming().duration })));
  expect(animations.some(a => a.playState === 'running' && Number(a.duration) > 0)).toBe(true);
  const transform = await incoming.evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(300);
  expect(await incoming.evaluate(el => getComputedStyle(el).transform)).not.toBe(transform);
  await page.screenshot({ path: 'artifacts/redis-flow-queue-enter.png' });
  await page.getByRole('button', { name: 'job 인출', exact: true }).click();
  await expect(page.locator('[data-testid=queue-job-motion][data-kind=dequeue]')).toBeVisible();
  await expect(count).toContainText('3');
  await page.screenshot({ path: 'artifacts/redis-flow-queue-exit.png' });
  const viewport = page.locator('.redis-live-flow .react-flow__viewport');
  const before = await viewport.getAttribute('style');
  await page.getByRole('button', { name: '관측 시작', exact: true }).click();
  await expect(page.locator('.rf-history summary')).toContainText('3', { timeout: 5000 });
  expect(await viewport.getAttribute('style')).toBe(before);
  await page.getByRole('button', { name: '관측 중지', exact: true }).click();
  const history = await page.locator('.rf-history summary > span').first().textContent();
  await page.waitForTimeout(2100);
  expect(await page.locator('.rf-history summary > span').first().textContent()).toBe(history);
  await page.getByRole('button', { name: '관측 설정', exact: true }).click();
  await page.getByLabel('움직임 줄이기', { exact: true }).check();
  await page.getByRole('button', { name: 'job 유입', exact: true }).click();
  expect(await page.getByTestId('queue-job-motion').last().evaluate(el => getComputedStyle(el).animationName)).toBe('rf-neutral');
  expect(errors).toEqual([]);
});

test('cache refresh and hit pulse on nodes, selection and history remain useful', async ({ page }) => {
  await page.locator('.redis-sidebar').getByRole('button', { name: '애플리케이션 캐시', exact: true }).click();
  await expect(page.getByTestId('cache-flow-node')).toHaveCount(2);
  await page.getByRole('button', { name: '캐시 갱신', exact: true }).click();
  await expect(page.getByTestId('cache-pulse')).toBeVisible();
  await expect(page.getByTestId('cache-pulse')).toHaveClass(/rf-pulse-write/);
  await page.screenshot({ path: 'artifacts/redis-flow-cache-refresh.png' });
  await page.getByTestId('cache-flow-node').first().click();
  await expect(page.locator('.rf-detail')).toContainText('관측 상세');
  await page.getByRole('button', { name: '관측 상세 닫기' }).click();
  await page.getByRole('button', { name: '캐시 조회', exact: true }).click();
  await expect(page.locator('.rf-pulse-hit')).toBeVisible();
  await page.locator('.rf-history summary').click();
  await expect(page.locator('.rf-history')).toContainText('조회 적중');
  await expect(page.locator('.rf-history')).toContainText('demo');
  await page.getByLabel('변화 미관측', { exact: true }).check();
  await expect(page.getByTestId('cache-flow-node')).toHaveCount(1);
});

for (const language of ['ko', 'en']) for (const theme of ['dark', 'light']) {
  test(`flow at compact size: ${language} ${theme}`, async ({ page }) => {
    await page.evaluate(({ language, theme }) => { localStorage.setItem('woojoo-language', language); localStorage.setItem('woojoo-theme', theme); }, { language, theme });
    await page.setViewportSize({ width: 960, height: 640 }); await page.reload();
    const ko = language === 'ko';
    await page.getByRole('button', { name: ko ? '데모 살펴보기' : 'Explore demo', exact: true }).click();
    await page.getByRole('button', { name: ko ? '큐' : 'Queues', exact: true }).click();
    await expect(page.getByTestId('queue-cylinder')).toBeInViewport();
    await page.screenshot({ path: `artifacts/redis-flow-queue-${language}-${theme}.png` });
    await page.getByRole('button', { name: ko ? '캐시' : 'Cache', exact: true }).click();
    await expect(page.getByTestId('cache-flow-node').first()).toBeInViewport();
    await page.screenshot({ path: `artifacts/redis-flow-cache-${language}-${theme}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
