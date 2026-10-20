import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { ModalSurface } from './components/ModalSurface';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { useLanguage } from './i18n';
import type { Engine, Profile } from './model';

export function MaintenanceDialog({ session, engine, profile, onClose, onRestored }: {
  session: string; engine: Engine; profile: Profile; onClose: () => void; onRestored: () => void;
}) {
  const { language } = useLanguage();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [tools, setTools] = useState<{ backup: string | null; restore: string | null } | null>(null);
  const [path, setPath] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const native = isTauri() && session !== 'demo';
  useEffect(() => {
    if (native) void invoke<{ backup: string | null; restore: string | null }>('maintenance_tools', { engine }).then(setTools).catch(e => setError(String(e)));
  }, [engine, native]);
  async function backup() {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await invoke<string | null>('maintenance_backup', { id: session, profile: { ...profile, password } });
      if (saved) setMessage(`${tr('백업 완료', 'Backup saved')}: ${saved}`);
    } catch (e) { setError(String(e)); } finally { setBusy(false); setPassword(''); }
  }
  async function chooseRestore() {
    setError(''); setMessage('');
    try {
      const selected = await invoke<string | null>('maintenance_pick_restore', { engine });
      if (selected) { setPath(selected); setConfirmation(''); }
    } catch (e) { setError(String(e)); }
  }
  async function restore() {
    setBusy(true); setError(''); setMessage('');
    try {
      await invoke('maintenance_restore', { id: session, profile: { ...profile, password }, path, confirmation });
      setMessage(tr('복원이 완료되었습니다. 객체 목록을 새로고침합니다.', 'Restore completed. Refreshing database objects.'));
      setPath(''); setConfirmation(''); onRestored();
    } catch (e) { setError(String(e)); } finally { setBusy(false); setPassword(''); }
  }
  return <ModalSurface title={tr('백업 · 복원', 'Backup · restore')} onClose={onClose} locked={busy}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={tr('백업 · 복원', 'Backup · restore')} style={{ width: 600, maxWidth: '90vw' }}>
      <div className="modal-heading"><h2>{tr('백업 · 복원', 'Backup · restore')}</h2><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={tr('닫기', 'Close')} onClick={onClose}><X /></Button></div>
      <p className="modal-description"><strong>{profile.name}</strong> · {engine}<br />{profile.database}</p>
      {!native ? <p>{tr('네이티브 백업과 복원은 데스크톱의 실제 연결에서만 가능합니다.', 'Native backup and restore require a live desktop connection.')}</p> : <>
        <p>{tr('PATH에 설치된 DB 도구를 사용합니다. 백업은 저장된 데이터를 읽으며, 미커밋 변경은 포함하지 않습니다.', 'Uses database tools installed on PATH. Backups contain committed data; uncommitted changes are excluded.')}</p>
        <p><small>{tr('백업 도구', 'Backup tool')}: {tools?.backup ?? tr('찾을 수 없음', 'Not found')}<br />{tr('복원 도구', 'Restore tool')}: {tools?.restore ?? tr('찾을 수 없음', 'Not found')}</small></p>
        {engine !== 'sqlite' && <label>{tr('DB 비밀번호 (이번 작업에만 사용)', 'Database password (used for this operation only)')}<Input type="password" autoComplete="off" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>}
        <div className="modal-actions">
          <Button variant="outline" disabled={busy || !tools?.backup} onClick={() => void backup()}>{tr('백업 저장…', 'Save backup…')}</Button>
          <Button variant="outline" disabled={busy || !tools?.restore || profile.readOnly} onClick={() => void chooseRestore()}>{tr('복원 파일 선택…', 'Choose restore file…')}</Button>
        </div>
        {profile.readOnly && <p>{tr('읽기 전용 연결에서는 복원할 수 없습니다.', 'Restore is disabled for read-only connections.')}</p>}
        {path && <div style={{ marginTop: 16 }}>
          <p><strong>{tr('복원 미리보기', 'Restore preview')}</strong></p>
          <p style={{ overflowWrap: 'anywhere' }}>{path}<br />→ {profile.host ? `${profile.host}:${profile.port} / ` : ''}{profile.database}</p>
          <p>{engine === 'sqlite'
            ? tr('선택한 백업으로 대상 데이터베이스의 내용을 교체합니다. 다른 작업을 종료한 뒤 복원하세요.', 'Replaces the target database contents with the selected backup. Finish other operations before restoring.')
            : tr('선택한 SQL 파일을 대상 DB에서 실행합니다. 기존 객체와 데이터가 변경되거나 삭제될 수 있습니다. 신뢰할 수 있는 백업만 선택하세요.', 'Executes the selected SQL file against the target database. Existing objects and data may be changed or deleted. Select a trusted backup.')}</p>
          {(engine === 'mysql' || engine === 'mariadb') && <p>{tr('오류가 발생하면 일부 변경이 이미 커밋되었을 수 있습니다.', 'An error may leave changes already committed.')}</p>}
          <label>{tr('확인하려면 대상 DB 이름/경로를 그대로 입력하세요.', 'Type the exact target database name/path to confirm.')}<Input value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
          <div className="modal-actions"><Button variant="destructive" disabled={busy || profile.readOnly || confirmation !== profile.database} onClick={() => void restore()}>{tr('확인하고 복원', 'Confirm and restore')}</Button></div>
        </div>}
      </>}
      {busy && <p role="status">{tr('네이티브 도구 실행 중…', 'Running native database tool…')}</p>}
      {message && <p role="status" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
    </div>
  </ModalSurface>;
}
