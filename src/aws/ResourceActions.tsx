import { useState } from 'react';
import { AlertTriangle, Check, Loader2, LockKeyhole, UnlockKeyhole, X } from 'lucide-react';
import { ModalSurface } from '@/components/ModalSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import { awsCancelAction, awsError, awsPrepareAction, awsRunAction, type AwsAction, type AwsReview, type AwsRow, type AwsService } from '../aws';
import { resourceId, resourceName, type AwsTab } from './model';

type Field = { label: [string, string]; options?: [string, string, string][]; placeholder?: string; initial: string };
type ActionSpec = { action: AwsAction; label: [string, string]; description: [string, string]; danger?: boolean; field?: Field };
const RETENTION = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653];

/** The changes WooJoo offers per service; the backend accepts only these. */
export function actionsFor(service: AwsService, row: AwsRow): ActionSpec[] {
  if (service === 'ec2') {
    const state = row.State?.Name;
    return [
      ...(state === 'stopped' ? [{ action: 'ec2Start', label: ['시작', 'Start'], description: ['인스턴스를 시작합니다. 실행 비용이 발생합니다.', 'Starts the instance; running costs apply.'] } as ActionSpec] : []),
      ...(state === 'running' ? [
        { action: 'ec2Stop', label: ['중지', 'Stop'], description: ['서비스가 중단됩니다. 인스턴스 스토어 데이터는 손실될 수 있습니다.', 'Interrupts service. Instance store data can be lost.'] },
        { action: 'ec2Reboot', label: ['재부팅', 'Reboot'], description: ['재부팅하는 동안 서비스가 잠시 중단됩니다.', 'Service is interrupted while rebooting.'] },
      ] as ActionSpec[] : []),
      { action: 'ec2Rename', label: ['이름 변경', 'Rename'], description: ['Name 태그를 바꿉니다.', 'Changes the Name tag.'], field: { label: ['새 이름', 'New name'], initial: row.Tags?.find((tag: AwsRow) => tag.Key === 'Name')?.Value ?? '' } },
      ...(state !== 'terminated' ? [{ action: 'ec2Terminate', label: ['인스턴스 종료', 'Terminate'], danger: true, description: ['인스턴스를 영구 종료합니다. 종료 시 삭제하도록 설정된 볼륨도 삭제되며 되돌릴 수 없습니다.', 'Permanently terminates the instance and deletes volumes set to delete on termination. This cannot be undone.'] } as ActionSpec] : []),
    ];
  }
  if (service === 'rds') {
    const cluster = !!row.DBClusterIdentifier || String(row.Engine).startsWith('aurora'), status = row.DBInstanceStatus;
    return [
      ...(!cluster && status === 'stopped' ? [{ action: 'rdsStart', label: ['시작', 'Start'], description: ['DB 인스턴스를 시작합니다.', 'Starts the DB instance.'] } as ActionSpec] : []),
      ...(!cluster && status === 'available' ? [{ action: 'rdsStop', label: ['중지', 'Stop'], description: ['DB 연결이 끊깁니다. 중지된 DB는 7일 뒤 자동으로 다시 시작됩니다.', 'Drops DB connections. Stopped databases restart automatically after seven days.'] } as ActionSpec] : []),
      ...(status === 'available' ? [{ action: 'rdsReboot', label: ['재부팅', 'Reboot'], description: ['재부팅하는 동안 DB 연결이 끊깁니다.', 'Drops DB connections while rebooting.'] } as ActionSpec] : []),
      ...(!cluster ? [{ action: 'rdsSnapshot', label: ['스냅샷 생성', 'Create snapshot'], description: ['수동 스냅샷을 만듭니다. 스토리지 비용이 발생할 수 있습니다.', 'Creates a manual snapshot; storage charges may apply.'], field: { label: ['스냅샷 이름', 'Snapshot name'], placeholder: 'my-db-2026-10-23', initial: `${row.DBInstanceIdentifier}-${new Date().toISOString().slice(0, 10)}` } } as ActionSpec] : []),
    ];
  }
  if (service === 's3') return [{ action: 's3Versioning', label: ['버전 관리 변경', 'Change versioning'], description: ['Enabled는 버전 관리를 켜고 Suspended는 멈춥니다. 기존 버전은 남고 저장 비용이 발생할 수 있습니다.', 'Enabled turns versioning on; Suspended pauses it. Existing versions remain and may incur storage costs.'], field: { label: ['버전 관리 상태', 'Versioning status'], initial: 'Enabled', options: [['Enabled', '사용 (Enabled)', 'Enabled'], ['Suspended', '일시 중지 (Suspended)', 'Suspended']] } }];
  return [
    { action: 'logsRetention', label: ['보존 기간 변경', 'Change retention'], description: ['보존 기간이 지난 로그 이벤트는 삭제됩니다.', 'Log events older than the retention period are deleted.'], field: { label: ['보존 기간', 'Retention'], initial: String(row.retentionInDays ?? 30), options: RETENTION.map(days => [String(days), `${days}일`, `${days} days`]) } },
    ...(row.retentionInDays ? [{ action: 'logsRetainForever', label: ['만료 없이 보존', 'Never expire'], description: ['로그를 만료 없이 보존합니다. 저장 비용이 늘 수 있습니다.', 'Keeps logs forever; storage costs may grow.'] } as ActionSpec] : []),
    { action: 'logsDelete', label: ['로그 그룹 삭제', 'Delete log group'], danger: true, description: ['그룹 안의 모든 로그 스트림과 이벤트를 영구 삭제합니다. 되돌릴 수 없습니다.', 'Permanently deletes every stream and event in the group. This cannot be undone.'] },
  ];
}

export function ResourceActions({ tab, row, onDone }: { tab: AwsTab; row: AwsRow; onDone: () => void }) {
  return <ResourceActionList key={JSON.stringify([tab.profile, tab.region, tab.service, resourceId(tab.service!, row)])} tab={tab} row={row} onDone={onDone}/>;
}

function ResourceActionList({ tab, row, onDone }: { tab: AwsTab; row: AwsRow; onDone: () => void }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [open, setOpen] = useState<ActionSpec>();
  const [unlocked, setUnlocked] = useState<AwsAction>();
  const service = tab.service!, actions = actionsFor(service, row);
  return <div className="aws-detail-body">
    <p className="aws-snapshot-note">{tr('대상과 명령을 검토한 뒤 리소스 이름을 입력해 실행합니다.', 'Review the target and command, then enter the resource name to confirm.')}</p>
    <div className="aws-action-list">{actions.map(spec => <div key={spec.action} className="aws-action-row" data-danger={!!spec.danger}>
      <div><strong>{tr(...spec.label)}</strong><p>{tr(...spec.description)}</p></div>
      {spec.danger && <Button type="button" variant="outline" size="sm" aria-pressed={unlocked === spec.action} onClick={() => setUnlocked(unlocked === spec.action ? undefined : spec.action)}>
        {unlocked === spec.action ? <UnlockKeyhole size={14}/> : <LockKeyhole size={14}/>}{unlocked === spec.action ? tr('다시 잠그기', 'Lock again') : tr('삭제 잠금 해제', 'Unlock deletion')}
      </Button>}
      <Button variant={spec.danger ? 'destructive' : 'outline'} size="sm" disabled={!!spec.danger && unlocked !== spec.action} onClick={() => { setUnlocked(undefined); setOpen(spec); }}>{tr(...spec.label)}…</Button>
    </div>)}</div>
    {open && <ActionDialog tab={tab} row={row} spec={open} onClose={() => setOpen(undefined)} onDone={onDone}/>}
  </div>;
}

function ActionDialog({ tab, row, spec, onClose, onDone }: { tab: AwsTab; row: AwsRow; spec: ActionSpec; onClose: () => void; onDone: () => void }) {
  const { t, language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const service = tab.service!, id = resourceId(service, row);
  const [value, setValue] = useState(spec.field?.initial ?? ''), [review, setReview] = useState<AwsReview>(), [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const title = `${tr(...spec.label)} · ${resourceName(service, row)}`;
  const fail = (reason: unknown) => { const code = String(reason instanceof Error ? reason.message : reason); setError(code.startsWith('AWS_') ? t(awsError(code)) : code); };
  async function prepare() {
    setBusy(true); setError('');
    try { setReview(await awsPrepareAction({ profile: tab.profile, region: tab.region, action: spec.action, resource: id, value: spec.field ? value.trim() : undefined })); setPhrase(''); }
    catch (reason) { fail(reason); } finally { setBusy(false); }
  }
  async function run() {
    if (!review || busy || done || !review.phrase || phrase !== review.phrase) return;
    setBusy(true); setError('');
    try { await awsRunAction(review.review, phrase); setDone(true); onDone(); }
    catch (reason) { const code = String(reason); fail(reason); if (code === 'AWS_REVIEW_EXPIRED' || code === 'AWS_ACCOUNT_CHANGED') setReview(undefined); }
    finally { setBusy(false); }
  }
  function close() { if (review && !done) void awsCancelAction(review.review); onClose(); }
  return <ModalSurface title={title} onClose={close} locked={busy}><form className="modal aws-action-modal" role="dialog" aria-modal="true" aria-label={title} onSubmit={event => { event.preventDefault(); if (done) close(); else if (review) void run(); else void prepare(); }}>
    <div className="modal-heading"><h2>{title}</h2><Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('닫기')} onClick={close}><X size={18}/></Button></div>
    <p className="modal-description">{tr(...spec.description)}</p>
    {spec.danger && <p className="production-warning" role="note"><AlertTriangle size={14}/>{tr('삭제하면 되돌릴 수 없습니다. 정말로 삭제하시겠습니까? 리소스 이름을 적어주세요.', 'Deletion cannot be undone. Are you sure you want to delete this resource? Type the resource name to confirm.')}</p>}
    {spec.field && <label>{tr(...spec.field.label)}{spec.field.options
      ? <NativeSelect aria-label={tr(...spec.field.label)} value={value} disabled={!!review || busy} onChange={event => setValue(event.target.value)}>{spec.field.options.map(([option, ko, en]) => <NativeSelectOption key={option} value={option}>{tr(ko, en)}</NativeSelectOption>)}</NativeSelect>
      : <Input aria-label={tr(...spec.field.label)} value={value} placeholder={spec.field.placeholder} disabled={!!review || busy} onChange={event => setValue(event.target.value)}/>}</label>}
    {review && !done && <>
      <p className="modal-description">{tr(`AWS 계정 ${review.account}\n프로필 ${tab.profile} · ${tab.region}`, `AWS account ${review.account}\nProfile ${tab.profile} · ${tab.region}`)}</p>
      <pre className="aws-action-command">{review.command}</pre>
      <label>{tr('확인을 위해 리소스 이름을 입력하세요', 'Type the resource name to confirm')} <code className="aws-confirm-phrase">{review.phrase}</code><Input aria-label={tr('확인 문구', 'Confirmation')} autoFocus autoComplete="off" value={phrase} disabled={busy} onChange={event => setPhrase(event.target.value)}/></label>
      <p className="field-hint">{tr('검토는 5분 뒤 만료됩니다.', 'The review expires in 5 minutes.')}</p>
    </>}
    {done && <p className="dialog-message" role="status" data-kind="success"><Check size={14}/> {tr('요청을 보냈습니다. 잠시 후 목록을 새로고침하세요.', 'Request sent. Refresh the list shortly to check the status.')}</p>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="modal-actions">
      {done ? <Button type="submit" size="sm">{t('확인')}</Button> : <>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={review ? () => { void awsCancelAction(review.review); setReview(undefined); } : close}>{review ? tr('돌아가기', 'Back') : t('취소')}</Button>
        {review ? <Button type="submit" size="sm" variant={spec.danger ? 'destructive' : 'default'} disabled={busy || !review.phrase || phrase !== review.phrase}>{busy && <Loader2 size={13} className="spin"/>}{spec.danger ? tr('영구 삭제', 'Permanently delete') : tr('실행', 'Run')}</Button>
          : <Button type="submit" size="sm" disabled={busy || (!!spec.field && !value.trim())}>{busy && <Loader2 size={13} className="spin"/>}{tr('검토', 'Review')}</Button>}
      </>}
    </div>
  </form></ModalSurface>;
}
