// Drives the API work area in a test-launched WebView2 (remote debugging on 9225)
// against a local echo server on 127.0.0.1:18080 that sends no CORS headers.
// It deletes the request and history it creates before exiting.
import { chromium, expect } from '@playwright/test';

const ECHO = 'http://127.0.0.1:18080';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
try {
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  expect(await page.evaluate(() => !!window.__TAURI_INTERNALS__)).toBe(true);
  const main = page.locator('.api-main');
  const response = page.locator('.api-response');
  const url = page.getByRole('textbox', { name: 'URL', exact: true });
  const status = response.locator('.api-status');
  async function send(target) {
    await url.fill(target);
    await url.press('Control+Enter');
  }

  // Clicking the active rail item collapses the sidebar, so only click when it is not selected.
  const rail = page.locator('.rail-button').nth(2);
  if (await rail.getAttribute('aria-pressed') !== 'true') await rail.click();
  await expect(main).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(url).toBeVisible();

  // POST with a header, a JSON body and a generated variable; the echo server has no CORS headers.
  await page.locator('.api-method').click();
  await page.getByRole('option', { name: 'POST', exact: true }).click();
  await page.getByRole('tab', { name: /^(헤더|Headers)/ }).first().click();
  await page.locator('.api-section-body input[aria-label]').nth(0).fill('X-Test');
  await page.locator('.api-section-body tr').nth(1).locator('input').nth(2).fill('desktop');
  await page.getByRole('tab', { name: /^(본문|Body)/ }).first().click();
  await page.getByRole('radio', { name: 'JSON', exact: true }).check();
  await page.locator('.api-config .cm-content').fill('{"id":"{{$uuid}}","name":"우주"}');
  await send(`${ECHO}/echo?x=1`);
  await expect(status).toHaveText(/^200/);
  const echoed = JSON.parse(await page.evaluate(() => {
    const view = document.querySelector('.api-response .cm-content');
    return view.cmView?.view?.state.doc.toString() ?? view.innerText;
  }));
  expect(echoed.method).toBe('POST');
  expect(echoed.url).toBe('/echo?x=1');
  expect(echoed.headers['x-test']).toBe('desktop');
  expect(echoed.headers['content-type']).toBe('application/json');
  expect(echoed.headers['user-agent']).toMatch(/^Woojoo\//);
  expect(JSON.parse(echoed.body).name).toBe('우주');
  expect(JSON.parse(echoed.body).id).toMatch(/^[0-9a-f-]{36}$/);
  await response.getByRole('tab', { name: /^(헤더|Headers)/ }).click();
  await expect(response.locator('.api-pairs-readonly')).toContainText('x-echo');
  await response.getByRole('tab', { name: /^(본문|Body)/ }).click();

  // Status tones, redirects, cancel and timeout.
  await page.getByRole('tab', { name: /^(본문|Body)/ }).first().click();
  await page.getByRole('radio', { name: /^(없음|None)$/ }).check();
  await send(`${ECHO}/missing`);
  await expect(status).toHaveText(/^404/);
  await expect(status).toHaveAttribute('data-tone', 'warn');
  await send(`${ECHO}/redirect`);
  await expect(status).toHaveText(/^200/);
  await expect(response.locator('.cm-content')).toContainText('/echo?from=redirect');
  await send(`${ECHO}/slow`);
  await expect(page.locator('.api-send')).toHaveText(/취소|Cancel/);
  await page.locator('.api-send').click();
  await expect(page.locator('.api-send')).toHaveText(/보내기|Send/);
  await expect(page.locator('.api-response-error')).toHaveCount(0);
  await page.getByRole('tab', { name: /^(설정|Settings)$/ }).click();
  await page.locator('.api-form input[type=number]').fill('1');
  await url.press('Control+Enter');
  await expect(page.locator('.api-response-error')).toContainText(/시간이 초과/, { timeout: 5000 });
  await page.locator('.api-form input[type=number]').fill('30');

  // Save into SQLite and read it back after a reload.
  await send(`${ECHO}/echo?saved=1`);
  await expect(status).toHaveText(/^200/);
  const name = `smoke ${Date.now()}`;
  await page.keyboard.press('Control+s');
  const dialog = page.locator('[data-modal-content]');
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: /^(확인|OK)$/ }).click();
  await expect(page.locator('.api-tree')).toContainText(name);
  await page.reload();
  await expect(page.locator('.api-tree')).toContainText(name);
  await expect(page.locator('.api-main .tab-item.active')).toContainText(name);
  await expect(url).toHaveValue(`${ECHO}/echo?saved=1`);

  // History lives in SQLite too.
  const historyToggle = page.getByRole('button', { name: /요청 기록 패널|Request history panel/ });
  if (await historyToggle.getAttribute('aria-pressed') !== 'true') await historyToggle.click();
  await expect(page.locator('.api-history-item').first()).toContainText('saved=1');
  expect(await page.locator('.api-history-item').count()).toBeGreaterThanOrEqual(5);
  await page.screenshot({ path: 'test-results/api-desktop.png' });

  // Clean up what this run (and any earlier failed run) created.
  const leftovers = page.locator('.api-tree-request', { hasText: /smoke \d{13}/ });
  while (await leftovers.count()) {
    const before = await leftovers.count();
    await leftovers.first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^(삭제|Delete)$/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^(삭제|Delete)$/ }).click();
    await expect(leftovers).toHaveCount(before - 1);
  }
  await expect(page.locator('.api-tree')).not.toContainText(name);
  await page.getByRole('button', { name: /^(기록 지우기|Clear history)$/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^(지우기|Clear)$/ }).click();
  await expect(page.locator('.api-history-item')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('Desktop API area: send, headers, JSON body, variables, 404, redirect, cancel, timeout, save, reload and history passed.');
} finally {
  await browser.close();
}
