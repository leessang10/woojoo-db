import { useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { HardDrive, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '../components/ConfirmProvider';
import { errorMessage } from './api';
import { text } from './model';
import { compactStorage, inspectStorage, pickStorage, reclaimedBytes, stopDesktopForStorage, storageSize, trimStorage, type CompactResult, type DockerDisk } from './storage';

export function StorageManager({ context, language, disabled, onBusy, onChanged }: { context: string; language: string; disabled: boolean; onBusy: (busy: boolean) => void; onChanged: () => void }) {
  const tr = (ko: string, en: string) => text(language, ko, en);
  const { requestConfirm } = useConfirm();
  const [open, setOpen] = useState(false), [supported, setSupported] = useState(false), [disks, setDisks] = useState<DockerDisk[]>([]), [selected, setSelected] = useState('');
  const [phase, setPhase] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [result, setResult] = useState<CompactResult | null>(null);
  const lock = useRef(false); const busy = !!phase; const disk = disks.find(d => d.id === selected);
  async function refresh() {
    const report = await inspectStorage(context);
    setSupported(report.supported); setDisks(report.disks);
    setSelected(report.disks.find(d => d.path === disk?.path)?.id ?? report.disks[0]?.id ?? '');
  }
  async function task(label: string, work: () => Promise<void>, maintenance = false) {
    if (lock.current) return;
    lock.current = true; setPhase(label); setError(''); setNotice('');
    if (maintenance) onBusy(true);
    try { await work(); } catch (e) { setError(errorMessage(e, language)); }
    finally { lock.current = false; setPhase(''); if (maintenance) { onBusy(false); onChanged(); } }
  }
  async function compact() {
    if (!disk || lock.current) return;
    await task(tr('관리자 승인 및 공간 회수 중… 완료될 때까지 앱과 Docker를 실행·종료하지 마세요.', 'Waiting for administrator approval / reclaiming… Keep this app open and Docker stopped until completion.'), async () => {
      if (!await requestConfirm(`${disk.path}\n${tr('선택한 가상 디스크의 빈 블록을 정리합니다. Docker와 이 디스크를 사용하는 WSL 환경이 완전히 종료되어 있어야 합니다. 다음 단계에서 Windows 관리자 권한을 요청합니다. 회수량이 0일 수도 있습니다.', 'Compact unused blocks in this virtual disk. Docker and the WSL environment using it must be fully stopped. Windows will request administrator access. Reclaimed space may be zero.')}`, { title: tr('디스크 공간 회수', 'Reclaim disk space'), confirmLabel: tr('공간 회수', 'Reclaim space') })) return;
      setResult(null);
      const next = await compactStorage(context, disk.id, disk.token);
      setResult(next); setDisks(list => list.map(d => d.path === next.after.path ? next.after : d)); setSelected(next.after.id);
    }, true);
  }
  return <>
    <Button className="docker-storage-launcher" variant="outline" size="sm" disabled={disabled || !context || busy} onClick={() => { setOpen(true); setResult(null); void task(tr('디스크 조회 중…', 'Reading disk information…'), refresh); }}><HardDrive size={14}/>{tr('디스크 공간 회수', 'Reclaim disk space')}</Button>
    <Dialog.Root open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><Dialog.Portal><Dialog.Overlay className="compose-overlay"/><Dialog.Content className="compose-dialog docker-storage-dialog" onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}>
      <header><Dialog.Title>{tr('Windows Docker 디스크 공간 회수', 'Windows Docker disk reclaim')}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="sm" disabled={busy}>{tr('닫기', 'Close')}</Button></Dialog.Close></header>
      <Dialog.Description>{tr('Docker가 쓰지 않는 디스크 공간을 Windows에 반환합니다.', 'Return unused Docker disk space to Windows.')}</Dialog.Description>
      {error && <div role="alert" className="docker-banner docker-warning">{error}</div>}
      {notice && <div role="status" className="docker-banner">{notice}</div>}
      {busy && <p role="status"><Loader2 size={16} className="spin"/>{phase}</p>}
      {!supported && !busy && <p>{tr('로컬 Windows Docker WSL 연결에서 사용할 수 있습니다.', 'Available for a local Windows Docker WSL context.')}</p>}
      {supported && <>
        <div className="compose-actions"><Button variant="outline" disabled={busy} onClick={() => void task(tr('디스크 조회 중…', 'Reading disks…'), refresh)}>{tr('디스크 새로고침', 'Refresh disks')}</Button><Button variant="outline" disabled={busy} onClick={() => void task(tr('디스크 선택 중…', 'Selecting disk…'), async () => { const next = await pickStorage(context); if (next) { setDisks(list => [...list.filter(d => d.path !== next.path), next]); setSelected(next.id); setResult(null); } })}>{tr('다른 VHDX 선택', 'Select another VHDX')}</Button></div>
        {!disks.length && <p>{tr('기본 위치에 Docker 데이터 디스크가 없습니다. Docker 설정에서 저장 위치를 확인한 뒤 VHDX를 선택하세요.', 'No Docker data disk found at default locations. Check the disk location in Docker settings and select its VHDX.')}</p>}
        {disks.map(d => <label className="storage-disk" key={d.id}><input type="radio" name="docker-storage-disk" value={d.id} checked={selected === d.id} disabled={busy} onChange={() => { setSelected(d.id); setResult(null); }}/><span><code>{d.path}</code><span>{tr('파일 크기', 'File size')}: {storageSize(d.fileBytes)} · {tr('실제 디스크 사용', 'Allocated on host')}: {storageSize(d.allocatedBytes)}</span></span></label>)}
        <ol className="storage-steps">
          <li><strong>{tr('빈 공간 알리기 (선택)', 'Notify unused space (optional)')}</strong><p>{tr('Docker가 켜진 상태에서 빈 공간을 정리합니다. 사용 중인 파일은 유지됩니다.', 'Prepare unused space while Docker is running. Existing files are preserved.')}</p><Button variant="outline" disabled={busy} onClick={() => void task(tr('Docker WSL 빈 공간 알리는 중…', 'Trimming unused Docker WSL blocks…'), async () => { const output = await trimStorage(context); setNotice(tr('TRIM 요청을 완료했습니다. 다음으로 Docker를 종료하세요.', 'TRIM completed. Stop Docker next.') + (output ? `\n${output.slice(0, 1500)}` : '')); await refresh(); }, true)}>{tr('빈 공간 알리기 (TRIM)', 'Trim unused blocks')}</Button></li>
          <li><strong>{tr('Docker 종료', 'Stop Docker')}</strong><p>{tr('이 PC의 Docker Desktop과 실행 중인 컨테이너를 중지합니다.', 'Stops Docker Desktop and its running containers on this PC.')}</p><Button variant="outline" disabled={busy} onClick={() => void task(tr('Docker 종료 중…', 'Stopping Docker…'), async () => { if (!await requestConfirm(tr('이 PC의 Docker Desktop과 실행 중인 모든 컨테이너를 중지할까요?', 'Stop Docker Desktop and all its running containers on this PC?'), { title: tr('Docker 종료', 'Stop Docker'), confirmLabel: tr('종료', 'Stop'), destructive: true })) return; await stopDesktopForStorage(context); setNotice(tr('Docker를 종료했습니다. 디스크가 계속 사용 중이면 해당 WSL 환경도 종료한 뒤 새로고침하세요.', 'Docker stopped. If the disk remains in use, close its WSL environment and refresh.')); await refresh(); }, true)}>{tr('Docker 종료', 'Stop Docker')}</Button></li>
          <li><strong>{tr('Windows에 공간 반환', 'Return space to Windows')}</strong><p>{tr('선택한 디스크를 압축합니다. 회수할 공간이 없으면 크기가 줄지 않을 수 있습니다.', 'Compact the selected disk. Its size may not shrink if no space is reclaimable.')}</p><Button disabled={busy || !disk} onClick={() => void compact()}>{tr('공간 회수', 'Reclaim space')}</Button></li>
        </ol>
      </>}
      {result && <section className="storage-result" role="status"><h3>{tr('공간 회수 완료', 'Compaction completed')}</h3><strong>{storageSize(reclaimedBytes(result.before, result.after))} {tr('회수', 'reclaimed')}</strong><p>{storageSize(result.before.allocatedBytes)} → {storageSize(result.after.allocatedBytes)}</p>{reclaimedBytes(result.before, result.after) === 0 && <p>{tr('작업은 완료됐지만 실제 디스크 사용량은 줄지 않았습니다.', 'The operation completed but allocated disk usage did not decrease.')}</p>}<p>{tr('창을 닫고 Docker 켜기를 누르면 다시 사용할 수 있습니다.', 'Close this window and use Start Docker to reconnect.')}</p></section>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
