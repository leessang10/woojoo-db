import type { AwsRow, AwsService } from '../aws';
import { matchesProduction } from '../settings';

export const AWS_SERVICES: AwsService[] = ['ec2', 'rds', 's3', 'logs'];
export const serviceLabel: Record<AwsService, [string, string]> = {
  ec2: ['EC2 인스턴스', 'EC2 instances'],
  rds: ['RDS 데이터베이스', 'RDS databases'],
  s3: ['S3 버킷', 'S3 buckets'],
  logs: ['CloudWatch 로그 그룹', 'CloudWatch log groups'],
};
export const serviceShort: Record<AwsService, string> = { ec2: 'EC2', rds: 'RDS', s3: 'S3', logs: 'Logs' };
export const columnLabels: Record<AwsService, [string, string][]> = {
  ec2: [['이름', 'Name'], ['상태', 'State'], ['유형', 'Type'], ['가용 영역', 'Zone'], ['IP', 'IP']],
  rds: [['식별자', 'Identifier'], ['상태', 'State'], ['엔진', 'Engine'], ['클래스', 'Class'], ['가용 영역', 'Zone']],
  s3: [['버킷', 'Bucket'], ['리전', 'Region'], ['생성일', 'Created']],
  logs: [['로그 그룹', 'Log group'], ['보존 기간', 'Retention'], ['저장 용량', 'Stored'], ['생성일', 'Created']],
};
/** Services whose second column is a state worth filtering on. */
export const hasState = (service: AwsService) => service === 'ec2' || service === 'rds';

const tagName = (row: AwsRow) => row.Tags?.find((tag: AwsRow) => tag.Key === 'Name')?.Value as string | undefined;
export function resourceId(service: AwsService, row: AwsRow): string {
  const id = service === 'ec2' ? row.InstanceId : service === 'rds' ? row.DBInstanceIdentifier : service === 's3' ? row.Name : row.logGroupName;
  return String(id ?? JSON.stringify(row));
}
export function resourceName(service: AwsService, row: AwsRow) {
  return service === 'ec2' ? tagName(row) || row.InstanceId : resourceId(service, row);
}
export const formatDate = (value: unknown, language: string) => value ? new Date(value as string | number).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US') : '—';
export function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'], power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}
/** Display cells for a list row, in `columnLabels` order. */
export function cells(service: AwsService, row: AwsRow, language: string): string[] {
  const date = (value: unknown) => value ? new Date(value as string | number).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US') : '—';
  if (service === 'ec2') return [resourceName(service, row), row.State?.Name ?? 'unknown', row.InstanceType ?? '—', row.Placement?.AvailabilityZone ?? '—', row.PublicIpAddress || row.PrivateIpAddress || '—'];
  if (service === 'rds') return [row.DBInstanceIdentifier, row.DBInstanceStatus ?? '—', `${row.Engine ?? ''} ${row.EngineVersion ?? ''}`.trim() || '—', row.DBInstanceClass ?? '—', row.AvailabilityZone ?? '—'];
  if (service === 's3') return [row.Name, row.BucketRegion || '—', date(row.CreationDate)];
  return [row.logGroupName, row.retentionInDays ? (language === 'ko' ? `${row.retentionInDays}일` : `${row.retentionInDays} days`) : (language === 'ko' ? '만료 없음' : 'Never expire'), formatBytes(row.storedBytes ?? 0), date(row.creationTime)];
}
/** Key facts for the quick-detail panel and the overview tab. */
export function facts(service: AwsService, row: AwsRow, language: string): [string, string, string][] {
  const ko = language === 'ko';
  const list: [string, string, unknown][] = service === 'ec2' ? [
    ['인스턴스 ID', 'Instance ID', row.InstanceId], ['상태', 'State', row.State?.Name], ['유형', 'Type', row.InstanceType],
    ['가용 영역', 'Zone', row.Placement?.AvailabilityZone], ['사설 IP', 'Private IP', row.PrivateIpAddress], ['공인 IP', 'Public IP', row.PublicIpAddress],
    ['VPC', 'VPC', row.VpcId], ['서브넷', 'Subnet', row.SubnetId], ['이미지', 'Image', row.ImageId], ['키 페어', 'Key pair', row.KeyName],
    ['보안 그룹', 'Security groups', row.SecurityGroups?.map((group: AwsRow) => group.GroupName ?? group.GroupId).join(', ')],
    ['시작 시각', 'Launched', row.LaunchTime && formatDate(row.LaunchTime, language)],
  ] : service === 'rds' ? [
    ['식별자', 'Identifier', row.DBInstanceIdentifier], ['상태', 'Status', row.DBInstanceStatus], ['엔진', 'Engine', `${row.Engine ?? ''} ${row.EngineVersion ?? ''}`.trim()],
    ['클래스', 'Class', row.DBInstanceClass], ['엔드포인트', 'Endpoint', row.Endpoint?.Address && `${row.Endpoint.Address}:${row.Endpoint.Port}`],
    ['데이터베이스', 'Database', row.DBName], ['마스터 사용자', 'Master user', row.MasterUsername], ['다중 AZ', 'Multi-AZ', row.MultiAZ === undefined ? undefined : row.MultiAZ ? (ko ? '예' : 'Yes') : (ko ? '아니요' : 'No')],
    ['공개 접근', 'Public access', row.PubliclyAccessible === undefined ? undefined : row.PubliclyAccessible ? (ko ? '허용' : 'Allowed') : (ko ? '차단' : 'Blocked')],
    ['스토리지', 'Storage', row.AllocatedStorage && `${row.AllocatedStorage} GiB ${row.StorageType ?? ''}`.trim()], ['VPC', 'VPC', row.DBSubnetGroup?.VpcId],
    ['백업 보존', 'Backup retention', row.BackupRetentionPeriod !== undefined && (ko ? `${row.BackupRetentionPeriod}일` : `${row.BackupRetentionPeriod} days`)],
  ] : service === 's3' ? [
    ['버킷', 'Bucket', row.Name], ['리전', 'Region', row.BucketRegion], ['생성일', 'Created', row.CreationDate && formatDate(row.CreationDate, language)],
  ] : [
    ['로그 그룹', 'Log group', row.logGroupName], ['보존 기간', 'Retention', row.retentionInDays ? (ko ? `${row.retentionInDays}일` : `${row.retentionInDays} days`) : (ko ? '만료 없음' : 'Never expire')],
    ['저장 용량', 'Stored', formatBytes(row.storedBytes ?? 0)], ['클래스', 'Class', row.logGroupClass], ['ARN', 'ARN', row.arn], ['생성일', 'Created', row.creationTime && formatDate(row.creationTime, language)],
  ];
  return list.filter(([, , value]) => value !== undefined && value !== null && value !== '' && value !== false).map(([k, e, value]) => [k, e, String(value)]);
}
export const tags = (row: AwsRow): [string, string][] => (Array.isArray(row.Tags) ? row.Tags : Array.isArray(row.TagList) ? row.TagList : []).map((tag: AwsRow) => [String(tag.Key), String(tag.Value ?? '')]);

/** Appends a page, keeping rows unique and memory bounded; never truncates silently. */
export function mergeRows(previous: AwsRow[], incoming: AwsRow[], identity: (row: AwsRow) => string): AwsRow[] {
  const merged = [...new Map([...previous, ...incoming].map(row => [identity(row), row])).values()];
  if (merged.length > 5000 || JSON.stringify(merged).length > 8 * 1024 * 1024) throw new Error('AWS_RESPONSE_TOO_LARGE');
  return merged;
}
let requests = 0;
/** A process-unique id so a request can be cancelled from the UI. */
export const requestId = () => `aws-${Date.now().toString(36)}-${++requests}`;

export type AwsTab = {
  customTitle?: string;
  id: string;
  kind: 'resources' | 'resource' | 'topology';
  profile: string;
  region: string;
  service?: AwsService;
  /** Snapshot of the row a detail tab was opened from. */
  row?: AwsRow;
};
export const tabKey = (tab: Pick<AwsTab, 'kind' | 'profile' | 'region' | 'service' | 'row'>) =>
  JSON.stringify([tab.kind, tab.profile, tab.region, tab.service ?? '', tab.service && tab.row ? resourceId(tab.service, tab.row) : '']);
export function tabTitle(tab: AwsTab) {
  if (tab.customTitle) return [tab.customTitle, tab.customTitle] as [string, string];
  if (tab.kind === 'topology') return ['인프라 맵', 'Infrastructure map'] as [string, string];
  if (tab.kind === 'resource' && tab.service && tab.row) { const name = resourceName(tab.service, tab.row); return [name, name] as [string, string]; }
  const label = serviceShort[tab.service ?? 'ec2'];
  return [label, label] as [string, string];
}

const TABS_KEY = 'woojoo-aws-tabs-v1';
export function readAwsTabs(): { tabs: AwsTab[]; active: string } {
  try {
    const value = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}');
    const tabs = Array.isArray(value.tabs) ? value.tabs.filter((tab: AwsTab) => typeof tab?.id === 'string' && ['resources', 'resource', 'topology'].includes(tab.kind) && typeof tab.profile === 'string' && typeof tab.region === 'string' && (tab.kind === 'topology' || AWS_SERVICES.includes(tab.service as AwsService))) : [];
    return { tabs, active: typeof value.active === 'string' ? value.active : tabs[0]?.id ?? '' };
  } catch { return { tabs: [], active: '' }; }
}
export function writeAwsTabs(tabs: AwsTab[], active: string) {
  try { localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active })); } catch { /* Session-only tabs. */ }
}
const CONTEXT_KEY = 'woojoo-aws-context-v1';
export function readAwsContext(): { profile: string; region: string } {
  try { const value = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? '{}'); return { profile: typeof value.profile === 'string' ? value.profile : '', region: typeof value.region === 'string' ? value.region : '' }; }
  catch { return { profile: '', region: '' }; }
}
export function writeAwsContext(profile: string, region: string) {
  try { localStorage.setItem(CONTEXT_KEY, JSON.stringify({ profile, region })); } catch { /* Session-only choice. */ }
}
/** Profiles matching the Settings production words get the same warning banner as production DB connections. */
export const looksProduction = (profile: string) => matchesProduction(profile);
