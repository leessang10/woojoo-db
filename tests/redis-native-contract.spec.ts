import { test, expect, type Page } from '@playwright/test';
async function setup(page: Page, scenario: string) {
  await page.addInitScript(({ scenario }) => {
    localStorage.setItem('woojoo-work-area', 'redis'); localStorage.setItem('woojoo-language', 'ko'); localStorage.setItem('woojoo-redis-profile', 'local');
    const w = window as any; w.calls = []; w.isTauri = true;
    const profile = { id: 'local', name: 'Local', host: 'localhost', port: 6379, username: '', db: 0, tls: false, environment: 'Test', separator: ':' };
    const bytes = (text: string) => ({ base64: btoa(text), text, utf8: true });
    const meta = (text: string) => ({ key: bytes(text), type: text === 'queue:jobs' ? 'list' : 'string', ttlMs: '-1', length: '1', error: null });
    w.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command: string, args: any) => {
      w.calls.push({ command, args });
      if (command === 'redis_workspace_load') return { profiles: [profile], views: scenario === 'delayed-direct' ? [{ id: 'fav', profileId: 'local', db: 0, name: 'A favorite', kind: 'favorite', keyBase64: btoa('A'), pattern: '', direction: 'unknown' }] : scenario === 'flow-events' ? [{ id: 'queue', profileId: 'local', db: 0, name: 'Jobs', kind: 'list', keyBase64: btoa('queue:jobs'), pattern: '', direction: 'left' }] : [], credentialSupported: true };
      if (command === 'redis_connect') return { sessionId: 'native-session' };
      if (command === 'redis_profile_save' && scenario === 'save-failure') throw 'STORE: test failure';
      if (command === 'redis_scan' && scenario === 'many-keys') return { keys: Array.from({length:args.request.cursor === '0' ? 400 : 50},(_,i)=>meta('key:'+((args.request.cursor === '0' ? 0 : 400)+i))), nextCursor: args.request.cursor === '0' ? 'more' : '0', observedAt:Date.now(), partial:true, dbSize:'450' };
      if (command === 'redis_read_value' && scenario === 'large-json') return {...meta('A'),rows:[],text:bytes(JSON.stringify(Object.fromEntries(Array.from({length:140},(_,i)=>['field'+i,i])))),nextCursor:null,observedAt:Date.now(),truncated:false};
      if (command === 'redis_scan') return { keys: scenario === 'empty-page' && args.request.cursor === '0' ? [] : scenario === 'flow-events' ? [meta('queue:jobs')] : [meta('A'), meta('B')], nextCursor: scenario === 'empty-page' && args.request.cursor === '0' ? 'next-page' : '0', observedAt: Date.now(), partial: scenario === 'empty-page' && args.request.cursor === '0', dbSize: '2' };
      if (command === 'redis_key_metadata') { if (scenario === 'delayed-direct') await new Promise<void>(resolve => { w.releaseMeta = resolve; }); return meta(atob(args.request.keyBase64)); }
      if (command === 'redis_read_value') return { ...meta(atob(args.request.keyBase64)), rows: [], text: bytes(atob(args.request.keyBase64) === 'A' ? 'value-A' : 'value-B'), nextCursor: null, observedAt: Date.now(), truncated: false };
      if (command === 'redis_flow_events') {
        if (args.afterId === null) return { records: [], lastId: '0-0', baseline: true, gap: false, observedAt: Date.now() };
        const fields = { sourceId: 'worker', sequence: '1', kind: 'enqueue', keyBase64: btoa('queue:jobs'), at: String(Date.now() - 5000), jobId: 'actual-job-1' };
        return { records: [{ id: '1-0', fields }, { id: '1-0', fields }, { id: '2-0', fields: { ...fields, keyBase64: btoa('unrelated'), jobId: 'other-job' } }], lastId: '2-0', baseline: false, gap: false, observedAt: Date.now() };
      }
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
test('a delayed saved-key lookup cannot overwrite a newer list selection', async ({ page }) => {
  await setup(page, 'delayed-direct');
  await expect(page.getByTestId('redis-key-list')).toContainText('B');
  await page.getByRole('button', { name: 'A favorite', exact: true }).click();
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


test('native event contract animates received records, filters unrelated keys and deduplicates', async ({ page }) => {
  await setup(page, 'flow-events');
  await page.getByRole('button', { name: '큐', exact: true }).click();
  await expect(page.getByTestId('queue-cylinder')).toBeVisible();
  await expect(page.getByTestId('queue-job-motion')).toHaveCount(0);
  await page.getByRole('button', { name: '관측 설정', exact: true }).click();
  await page.getByLabel('관측용 Stream', { exact: true }).fill('observability:redis');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await page.getByRole('button', { name: '관측 시작', exact: true }).click();
  const token = page.getByTestId('queue-job-motion');
  await expect(token).toHaveText('actual-job-1', { timeout: 7000 });
  await expect(page.locator('.rf-history summary')).toContainText('1');
  await page.locator('.rf-history summary').click();
  await expect(page.locator('.rf-history')).toContainText('service');
  await expect(page.locator('.rf-history')).not.toContainText('other-job');
  await page.waitForTimeout(2300);
  await expect(page.locator('.rf-history summary')).toContainText('1');
  await expect(token).toHaveCount(0);
  await page.getByRole('button', { name: '관측 중지', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === 'redis_read_value' || c.command === 'redis_flow_events').length);
  await page.waitForTimeout(2300);
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c.command === 'redis_read_value' || c.command === 'redis_flow_events').length)).toBe(calls);
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await page.getByRole('button', { name: '흐름', exact: true }).click();
  await expect(page.locator('.rf-history summary')).toContainText('1');
});

 test('loading more keys preserves the current page',async({page})=>{
  await setup(page,'many-keys');
  const list=page.getByTestId('redis-key-list');
  await list.getByRole('button',{name:'다음',exact:true}).click();
  await expect(list).toContainText('201–400 / 400');
  await page.getByRole('button',{name:'더 불러오기',exact:true}).click();
  await expect(list).toContainText('201–400 / 450');
 });
 test('JSON tree progressively reveals entries after the first hundred',async({page})=>{
  await setup(page,'large-json');
  await page.getByTestId('redis-key-list').getByRole('button',{name:'A',exact:true}).click();
  const detail=page.getByTestId('redis-detail');
  await expect(detail.getByText('field139',{exact:true})).toHaveCount(0);
  await detail.getByRole('button',{name:'더 보기 (40개 남음)',exact:true}).click();
  await expect(detail.getByText('field139',{exact:true})).toBeVisible();
 });
