import { test, expect, type Page } from '@playwright/test';
async function setup(page: Page, scenario: string) {
  await page.addInitScript(({ scenario }) => {
    localStorage.setItem('woojoo-work-area', 'redis'); localStorage.setItem('woojoo-language', 'ko'); localStorage.setItem('woojoo-redis-profile', 'local');
    const w = window as any; w.calls = []; w.isTauri = true;
    const profile = { id: 'local', name: 'Local', host: 'localhost', port: 6379, username: '', db: 0, tls: false, environment: 'Test', separator: ':' };
    const bytes = (text: string) => ({ base64: btoa(text), text, utf8: true });
    const meta = (text: string) => ({ key: bytes(text), type: 'string', ttlMs: '-1', length: '1', error: null });
    w.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command: string, args: any) => {
      w.calls.push({ command, args });
      if (command === 'redis_workspace_load') return { profiles: [profile], views: [], credentialSupported: true };
      if (command === 'redis_connect') return { sessionId: 'native-session' };
      if (command === 'redis_profile_save' && scenario === 'save-failure') throw 'STORE: test failure';
      if (command === 'redis_scan') return { keys: scenario === 'empty-page' && args.request.cursor === '0' ? [] : [meta('A'), meta('B')], nextCursor: scenario === 'empty-page' && args.request.cursor === '0' ? 'next-page' : '0', observedAt: Date.now(), partial: scenario === 'empty-page' && args.request.cursor === '0', dbSize: '2' };
      if (command === 'redis_key_metadata') { if (scenario === 'delayed-direct') await new Promise<void>(resolve => { w.releaseMeta = resolve; }); return meta(atob(args.request.keyBase64)); }
      if (command === 'redis_read_value') return { ...meta(atob(args.request.keyBase64)), rows: [], text: bytes(atob(args.request.keyBase64) === 'A' ? 'value-A' : 'value-B'), nextCursor: null, observedAt: Date.now(), truncated: false };
      if (command === 'credential_status') return { supported: true, saved: false, available: false };
      if (command === 'get_settings') return {};
      if (command === 'list_connections') return [];
      return null;
    } };
  }, { scenario });
  await page.goto('/');
  await page.getByRole('button', { name: '연결', exact: true }).click();
  await page.getByRole('dialog').getByLabel('비밀번호', { exact: true }).fill('test-secret');
  await page.getByRole('dialog').getByRole('button', { name: '연결', exact: true }).click();
}
test('failed profile persistence reclaims a newly opened session and clears password input', async ({ page }) => {
  await setup(page, 'save-failure');
  await expect(page.getByRole('alert').last()).toContainText('STORE');
  await expect(page.getByRole('dialog').getByLabel('비밀번호', { exact: true })).toHaveValue('');
  await expect.poll(() => page.evaluate(() => (window as any).calls.some((c: any) => c.command === 'redis_disconnect' && c.args.sessionId === 'native-session'))).toBe(true);
});
test('a delayed exact lookup cannot overwrite a newer list selection', async ({ page }) => {
  await setup(page, 'delayed-direct');
  await expect(page.getByTestId('redis-key-list')).toContainText('B');
  await page.getByLabel('키 직접 열기', { exact: true }).fill('A'); await page.getByRole('button', { name: '열기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseMeta)).toBe('function');
  await page.getByTestId('redis-key-list').getByRole('button', { name: 'B', exact: true }).click();
  await expect(page.getByTestId('redis-detail')).toContainText('value-B');
  await page.evaluate(() => (window as any).releaseMeta());
  await expect.poll(() => page.evaluate(() => (window as any).calls.filter((c: any) => c.command === 'redis_read_value').map((c: any) => c.args.request.keyBase64))).toEqual([btoa('B')]);
  await expect(page.getByTestId('redis-detail')).toContainText('value-B');
});
test('empty SCAN batch stays partial and continues with opaque cursor', async ({ page }) => {
  await setup(page, 'empty-page');
  await expect(page.getByText(/아직 키를 발견하지 못했습니다/)).toBeVisible();
  await page.getByRole('button', { name: '더 불러오기', exact: true }).click();
  await expect(page.getByTestId('redis-key-list')).toContainText('B');
  await expect(page.getByText(/탐색 완료/)).toBeVisible();
  await expect(page.getByTestId('redis-key-list')).toContainText('만료 없음');
});
