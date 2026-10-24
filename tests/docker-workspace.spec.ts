import { chooseOption } from './select-control';
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
        if (command === 'docker_storage_inspect') return { supported: args.context === 'local', disks: args.context === 'local' ? [{ id: 'disk-1', path: 'C:/Docker/data/docker_data.vhdx', fileBytes: 40 * 1024 ** 3, allocatedBytes: 30 * 1024 ** 3, token: 'review-token' }] : [] };
        if (command === 'docker_storage_stop') { w.dockerFail = true; return; }
        if (command === 'docker_storage_trim') return '/data: 4 GiB trimmed';
        if (command === 'docker_storage_compact') {
          if (scenario === 'storage-cancel') throw 'DOCKER_DISK_UAC_CANCELLED';
          if (scenario === 'storage-locked') throw 'DOCKER_DISK_IN_USE';
          await new Promise(resolve => setTimeout(resolve, 350));
          const before = { id: 'disk-1', path: 'C:/Docker/data/docker_data.vhdx', fileBytes: 40 * 1024 ** 3, allocatedBytes: 30 * 1024 ** 3, token: 'review-token' };
          return { before, after: { ...before, id: 'disk-2', allocatedBytes: (scenario === 'storage-zero' ? 30 : 12) * 1024 ** 3, token: 'after-token' } };
        }
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
            images: [{ id: 'img', name: 'postgres:16', project: '', detail: '248 MB' }], volumes: [{ id: 'data', name: 'app_data', project: 'app', detail: '/docker/volumes/data' }, { id: 'old', name: 'old_volume', project: 'old-project', detail: '' }], networks: [{ id: 'net', name: 'app_default', project: 'app', detail: 'bridge' }, ...(scenario === 'default-networks' ? ['bridge', 'host', 'none'].map(name => ({id:name,name,project:'',detail:name})) : [])],
            containers: [{ id, name: args.context === 'remote' ? 'remote-db' : 'local-db', imageId: 'img', image: 'postgres:16', project: scenario === 'standalone' ? '' : 'app', service: 'db', state: scenario === 'stopped' ? 'exited' : 'running', health: '', exitCode: 0, oom: false, error: '', finishedAt: '', restartCount: 2, healthOutput: '', networkMode: 'app_default', ports: [{ privatePort: '5432/tcp', hostIp: '127.0.0.1', hostPort: '15432' }, { privatePort: '80/tcp', hostIp: '', hostPort: '' }], mounts: [{ kind: 'volume', name: 'data', source: '/docker/data', target: '/data', rw: true }, { kind: 'bind', name: '', source: '/host/uploads', target: '/app/uploads', rw: false }], networks: [{ id: 'net', name: 'app_default', ip: '172.18.0.2' }] }] };
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

test('starts local Docker Desktop once and loads the graph when ready', async ({ page }, testInfo) => {
  await setup(page, 'engine-off');
  const start = page.getByRole('button', { name: 'Docker 켜기', exact: true });
  await expect(start).toBeVisible();
  await expect(page.locator('.docker-maintenance > button')).toHaveText(['디스크 공간 회수', 'Docker 켜기']);
  await expect(page.locator('.docker-workspace')).not.toContainText('Docker 엔진에 연결할 수 없습니다');
  await expect(page.locator('.docker-workspace')).not.toContainText('Docker 엔진이 실행 중인지 확인');
  await page.screenshot({path:testInfo.outputPath('docker-engine-off.png')});
  await start.click();
  await expect(page.getByRole('button', { name: 'Docker 시작 중…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Docker 연결 대상')).toBeDisabled();
  await expect(page.locator('.docker-node.kind-container')).toContainText('local-db');
  expect((await calls(page, 'docker_start_desktop')).map((c: any) => c.args)).toEqual([{ context: 'local' }]);
  await expect(start).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Docker 실행 중',exact:true})).toBeDisabled();
  await expect(page.locator('.docker-engine-dot')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('docker-engine-running.png')});
  await expect(page.getByText('Docker 엔진이 준비되었습니다. 리소스를 불러옵니다.')).toHaveCount(0);
});

test('does not offer local engine startup for a remote context', async ({ page }) => {
  await setup(page, 'engine-off');
  await expect(page.getByRole('button', { name: 'Docker 켜기', exact: true })).toBeVisible();
  await chooseOption(page.getByLabel('Docker 연결 대상'), 'remote');
  await expect(page.getByText('연결 오류', { exact: true })).toHaveCount(0);
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
  await chooseOption(page.getByLabel('Docker 연결 대상'), 'remote');
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
  await page.getByLabel('리소스 검색', { exact: true }).fill('/host/uploads');
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
  await expect(page.locator('.docker-details')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('docker-light.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /Switch to dark mode/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#docker-sidebar').getByRole('button', { name: /Standalone/ })).toHaveCSS('color', 'rgb(237, 237, 238)');
  await page.screenshot({ path: testInfo.outputPath('docker-dark.png'), animations: 'disabled' });
});


test('Compose import validates before apply and preserves reviewed context and project', async ({ page }, testInfo) => {
  await setup(page);
  await expect(page.getByRole('button', { name: 'Compose 불러오기', exact: true })).toHaveCount(0);
  await page.locator('.docker-project-heading').getByRole('button', { name: '새 프로젝트', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Compose 불러오기', exact: true }).click();
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

test('resource removal requires confirmation and retains exact context and id', async ({ page }, testInfo) => {
  await setup(page, 'stopped'); await selectDb(page);
  await page.locator('.docker-details').getByRole('button', { name: '리소스 삭제' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('연결된 볼륨은 보존');
  await page.getByRole('alertdialog').screenshot({ path: testInfo.outputPath('container-remove-copy.png') });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', {name:'삭제', exact:true})).toBeDisabled();
  await dialog.getByRole('button', {name:'삭제 잠금 해제'}).click();
  await dialog.getByLabel('삭제 대상 이름').fill('wrong');
  await expect(dialog.getByRole('button', {name:'삭제', exact:true})).toBeDisabled();
  await dialog.getByLabel('삭제 대상 이름').fill('local-db');
  await dialog.getByRole('button', {name:'다시 잠그기'}).click();
  await expect(dialog.getByRole('button', {name:'삭제', exact:true})).toBeDisabled();
  await dialog.getByRole('button', {name:'취소',exact:true}).click();
  expect(await calls(page,'docker_resource_remove')).toHaveLength(0);
  await page.locator('.docker-details').getByRole('button', { name: '리소스 삭제' }).click();
  await dialog.getByRole('button', {name:'삭제 잠금 해제'}).click();
  await dialog.getByLabel('삭제 대상 이름').fill('local-db');
  await dialog.getByRole('button', {name:'삭제', exact:true}).click();
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


test('disk reclaim reviews the selected file and reports allocated bytes rather than file length', async ({ page }, testInfo) => {
  await setup(page);
  await page.getByRole('button', { name: '디스크 공간 회수', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('파일 크기: 40.00 GiB');
  await expect(dialog).toContainText('실제 디스크 사용: 30.00 GiB');
  await dialog.getByRole('button', { name: '공간 회수', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('C:/Docker/data/docker_data.vhdx');
  await page.getByRole('alertdialog').getByRole('button', { name: '공간 회수', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeDisabled();
  await expect(dialog.locator('.storage-result')).toContainText('18.00 GiB 회수');
  expect((await calls(page, 'docker_storage_compact'))[0].args).toEqual({ context: 'local', id: 'disk-1', token: 'review-token' });
  expect(await calls(page, 'docker_resource_remove')).toHaveLength(0);
  expect(await calls(page, 'docker_storage_stop')).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('disk-reclaim.png'), animations: 'disabled' });
});

test('disk maintenance treats UAC cancellation as cancellation and allows retry', async ({ page }) => {
  await setup(page, 'storage-cancel');
  await page.getByRole('button', { name: '디스크 공간 회수', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '공간 회수', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '공간 회수', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('관리자 권한 요청을 취소했습니다');
  await expect(dialog.getByRole('button', { name: '공간 회수', exact: true })).toBeEnabled();
  await expect(dialog.locator('.storage-result')).toHaveCount(0);
});

test('stopping Docker for disk maintenance requires its own confirmation', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '디스크 공간 회수', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Docker 종료', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('실행 중인 모든 컨테이너');
  await page.getByRole('alertdialog').getByRole('button', { name: '종료', exact: true }).click();
  await expect.poll(() => calls(page, 'docker_storage_stop')).toEqual([{ command: 'docker_storage_stop', args: { context: 'local' } }]);
  expect(await calls(page, 'docker_storage_compact')).toHaveLength(0);
});

test('remote context cannot offer local disk compaction', async ({ page }) => {
  await setup(page);
  await chooseOption(page.getByRole('combobox', { name: 'Docker 연결 대상' }), 'remote');
  await page.getByRole('button', { name: '디스크 공간 회수', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('로컬 Windows Docker WSL 연결');
  await expect(dialog.getByRole('button', { name: '공간 회수', exact: true })).toHaveCount(0);
});
test('locked disks explain how to proceed and never show a success result', async ({ page }) => {
  await setup(page, 'storage-locked');
  await page.getByRole('button', { name: '디스크 공간 회수', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '공간 회수', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '공간 회수', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('디스크가 사용 중');
  await expect(dialog.locator('.storage-result')).toHaveCount(0);
});
test('zero reclaimed bytes is reported honestly after a successful compaction', async ({ page }) => {
  await setup(page, 'storage-zero');
  await page.getByRole('button', { name: '디스크 공간 회수', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '공간 회수', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '공간 회수', exact: true }).click();
  await expect(dialog.locator('.storage-result')).toContainText('0 B 회수');
  await expect(dialog.locator('.storage-result')).toContainText('실제 디스크 사용량은 줄지 않았습니다');
});

test('connection recovery stays reachable when the sidebar is collapsed', async ({ page }, testInfo) => {
  await setup(page, 'engine-off');
  await expect(page.locator('.docker-maintenance').getByRole('button', { name: 'Docker 켜기', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('docker-connection.png') });
  await page.getByRole('button', { name: '사이드바 전환' }).click();
  await expect(page.locator('#docker-sidebar')).toBeHidden();
  await page.getByRole('button', { name: '사이드바 전환' }).click();
  await page.getByRole('button', { name: 'Docker 켜기', exact: true }).click();
  await expect(page.locator('.docker-node.kind-container')).toBeVisible();
});

test('resource filter uses the shared popup and keeps deletion separate', async ({ page }, testInfo) => {
  await setup(page);
  await chooseOption(page.getByRole('combobox', { name: '리소스 종류' }), 'container');
  await expect(page.locator('.docker-node')).toHaveCount(1);
  await selectDb(page);
  await expect(page.locator('.docker-danger-zone').getByRole('button', { name: '리소스 삭제' })).toHaveAttribute('data-variant', 'destructive');
  await expect(page.locator('.docker-maintenance').getByRole('button', { name: '디스크 공간 회수' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('docker-actions.png') });
});

test('details only open for a selection and closing preserves the project', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.docker-node.kind-container')).toBeVisible();
  await expect(page.locator('.docker-details')).toHaveCount(0);
  await expect(page.locator('.docker-connection-heading').getByRole('button', { name: '연결 목록 새로고침' })).toBeVisible();
  await expect(page.locator('.docker-connection')).not.toContainText('npipe:');
  await selectDb(page);
  await expect(page.locator('.docker-details')).toBeVisible();
  await page.getByRole('button', { name: '상세 닫기' }).click();
  await expect(page.locator('.docker-details')).toHaveCount(0);
  await expect(page.locator('#docker-sidebar').getByRole('button', { name: 'app', exact: false })).toHaveAttribute('aria-pressed', 'true');
});

test('resource context menu targets the clicked node and canvas menu handles keyboard commands', async ({ page }) => {
  await setup(page);
  const container = page.locator('.docker-node.kind-container');
  await container.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '시작', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: '재시작', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('local / local-db');
  await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click();
  expect(await calls(page, 'docker_action')).toHaveLength(0);
  const canvas = page.locator('.docker-canvas');
  await canvas.focus(); await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '배치 초기화' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('project overview expands dependencies and supports focus, list and minimap controls', async ({ page }, testInfo) => {
  await setup(page);
  await page.locator('#docker-sidebar').getByRole('button', { name: '전체 리소스', exact: true }).click();
  await expect(page.locator('.docker-project-group')).not.toHaveCount(0);
  await expect(page.locator('.docker-node.kind-image')).toHaveCount(0);
  await page.getByRole('button', { name: 'app 리소스 펼치기', exact: true }).click();
  await expect(page.locator('.docker-node.kind-image')).toBeVisible();
  await page.getByRole('button', { name: '미니맵', exact: true }).click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('docker-overview.png') });
  await selectDb(page);
  await page.getByRole('button', { name: '연결된 항목만', exact: true }).click();
  await expect(page.locator('.docker-node').filter({ hasText: 'old_volume' })).toHaveCount(0);
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await expect(page.getByRole('button', { name: '연결된 항목만', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const table = page.getByRole('table', { name: 'Docker 리소스 목록' });
  await expect(table.getByRole('row').filter({ hasText: 'local-db' })).toHaveAttribute('aria-selected', 'true');
  await chooseOption(page.getByRole('combobox', { name: '리소스 종류' }), 'container');
  await chooseOption(page.getByRole('combobox', { name: '상태 필터' }), 'stopped');
  await expect(page.getByText('조건에 맞는 리소스가 없습니다.')).toBeVisible();
  await chooseOption(page.getByRole('combobox', { name: '상태 필터' }), 'running');
  await expect(table.getByText('local-db', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('docker-list.png') });
  await page.getByRole('button', { name: '라이트 모드로 전환' }).click();
  await expect(page.locator('#docker-sidebar').getByRole('button', { name: /^app / })).toHaveCSS('color', 'rgb(32, 33, 38)');
  await page.screenshot({ path: testInfo.outputPath('docker-list-light.png'), animations: 'disabled' });
  await table.getByRole('row').filter({ hasText: 'local-db' }).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '로그 보기' })).toBeVisible();
});

test('resource menus do not enable mutations on incomplete snapshots', async ({ page }) => {
  await setup(page, 'partial');
  await page.locator('.docker-node.kind-container').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '재시작', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: '리소스 삭제', exact: true })).toBeDisabled();
  expect(await calls(page, 'docker_action')).toHaveLength(0);
});

test('context deletion uses the clicked volume instead of the selected container', async ({ page }) => {
  await setup(page); await selectDb(page);
  await page.getByRole('button', { name: '화면 맞춤', exact: true }).click();
  await page.locator('.docker-node.kind-volume').click({ button: 'right' });
  const remove = page.getByRole('menuitem', { name: '리소스 삭제', exact: true });
  await expect(remove).toHaveAttribute('data-variant', 'destructive');
  await expect(remove).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'old-project'}).click();
  await page.locator('.docker-node.kind-volume').click({button:'right'});
  await page.getByRole('menuitem', {name:'리소스 삭제',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toContainText('볼륨 안의 데이터가 영구 삭제됩니다.');
  await page.getByRole('button',{name:'삭제 잠금 해제'}).click();
  await page.getByLabel('삭제 대상 이름').fill('old_volume');
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(() => calls(page, 'docker_resource_remove')).toEqual([{ command: 'docker_resource_remove', args: { context: 'local', kind: 'volume', id: 'old' } }]);
});

test('Docker list headers cycle sorting and restore resource order', async ({ page }) => {
 await setup(page);
 await page.getByRole('button',{name:'목록',exact:true}).click();
 const table=page.getByRole('table',{name:'Docker 리소스 목록'});
 const original=await table.locator('tbody tr').allTextContents();
 expect(original.length).toBeGreaterThan(1);
 const header=table.getByRole('columnheader').first();
 await header.click(); await expect(header).toHaveAttribute('aria-sort','ascending');
 await header.click(); await expect(header).toHaveAttribute('aria-sort','descending');
 await header.click(); await expect(header).toHaveAttribute('aria-sort','none');
 expect(await table.locator('tbody tr').allTextContents()).toEqual(original);
});

test('default networks are labeled and cannot be removed from details or menus', async ({page},testInfo)=>{
 await setup(page,'default-networks');
 await page.locator('#docker-sidebar').getByRole('button',{name:'전체 리소스',exact:true}).click();
 await page.getByRole('button',{name:'목록',exact:true}).click();
 const table=page.getByRole('table',{name:'Docker 리소스 목록'});
 for(const name of ['bridge','host','none']){
  const row=table.getByRole('row').filter({has:page.getByRole('cell',{name,exact:true})});
  await expect(row).toContainText('기본 네트워크');
  await row.click();
  await expect(page.locator('.docker-details')).toContainText('기본 네트워크 · 삭제 불가');
  await expect(page.locator('.docker-details').getByRole('button',{name:'리소스 삭제'})).toBeDisabled();
  await row.click({button:'right'});
  await expect(page.getByRole('menuitem',{name:'리소스 삭제'})).toBeDisabled();
  await page.keyboard.press('Escape');
 }
 const custom=table.getByRole('row').filter({has:page.getByRole('cell',{name:'app_default',exact:true})});
 await custom.click();
 await expect(page.locator('.docker-details').getByRole('button',{name:'리소스 삭제'})).toBeDisabled();
 expect(await calls(page,'docker_resource_remove')).toHaveLength(0);
 await table.getByRole('cell',{name:'none',exact:true}).click();
 await page.screenshot({path:testInfo.outputPath('default-networks.png')});
});

for(const language of ['ko','en']) for(const theme of ['dark','light']) test('deletion layout '+language+' '+theme,async({page},testInfo)=>{
 await page.setViewportSize({width:960,height:640});
 await page.addInitScript(({language,theme})=>{localStorage.setItem('woojoo-language',language);localStorage.setItem('woojoo-theme',theme);},{language,theme});
 await setup(page,'stopped');await selectDb(page);
 const ko=language==='ko';
 await page.locator('.docker-details').getByRole('button',{name:ko?'리소스 삭제':'Delete resource',exact:true}).click();
 const dialog=page.getByRole('alertdialog');
 await dialog.getByRole('button',{name:ko?'삭제 잠금 해제':'Unlock deletion'}).click();
 await dialog.getByLabel(ko?'삭제 대상 이름':'Deletion target name').fill('local-db');
 const execute=dialog.getByRole('button',{name:ko?'삭제':'Delete',exact:true});
 await expect(execute).toBeEnabled();
 const box=await execute.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(640);
 await page.screenshot({path:testInfo.outputPath('delete.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:ko?'취소':'Cancel',exact:true}).click();
 expect(await calls(page,'docker_resource_remove')).toHaveLength(0);
});
