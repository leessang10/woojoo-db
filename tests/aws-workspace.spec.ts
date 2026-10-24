import { chooseOption } from './select-control';
import { test, expect, type Page } from './fixtures';

async function mock(page: Page, scenario = 'normal') {
  await page.addInitScript(({ scenario }) => {
    (window as any).calls = [];
    if (scenario === 'actions') localStorage.setItem('woojoo-settings-v1', JSON.stringify({ awsActions: true }));
    const ec2 = [{ InstanceId: 'i-web', Tags: [{ Key: 'Name', Value: 'web-1' }], State: { Name: 'running' }, InstanceType: 't3.small', Placement: { AvailabilityZone: 'ap-northeast-2a' }, PrivateIpAddress: '10.0.1.5', VpcId: 'vpc-1', SubnetId: 'subnet-1' },
      { InstanceId: 'i-batch', Tags: [{ Key: 'Name', Value: 'batch' }], State: { Name: 'stopped' }, InstanceType: 't3.micro', Placement: { AvailabilityZone: 'ap-northeast-2c' }, VpcId: 'vpc-1', SubnetId: 'subnet-1' }];
    const rds = [{ DBInstanceIdentifier: 'app-db', DBInstanceStatus: 'available', Engine: 'postgres', EngineVersion: '16.4', DBInstanceClass: 'db.t3.micro', AvailabilityZone: 'ap-northeast-2a', Endpoint: { Address: 'app.example.rds.amazonaws.com', Port: 5432 }, DBName: 'app', MasterUsername: 'admin', DBSubnetGroup: { VpcId: 'vpc-1' } }];
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke: async (command: string, args: any) => {
      (window as any).calls.push({ command, args });
      if (command === 'credential_status') return { supported: true, saved: false, available: false };
      if (command === 'aws_cli_info') return { installed: true, version: 'aws-cli/2.17.0 Python/3', profiles: ['default', 'prod'] };
      if (command === 'aws_environment') return { account: args.profile === 'prod' ? '999999999999' : '123456789012', arn: 'arn:aws:iam::123456789012:user/test', region: 'ap-northeast-2', regions: ['ap-northeast-2', 'us-east-1'], regionsWarning: null };
      if (command === 'aws_list_resources') {
        const { service, nextToken } = args.query;
        if (scenario === 'expired') throw 'AWS_AUTH_REQUIRED';
        if (service === 'ec2') return nextToken ? { rows: [{ InstanceId: 'i-more', State: { Name: 'running' } }], nextToken: null } : { rows: ec2, nextToken: 'page-2' };
        if (service === 'rds') return { rows: rds, nextToken: null };
        if (service === 's3') return { rows: [{ Name: 'assets', CreationDate: '2026-09-12T09:00:00Z', BucketRegion: 'ap-northeast-2' }], nextToken: null };
        return { rows: [{ logGroupName: '/aws/lambda/api', retentionInDays: 30, storedBytes: 2048 }], nextToken: null };
      }
      if (command === 'aws_browse_resources') {
        const q = args.query;
        if (q.kind === 'objects') return q.prefix ? { rows: [{ kind: 'file', Key: q.prefix + 'logo.png', Size: 2048, StorageClass: 'STANDARD' }], nextToken: null } : { rows: [{ kind: 'folder', Prefix: 'images/' }, { kind: 'file', Key: 'index.html', Size: 512 }], nextToken: null };
        return { rows: [{ eventId: 'e1', timestamp: 1789000000000, logStreamName: 'stream-a', message: 'request done' }], nextToken: null };
      }
      if (command === 'aws_topology_query') {
        const kind = args.query.kind;
        if (scenario === 'progressive' && ['databases', 'buckets'].includes(kind)) {
          await new Promise<void>(resolve => { (window as any).releaseTopology = resolve; });
        }
        return ({ vpcs: { Vpcs: [{ VpcId: 'vpc-1', CidrBlock: '10.0.0.0/16' }] }, subnets: { Subnets: [{ SubnetId: 'subnet-1', VpcId: 'vpc-1', AvailabilityZone: 'ap-northeast-2a', CidrBlock: '10.0.1.0/24' }] }, instances: { Reservations: [{ Instances: ec2 }] }, databases: { DBInstances: rds }, loadBalancers: { LoadBalancers: [] }, targetGroups: { TargetGroups: [] }, buckets: { Buckets: [] } } as any)[kind] ?? {};
      }
      if (command === 'aws_prepare_action') return { review: 'r1', account: '123456789012', phrase: args.query.action === 'ec2Terminate' ? 'web-1' : args.query.resource, command: `aws ${args.query.action} ${args.query.resource}` };
      if (command === 'aws_run_action') return {};
      if (command === 'aws_cancel' || command === 'aws_cancel_action' || command === 'aws_set_actions_enabled' || command === 'set_result_limit') return;
      if (command === 'aws_rds_instances') return [{ id: 'app-db', engine: 'postgres', version: '16.4', status: 'available', host: 'app.example.rds.amazonaws.com', port: 5432, database: 'app', username: 'admin', public: false, supported: true }];
      if (command === 'connect_db') return 'rds-session';
      if (command === 'list_tables') return [];
      if (command === 'plugin:event|listen') return 1;
      throw new Error(command);
    } } });
  }, { scenario });
  await page.goto('/');
  await page.getByRole('button', { name: 'AWS', exact: true }).click();
}
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).calls.filter((c: any) => c.command === command), command);

for (const target of [
  { service: 'EC2 인스턴스', name: 'web-1', button: '인스턴스 종료…', action: 'ec2Terminate', id: 'i-web' },
  { service: 'CloudWatch 로그 그룹', name: '/aws/lambda/api', button: '로그 그룹 삭제…', action: 'logsDelete', id: '/aws/lambda/api' },
]) test(`${target.action} is locked and requires an exact name even on form submission`, async ({ page }) => {
  await mock(page, 'actions');
  await page.locator('#aws-sidebar').getByRole('button', { name: target.service }).click();
  await page.locator('.aws-grid').getByText(target.name, { exact: true }).dblclick();
  await page.getByRole('button', { name: '작업', exact: true }).click();
  const deletion = page.getByRole('button', { name: target.button, exact: true });
  await expect(deletion).toBeDisabled();
  expect(await calls(page, 'aws_prepare_action')).toHaveLength(0);
  await page.getByRole('button', { name: '삭제 잠금 해제' }).click();
  await expect(deletion).toBeEnabled();
  await page.getByRole('button', { name: '다시 잠그기' }).click();
  await expect(deletion).toBeDisabled();
  await page.getByRole('button', { name: '삭제 잠금 해제' }).click();
  await deletion.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('note')).toContainText('삭제하면 되돌릴 수 없습니다. 정말로 삭제하시겠습니까? 리소스 이름을 적어주세요.');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(deletion).toBeDisabled();
  await page.getByRole('button', { name: '삭제 잠금 해제' }).click();
  await deletion.click();
  await dialog.getByRole('button', { name: '검토', exact: true }).click();
  const confirm = dialog.getByRole('button', { name: '영구 삭제', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('확인 문구').fill(`${target.name} `);
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('확인 문구').press('Enter');
  // Exercise the handler as well as the disabled submit button.
  await dialog.evaluate(form => (form as HTMLFormElement).requestSubmit());
  expect(await calls(page, 'aws_run_action')).toHaveLength(0);
  await dialog.getByLabel('확인 문구').fill(target.name);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByRole('status')).toContainText('요청을 보냈습니다');
  expect((await calls(page, 'aws_prepare_action'))[0].args.query).toMatchObject({ action: target.action, resource: target.id });
  expect((await calls(page, 'aws_run_action'))[0].args).toEqual({ review: 'r1', confirmation: target.name });
  await dialog.getByRole('button', { name: '확인', exact: true }).click();
  await expect(deletion).toBeDisabled();
});

test('AWS area lists resources, opens details and keeps database state', async ({ page }) => {
  await mock(page);
  const sidebar = page.locator('#aws-sidebar');
  await expect(sidebar.getByRole('heading', { name: 'AWS', exact: true })).toBeVisible();
  await expect(sidebar.getByText('123456789012')).toBeVisible();
  await expect(page.locator('#aws-panel')).toHaveCount(0);
  await expect(sidebar.getByLabel('AWS 리전')).toHaveValue('ap-northeast-2');
  await sidebar.getByRole('button', { name: 'EC2 인스턴스' }).click();
  const grid = page.locator('.aws-grid');
  await expect(grid.getByText('web-1')).toBeVisible();
  await expect(page.locator('#aws-panel')).toHaveCount(0);
  await expect(page.getByText('2+ 개')).toBeVisible();
  await page.getByRole('button', { name: '더 불러오기' }).click();
  await expect(grid.getByText('i-more')).toBeVisible();
  await page.getByLabel('상태 필터').click(); await page.getByRole('option', { name: 'stopped' }).click();
  await expect(grid.getByText('web-1')).toHaveCount(0);
  await grid.getByText('batch').click();
  await expect(page.locator('#aws-panel h2')).toHaveText('batch');
  await grid.getByText('batch').dblclick();
  await expect(page.getByRole('tab', { name: /batch/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.aws-detail-heading h1')).toHaveText('batch');
  // The database area keeps its own sidebar and tabs.
  await page.getByRole('button', { name: '데이터베이스', exact: true }).click();
  await expect(page.locator('#database-sidebar')).toBeVisible();
  await expect(page.locator('#aws-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: 'AWS', exact: true }).click();
  await expect(page.getByRole('tab', { name: /batch/ })).toHaveAttribute('aria-selected', 'true');
  const listCalls = await calls(page, 'aws_list_resources');
  expect(listCalls[0].args.query).toMatchObject({ service: 'ec2', profile: 'default', region: 'ap-northeast-2' });
});

test('S3 and CloudWatch Logs details browse objects and events', async ({ page }) => {
  await mock(page);
  await page.locator('#aws-sidebar').getByRole('button', { name: 'S3 버킷' }).click();
  await page.locator('.aws-grid').getByText('assets').dblclick();
  await page.locator('.aws-grid').getByText('images/').click();
  await expect(page.locator('.aws-grid').getByText('logo.png')).toBeVisible();
  await page.locator('#aws-sidebar').getByRole('button', { name: 'CloudWatch 로그 그룹' }).click();
  await page.locator('.aws-grid').getByText('/aws/lambda/api').dblclick();
  await expect(page.getByText('request done')).toBeVisible();
  const browse = await calls(page, 'aws_browse_resources');
  expect(browse.some((c: any) => c.args.query.kind === 'objects' && c.args.query.prefix === 'images/')).toBe(true);
  expect(browse.find((c: any) => c.args.query.kind === 'events').args.query).toMatchObject({ resource: '/aws/lambda/api' });
});

test('AWS changes stay hidden until Settings allows them', async ({ page }) => {
  await mock(page);
  await page.locator('#aws-sidebar').getByRole('button', { name: 'EC2 인스턴스' }).click();
  await page.locator('.aws-grid').getByText('web-1').dblclick();
  await page.getByRole('button', { name: '작업', exact: true }).click();
  await expect(page.getByText('AWS 변경 작업이 꺼져 있습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '중지…' })).toHaveCount(0);
  await page.keyboard.press('Control+,');
  await page.getByRole('dialog').getByLabel('AWS 변경 작업 허용').check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '중지…' })).toBeVisible();
  expect((await calls(page, 'aws_set_actions_enabled')).at(-1).args).toEqual({ enabled: true });
});

test('write actions need a review and the typed resource name', async ({ page }, testInfo) => {
  await mock(page, 'actions');
  await page.locator('#aws-sidebar').getByRole('button', { name: 'EC2 인스턴스' }).click();
  await page.locator('.aws-grid').getByText('web-1').dblclick();
  await page.getByRole('button', { name: '작업', exact: true }).click();
  await page.getByRole('button', { name: '중지…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '검토' }).click();
  await expect(dialog.getByText('123456789012', { exact: false })).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('aws-review-copy.png') });
  const run = dialog.getByRole('button', { name: '실행' });
  await expect(run).toBeDisabled();
  await dialog.getByLabel('확인 문구').fill('i-wrong');
  await expect(run).toBeDisabled();
  await dialog.getByLabel('확인 문구').fill('i-web');
  await run.click();
  await expect(dialog.getByRole('status')).toContainText('요청을 보냈습니다');
  expect((await calls(page, 'aws_prepare_action'))[0].args.query).toMatchObject({ action: 'ec2Stop', resource: 'i-web', profile: 'default' });
  expect((await calls(page, 'aws_run_action'))[0].args).toEqual({ review: 'r1', confirmation: 'i-web' });
});

test('RDS detail opens the connection dialog with the instance selected', async ({ page }) => {
  await mock(page);
  await page.locator('#aws-sidebar').getByRole('button', { name: 'RDS 데이터베이스' }).click();
  await page.locator('.aws-grid').getByText('app-db').click();
  await page.locator('#aws-panel').getByRole('button', { name: 'DB 연결' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'app-db' })).toBeChecked();
  await expect(dialog.getByLabel('호스트', { exact: true })).toHaveValue('app.example.rds.amazonaws.com');
  await dialog.getByRole('button', { name: '연결하기', exact: true }).click();
  await expect(page.locator('#database-sidebar .connection-name')).toContainText('app-db (ap-northeast-2)');
});

for (const stopEarly of [true, false]) test(`infrastructure map streams results and preserves viewport on ${stopEarly ? 'stop' : 'completion'}`, async ({ page }) => {
  await mock(page, 'progressive');
  await page.locator('#aws-sidebar').getByRole('button', { name: '인프라 맵' }).click();
  await expect(page.locator('.react-flow__node').filter({ hasText: 'web-1' })).toBeVisible();
  await expect(page.locator('.aws-count')).toContainText('수집 중');
  const viewport = page.locator('.react-flow__viewport');
  await expect(viewport).not.toHaveAttribute('style', /translate\(0px,0px\) scale\(1\)/);
  const canvas = await page.locator('.react-flow__pane').boundingBox();
  await page.mouse.move(canvas!.x + 30, canvas!.y + 30);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + 110, canvas!.y + 90, { steps: 5 });
  await page.mouse.up();
  await page.locator('.react-flow__controls-zoomin').click();
  // Let the user-initiated zoom animation settle before comparing transforms.
  await page.waitForTimeout(400);
  const transform = await viewport.evaluate(el => (el as HTMLElement).style.transform);
  await page.evaluate(() => (window as any).releaseTopology());
  await expect(page.locator('.react-flow__node').filter({ hasText: 'app-db' })).toHaveCount(1);
  expect(await viewport.evaluate(el => (el as HTMLElement).style.transform)).toBe(transform);
  if (stopEarly) await page.getByRole('button', { name: '중지', exact: true }).click();
  await page.evaluate(() => (window as any).releaseTopology());
  await expect(page.locator('.aws-count')).toContainText('EC2 2');
  await expect(page.locator('.react-flow__node').filter({ hasText: 'app-db' })).toHaveCount(1);
  expect(await viewport.evaluate(el => (el as HTMLElement).style.transform)).toBe(transform);
});

test('infrastructure map draws VPC, subnet and resources', async ({ page }) => {
  await mock(page);
  await page.locator('#aws-sidebar').getByRole('button', { name: '인프라 맵' }).click();
  await expect(page.locator('.react-flow__node').filter({ hasText: 'web-1' })).toBeVisible();
  await expect(page.locator('.react-flow__node.infra-vpc')).toBeVisible();
  await expect(page.locator('.react-flow__node.infra-subnet')).toBeVisible();
  await expect(page.locator('.aws-count')).toContainText('EC2 2');
});

test('expired SSO credentials show the sign-in command', async ({ page }) => {
  await mock(page, 'expired');
  await page.locator('#aws-sidebar').getByRole('button', { name: 'EC2 인스턴스' }).click();
  await expect(page.getByRole('alert')).toContainText('인증이 만료');
  await expect(page.getByRole('alert')).toContainText("aws sso login --profile 'default'");
});

test('AWS headers cycle sorting and restore resource order', async ({ page }) => {
 await mock(page);
 await page.locator('#aws-sidebar').getByRole('button', { name: 'EC2 인스턴스' }).click();
 const table=page.locator('.aws-grid');
 await expect(table.locator('tbody tr')).toHaveCount(2);
 const original=await table.locator('tbody tr').allTextContents();
 const header=table.getByRole('columnheader').first();
 await header.click(); await expect(header).toHaveAttribute('aria-sort','ascending');
 await expect(table.locator('tbody tr').first()).toContainText('batch');
 await header.click(); await expect(header).toHaveAttribute('aria-sort','descending');
 await header.click(); await expect(header).toHaveAttribute('aria-sort','none');
 expect(await table.locator('tbody tr').allTextContents()).toEqual(original);
});
