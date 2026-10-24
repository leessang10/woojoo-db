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
        if (command === 'compose_list') return scenario.startsWith('compose') ? [{ id: 'compose-1', context: 'local', name: 'app', path: 'C:/projects/app/compose.yml' }] : [];
        if (command === 'compose_read' && scenario === 'compose-missing') throw 'Compose file not found';
        if (command === 'compose_read' || command === 'compose_import') return { project: { id: 'compose-1', context: 'local', name: 'app', path: 'C:/projects/app/compose.yml' }, source: w.composeSource || 'services:\n  db:\n    image: postgres:16\n' };
        if (command === 'compose_preview') return { token: 'reviewed-config', services: [{ name: 'db', image: 'postgres:16', build: false, ports: ['127.0.0.1:5432 → 5432/tcp'], volumes: ['data → /data (volume)'], depends: [], profiles: [] }], volumes: ['data'] };
        if (command === 'compose_save') { w.composeSource = args.source; return { project: { id: 'compose-1', context: 'local', name: 'app', path: 'C:/projects/app/compose.yml' }, source: args.source }; }
        if (command === 'compose_create') return { project: { id: 'compose-new', context: args.context, name: args.name, path: 'C:/projects/new/compose.yml' }, source: args.source };
        if (command === 'compose_action') { if (scenario === 'compose-fail') throw 'Compose configuration changed. Validate and review again.'; return; }
        if (command === 'compose_forget' || command === 'docker_resource_remove') return;
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
            containers: [{ id, name: args.context === 'remote' ? 'remote-db' : 'local-db', imageId: 'img', image: 'postgres:16', project: scenario === 'standalone' ? '' : 'app', service: 'db', state: 'running', health: '', exitCode: 0, oom: false, error: '', finishedAt: '', restartCount: 2, healthOutput: '', networkMode: 'app_default', ports: [{ privatePort: '5432/tcp', hostIp: '127.0.0.1', hostPort: '15432' }, { privatePort: '80/tcp', hostIp: '', hostPort: '' }], mounts: [{ kind: 'volume', name: 'data', source: '/docker/data', target: '/data', rw: true }, { kind: 'bind', name: '', source: '/host/uploads', target: '/app/uploads', rw: false }], networks: [{ id: 'net', name: 'app_default', ip: '172.18.0.2' }] }] };
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


test('Compose import validates before apply and preserves reviewed context and project', async ({ page }, testInfo) => {
  await setup(page);
  await page.getByRole('button', { name: 'Compose 불러오기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('C:/projects/app/compose.yml', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '검증·미리보기' }).click();
  await expect(dialog).toContainText('data → /data');
  await page.screenshot({ path: testInfo.outputPath('compose-preview.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '실행·적용', exact: true }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'up', exact: true }).click();
  await expect.poll(() => calls(page, 'compose_action')).toEqual([{ command: 'compose_action', args: { id: 'compose-1', token: 'reviewed-config', action: 'up', service: '' } }]);
});

test('Compose edit invalidates preview, saves with original source and requires another review', async ({ page }) => {
  await setup(page, 'compose');
  await page.getByRole('button', { name: 'app', exact: true }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '검증·미리보기' }).click();
  const editor = dialog.getByRole('textbox', { name: 'Compose YAML / JSON' });
  await editor.fill('services: { db: { image: "postgres:17" } }');
  await expect(dialog.getByRole('button', { name: '파일 저장', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '검증·미리보기' }).click();
  await expect(dialog.getByRole('button', { name: '실행·적용', exact: true }).first()).toBeDisabled();
  await dialog.getByRole('button', { name: '파일 저장', exact: true }).click();
  await expect(dialog).toContainText('파일을 저장했습니다');
  expect((await calls(page, 'compose_save'))[0].args.expected).toContain('postgres:16');
  expect(await calls(page, 'compose_action')).toHaveLength(0);
});

test('Compose wizard generates a persistent service and never starts it on save', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '새 프로젝트', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill('wizard-app');
  await dialog.getByRole('button', { name: '다음', exact: true }).click();
  await dialog.getByRole('button', { name: '다음', exact: true }).click();
  await dialog.getByRole('button', { name: '다음', exact: true }).click();
  await expect(dialog.locator('.compose-source-preview')).toContainText('postgres-data:/var/lib/postgresql/data');
  await dialog.getByRole('button', { name: '위치 선택·저장' }).click();
  await expect.poll(() => calls(page, 'compose_create')).toHaveLength(1);
  expect(await calls(page, 'compose_action')).toHaveLength(0);
});

test('resource removal requires confirmation and retains exact context and id', async ({ page }) => {
  await setup(page); await selectDb(page);
  await page.locator('.docker-details').getByRole('button', { name: '리소스 삭제' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('연결된 볼륨은 보존');
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(() => calls(page, 'docker_resource_remove')).toEqual([{ command: 'docker_resource_remove', args: { context: 'local', kind: 'container', id } }]);
});
test('missing Compose files can be unlinked without reading the missing source', async ({ page }) => {
  await setup(page, 'compose-missing');
  await page.getByRole('button', { name: 'app 연결 해제', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect.poll(() => calls(page, 'compose_forget')).toEqual([{ command: 'compose_forget', args: { id: 'compose-1' } }]);
  expect(await calls(page, 'compose_read')).toHaveLength(0);
});

test('independent container names can be edited without changing the target ID', async ({ page }) => {
  await setup(page, 'standalone'); await selectDb(page);
  const details = page.locator('.docker-details');
  await details.getByRole('textbox', { name: '컨테이너 이름', exact: true }).fill('renamed-db');
  await details.getByRole('button', { name: '이름 변경', exact: true }).click();
  await expect.poll(() => calls(page, 'docker_container_rename')).toEqual([{ command: 'docker_container_rename', args: { context: 'local', id, name: 'renamed-db' } }]);
});
