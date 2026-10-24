import { test, expect, type Page } from './fixtures';
const id = 'a'.repeat(64);
async function setup(page: Page, scenario = 'normal') {
  await page.addInitScript(({ scenario, id }) => {
    const w = window as any; w.calls = []; w.dockerFail = scenario === 'engine-off' || scenario === 'engine-start-fails';
    const callbacks = new Map(); let callbackId = 0;
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      transformCallback: (cb: any) => { callbacks.set(++callbackId, cb); return callbackId; }, unregisterCallback: (key: number) => callbacks.delete(key),
      invoke: async (command: string, args: any) => {
        w.calls.push({ command, args });
        if (command === 'docker_contexts') return [{ name: 'local', endpoint: 'npipe://docker_engine', current: true, canStartDesktop: true }, { name: 'remote', endpoint: 'ssh://test', current: false, canStartDesktop: false }];
        if (command === 'docker_start_desktop') {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (scenario === 'engine-start-fails') throw 'DOCKER_DESKTOP_START_FAILED: example startup failure';
          w.dockerFail = false; return;
        }
        if (command === 'docker_snapshot') {
          if (w.dockerFail) throw 'DOCKER_ENGINE_UNAVAILABLE';
          if (scenario === 'delayed' && args.context === 'local') await new Promise(resolve => setTimeout(resolve, 700));
          return { context: args.context, complete: scenario !== 'partial', warnings: scenario === 'partial' ? ['volume: denied'] : [],
            images: [{ id: 'img', name: 'postgres:16', project: '', detail: '248 MB' }], volumes: [{ id: 'data', name: 'app_data', project: 'app', detail: '/docker/volumes/data' }, { id: 'old', name: 'old_volume', project: 'old-project', detail: '' }], networks: [{ id: 'net', name: 'app_default', project: 'app', detail: 'bridge' }],
            containers: [{ id, name: args.context === 'remote' ? 'remote-db' : 'local-db', imageId: 'img', image: 'postgres:16', project: 'app', service: 'db', state: 'running', health: '', exitCode: 0, oom: false, error: '', finishedAt: '', restartCount: 2, healthOutput: '', networkMode: 'app_default', ports: [{ privatePort: '5432/tcp', hostIp: '127.0.0.1', hostPort: '15432' }, { privatePort: '80/tcp', hostIp: '', hostPort: '' }], mounts: [{ kind: 'volume', name: 'data', source: '/docker/data', target: '/data', rw: true }, { kind: 'bind', name: '', source: '/host/uploads', target: '/app/uploads', rw: false }], networks: [{ id: 'net', name: 'app_default', ip: '172.18.0.2' }] }] };
        }
        if (command === 'docker_logs_start') {
          args.onEvent.onmessage({ subscription: args.subscription, lines: ['2026-10-25 ready', 'ERROR example diagnostic'], truncated: false, done: false, error: null });
          if (scenario === 'slow-log') await new Promise(resolve => setTimeout(resolve, 400));
          return;
        }
        if (command === 'docker_action') return;
        if (command === 'docker_logs_stop') return;
        if (command === 'credential_status') return { supported: true, saved: false, available: false };
        if (command === 'plugin:event|listen') return 1;
        return;
      },
    } });
  }, { scenario, id });
  await page.goto('/');
  await page.getByRole('button', { name: 'Docker', exact: true }).click();
}
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).calls.filter((c: any) => c.command === command), command);
async function expectAllLogsStopped(page: Page) {
  const started = (await calls(page, 'docker_logs_start')).map((c: any) => c.args.subscription).sort();
  expect(started.length).toBeGreaterThan(0);
  // React StrictMode probes an extra subscription; every owned ID must be stopped exactly once.
  await expect.poll(async () => (await calls(page, 'docker_logs_stop')).map((c: any) => c.args.subscription).sort()).toEqual(started);
}
async function selectDb(page: Page, name = 'local-db') { await page.locator('.docker-node').filter({ has: page.locator('strong', { hasText: name }) }).click(); }

test('project graph explains port/storage relationships and unknown health without inventing an exposed port', async ({ page }) => {
  await setup(page); await selectDb(page);
  const details = page.locator('.docker-details');
  await expect(details).toContainText('헬스체크 미설정');
  await expect(details).toContainText('127.0.0.1:15432 → 5432/tcp');
  await expect(details).toContainText('80/tcp · 호스트 미공개');
  await expect(details).toContainText('/host/uploads'); await expect(details).toContainText('읽기 전용');
  await expect(page.locator('.docker-logs')).toContainText('ready');
  await expect(page.locator('.docker-node.kind-port')).toHaveCount(1);
  await page.getByRole('button', { name: 'old-project' }).click();
  await expect(page.locator('.docker-node.kind-volume')).toContainText('old_volume');
  await expectAllLogsStopped(page);
});

test('starts local Docker Desktop once and loads the graph when ready', async ({ page }) => {
  await setup(page, 'engine-off');
  const start = page.getByRole('button', { name: 'Docker 켜기', exact: true });
  await expect(start).toBeVisible(); await start.click();
  await expect(page.getByRole('button', { name: 'Docker 시작 중…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Docker 연결 대상')).toBeDisabled();
  await expect(page.locator('.docker-node.kind-container')).toContainText('local-db');
  expect((await calls(page, 'docker_start_desktop')).map((c: any) => c.args)).toEqual([{ context: 'local' }]);
  await expect(start).toHaveCount(0);
});

test('does not offer local engine startup for a remote context', async ({ page }) => {
  await setup(page, 'engine-off');
  await expect(page.getByRole('button', { name: 'Docker 켜기', exact: true })).toBeVisible();
  await page.getByLabel('Docker 연결 대상').selectOption('remote');
  await expect(page.getByRole('alert')).toContainText('Docker 엔진에 연결할 수 없습니다');
  await expect(page.getByRole('button', { name: 'Docker 켜기', exact: true })).toHaveCount(0);
});

test('startup errors restore the button and remain visible', async ({ page }) => {
  await setup(page, 'engine-start-fails');
  await page.getByRole('button', { name: 'Docker 켜기', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('example startup failure');
  await expect(page.getByRole('button', { name: 'Docker 켜기', exact: true })).toBeEnabled();
  expect(await calls(page, 'docker_start_desktop')).toHaveLength(1);
});

test('mutations require confirmation and preserve exact context and ID', async ({ page }) => {
  await setup(page); await selectDb(page);
  await page.locator('.docker-details').getByRole('button', { name: '재시작', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('local / local-db');
  expect(await calls(page, 'docker_action')).toHaveLength(0);
  await page.getByRole('alertdialog').getByRole('button', { name: 'restart', exact: true }).click();
  await expect.poll(async () => (await calls(page, 'docker_action')).length).toBe(1);
  expect((await calls(page, 'docker_action'))[0].args).toEqual({ context: 'local', id, action: 'restart' });
});

test('hiding the area stops a subscription even if startup completes late', async ({ page }) => {
  await setup(page, 'slow-log'); await selectDb(page);
  await expect(page.locator('.docker-logs')).toContainText('ready');
  await page.getByRole('button', { name: '데이터베이스', exact: true }).click();
  await expectAllLogsStopped(page);
  const before = (await calls(page, 'docker_snapshot')).length;
  await page.waitForTimeout(5200);
  expect(await calls(page, 'docker_snapshot')).toHaveLength(before);
});

test('context changes discard late responses and scope subsequent requests', async ({ page }) => {
  await setup(page, 'delayed');
  await page.getByLabel('Docker 연결 대상').selectOption('remote');
  await expect(page.locator('.docker-node.kind-container')).toContainText('remote-db');
  await expect(page.locator('.docker-node.kind-container')).not.toContainText('local-db');
  await selectDb(page, 'remote-db');
  expect((await calls(page, 'docker_logs_start')).at(-1).args.context).toBe('remote');
});

test('partial and stale snapshots cannot enable mutations', async ({ page }) => {
  await setup(page, 'partial'); await selectDb(page);
  await expect(page.locator('.docker-details').getByRole('button', { name: '중지', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).dockerFail = true; });
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('마지막 조회 결과');
  await expect(page.locator('.docker-details').getByRole('button', { name: '재시작', exact: true })).toBeDisabled();
});

test('reloading context list cannot clear an engine failure and re-enable actions', async ({ page }) => {
  await setup(page); await selectDb(page);
  await page.evaluate(() => { (window as any).dockerFail = true; });
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('마지막 조회 결과');
  await page.getByRole('button', { name: '연결 목록 새로고침' }).click();
  await expect(page.locator('.docker-details').getByRole('button', { name: '재시작', exact: true })).toBeDisabled();
});

test('filtering and panning preserve the position of a hidden dragged node', async ({ page }) => {
  await setup(page);
  const node = page.locator('.react-flow__node').filter({ has: page.locator('.docker-node.kind-container') });
  const box = await node.boundingBox();
  if (!box) throw new Error('Node missing');
  await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + 80, { steps: 10 }); await page.mouse.up();
  const position = await node.evaluate(el => (el as HTMLElement).style.transform);
  await page.getByLabel('리소스 검색', { exact: true }).fill('postgres:16');
  await expect(node).toHaveCount(0);
  const canvas = await page.locator('.react-flow__pane').boundingBox();
  if (!canvas) throw new Error('Canvas missing');
  await page.mouse.move(canvas.x + 35, canvas.y + 100); await page.mouse.down();
  await page.mouse.move(canvas.x + 65, canvas.y + 130, { steps: 5 }); await page.mouse.up();
  await page.getByLabel('리소스 검색', { exact: true }).fill('');
  await expect.poll(() => node.evaluate(el => (el as HTMLElement).style.transform)).toBe(position);
});

test('browser demo is explicit and works in English and light mode', async ({ page }, testInfo) => {
  await page.addInitScript(() => { localStorage.setItem('woojoo-language', 'en'); localStorage.setItem('woojoo-theme', 'light'); });
  await page.goto('/'); await page.getByRole('button', { name: 'Docker', exact: true }).click();
  // Language preference key is owned by the app; choose either localized label.
  await page.getByRole('button', { name: /데모 관계도 보기|View demo topology/ }).click();
  await expect(page.locator('.docker-banner')).toContainText(/데모 데이터|Demo data/);
  await expect(page.locator('.docker-node.kind-container')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('heading', { name: 'Resource details' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('docker-light.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /Switch to dark mode/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#docker-sidebar').getByRole('button', { name: /Standalone/ })).toHaveCSS('color', 'rgb(237, 237, 238)');
  await page.screenshot({ path: testInfo.outputPath('docker-dark.png'), animations: 'disabled' });
});
