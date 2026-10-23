import { chooseOption } from './select-control';
import { test, expect, type Page } from './fixtures';

async function mock(page: Page, scenario = 'normal') {
  await page.addInitScript(({ scenario }) => {
    (window as any).calls = [];
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
        return ({ vpcs: { Vpcs: [{ VpcId: 'vpc-1', CidrBlock: '10.0.0.0/16' }] }, subnets: { Subnets: [{ SubnetId: 'subnet-1', VpcId: 'vpc-1', AvailabilityZone: 'ap-northeast-2a', CidrBlock: '10.0.1.0/24' }] }, instances: { Reservations: [{ Instances: ec2 }] }, databases: { DBInstances: rds }, loadBalancers: { LoadBalancers: [] }, targetGroups: { TargetGroups: [] }, buckets: { Buckets: [] } } as any)[kind] ?? {};
      }
      if (command === 'aws_prepare_action') return { review: 'r1', account: '123456789012', phrase: args.query.resource, command: 'aws ec2 stop-instances --cli-input-json \'{"InstanceIds":["i-web"]}\'' };
      if (command === 'aws_run_action') return {};
      if (command === 'aws_cancel' || command === 'aws_cancel_action') return;
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

test('AWS area lists resources, opens details and keeps database state', async ({ page }) => {
  await mock(page);
  const sidebar = page.locator('#aws-sidebar');
  await expect(sidebar.getByText('123456789012')).toBeVisible();
  await expect(sidebar.getByLabel('AWS 리전')).toHaveValue('ap-northeast-2');
  await sidebar.getByRole('button', { name: 'EC2 인스턴스' }).click();
  const grid = page.locator('.aws-grid');
  await expect(grid.getByText('web-1')).toBeVisible();
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

test('write actions need a review and the typed resource name', async ({ page }) => {
  await mock(page);
  await page.locator('#aws-sidebar').getByRole('button', { name: 'EC2 인스턴스' }).click();
  await page.locator('.aws-grid').getByText('web-1').dblclick();
  await page.getByRole('button', { name: '작업', exact: true }).click();
  await page.getByRole('button', { name: '중지…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '검토' }).click();
  await expect(dialog.getByText('123456789012', { exact: false })).toBeVisible();
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
