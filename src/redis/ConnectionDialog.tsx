import { useState } from 'react';
import { ModalSurface } from '../components/ModalSurface';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useLanguage } from '../i18n';
import { errorText, freshProfile, validateProfile, type RedisProfile } from './model';
import type { RedisApi } from './api';

export function ConnectionDialog({ profile, api, credentialSupported, onClose, onSave, onConnect }: { profile?: RedisProfile; api: RedisApi; credentialSupported: boolean; onClose: () => void; onSave: (p: RedisProfile) => Promise<void>; onConnect: (p: RedisProfile, password: string | null, remember: boolean) => Promise<void> }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [draft, setDraft] = useState<RedisProfile>(() => profile ? { ...profile } : freshProfile());
  const [password, setPassword] = useState(''), [remember, setRemember] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const patch = <K extends keyof RedisProfile>(key: K, value: RedisProfile[K]) => setDraft(p => ({ ...p, [key]: value }));
  async function run(action: 'test' | 'save' | 'connect') {
    const normalized = { ...draft, name: draft.name.trim(), host: draft.host.trim() };
    if (validateProfile(normalized)) { setError(tr('이름, 호스트, 포트(1–65535), DB 번호(0 이상), 구분자를 확인하세요. 호스트에는 URI를 입력하지 마세요.', 'Check name, host, port (1–65535), DB (0 or above) and separator. Enter a hostname, not a URI.')); return; }
    setBusy(true); setError(''); setNotice('');
    const submittedPassword = password || null;
    setPassword('');
    try {
      if (action === 'test') { await api.test(normalized, submittedPassword); setNotice(tr('연결 테스트 성공', 'Connection test succeeded')); }
      else if (action === 'save') { await onSave(normalized); setPassword(''); onClose(); }
      else { await onConnect(normalized, submittedPassword, remember); onClose(); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <ModalSurface title={tr('Redis 연결', 'Redis connection')} onClose={onClose} locked={busy}><form className="redis-dialog" onSubmit={e => { e.preventDefault(); void run('connect'); }}>
    <h2>{tr('Redis 연결', 'Redis connection')}</h2>
    <div className="redis-form-grid">
      <label>{tr('연결 이름', 'Connection name')}<Input value={draft.name} onChange={e => patch('name', e.target.value)} autoFocus required/></label>
      <label>{tr('환경', 'Environment')}<Input value={draft.environment} placeholder="Development / Production" onChange={e => patch('environment', e.target.value)}/></label>
      <label>{tr('호스트', 'Host')}<Input value={draft.host} onChange={e => patch('host', e.target.value)} required/></label>
      <label>{tr('포트', 'Port')}<Input type="number" value={draft.port} onChange={e => patch('port', Number(e.target.value))}/></label>
      <label>{tr('사용자명 (선택)', 'Username (optional)')}<Input autoComplete="off" value={draft.username} onChange={e => patch('username', e.target.value)}/></label>
      <label>{tr('비밀번호', 'Password')}<Input type="password" autoComplete="new-password" value={password} placeholder={tr('비워두면 저장된 자격 증명 사용', 'Leave empty to use saved credentials')} onChange={e => setPassword(e.target.value)}/></label>
      <label>{tr('DB 번호', 'DB number')}<Input type="number" value={draft.db} onChange={e => patch('db', Number(e.target.value))}/></label>
      <label>{tr('키 구분자', 'Key separator')}<Input value={draft.separator} maxLength={8} onChange={e => patch('separator', e.target.value)}/></label>
    </div>
    <label className="redis-check"><input type="checkbox" checked={draft.tls} onChange={e => patch('tls', e.target.checked)}/>{tr('TLS 사용 · 서버 인증서 검증', 'Use TLS · verify server certificate')}</label>
    <label className="redis-check"><input type="checkbox" checked={remember} disabled={!credentialSupported} onChange={e => setRemember(e.target.checked)}/>{tr('이 PC에 비밀번호 기억', 'Remember password on this PC')}</label>
    {profile && <Button type="button" variant="ghost" className="redis-danger" disabled={busy} onClick={() => { setBusy(true); void api.forget(profile.id).then(() => setNotice(tr('저장된 비밀번호를 삭제했습니다.', 'Saved password removed.'))).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>{tr('저장된 비밀번호 삭제', 'Forget saved password')}</Button>}
    <p className="redis-muted">{tr('Standalone Redis · 조회 전용', 'Standalone Redis · Read only')}</p>
    {error && <p role="alert" className="redis-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <footer><Button type="button" variant="outline" disabled={busy} onClick={() => void run('test')}>{tr('연결 테스트', 'Test connection')}</Button><span/>
      <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{tr('취소', 'Cancel')}</Button><Button type="button" disabled={busy} onClick={() => void run('save')}>{tr('프로필 저장', 'Save profile')}</Button><Button type="submit" disabled={busy}>{busy ? tr('처리 중…', 'Working…') : tr('연결', 'Connect')}</Button></footer>
  </form></ModalSurface>;
}
