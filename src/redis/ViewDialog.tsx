import { useState } from 'react';
import { ModalSurface } from '../components/ModalSurface';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { useLanguage } from '../i18n';
import { errorText, type SavedView } from './model';
export function ViewDialog({ initial, onSave, onClose }: { initial: SavedView; onSave: (v: SavedView) => Promise<void>; onClose: () => void }) {
  const { language } = useLanguage(); const ko = language === 'ko'; const [view, setView] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <ModalSurface title={ko ? '보기 저장' : 'Save view'} onClose={onClose} locked={busy}><form className="redis-dialog redis-view-dialog" onSubmit={e => { e.preventDefault(); if (!view.name.trim() || (view.kind === 'cache' && !view.pattern)) return; setBusy(true); void onSave({ ...view, name: view.name.trim() }).then(onClose).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>
    <h2>{ko ? '보기 저장' : 'Save view'} · {view.kind}</h2><label>{ko ? '이름' : 'Name'}<Input required autoFocus value={view.name} onChange={e => setView(v => ({ ...v, name: e.target.value }))}/></label>
    {view.kind === 'cache' && <label>{ko ? '키 패턴' : 'Key pattern'}<Input required value={view.pattern} onChange={e => setView(v => ({ ...v, pattern: e.target.value }))}/></label>}
    {view.kind === 'list' && <label>{ko ? '처리 방향' : 'Processing direction'}<NativeSelect value={view.direction} onChange={e => setView(v => ({ ...v, direction: e.target.value as SavedView['direction'] }))}><option value="unknown">{ko ? '알 수 없음' : 'Unknown'}</option><option value="left">{ko ? '왼쪽' : 'Left'}</option><option value="right">{ko ? '오른쪽' : 'Right'}</option></NativeSelect></label>}
    {error && <p role="alert" className="redis-error">{error}</p>}<footer><Button variant="ghost" type="button" onClick={onClose} disabled={busy}>{ko ? '취소' : 'Cancel'}</Button><Button type="submit" disabled={busy}>{ko ? '저장' : 'Save'}</Button></footer>
  </form></ModalSurface>;
}
