import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ModalSurface } from '@/components/ModalSurface';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import { PairTable } from './PairTable';
import { parseCurl, type Collection, type Environment, type RequestSpec } from './model';

/** Asks for one name: a new collection, or renaming a request or collection. */
export function NameDialog({ title, initial, collections, collectionId = null, onSubmit, onClose }: {
  title: string; initial: string; collections?: Collection[]; collectionId?: string | null;
  onSubmit: (name: string, collectionId: string | null) => void; onClose: () => void;
}) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [name, setName] = useState(initial), [collection, setCollection] = useState(collectionId ?? '');
  return <ModalSurface title={title} onClose={onClose}>
    <form className="modal api-name-modal" onSubmit={event => { event.preventDefault(); if (name.trim()) { onSubmit(name.trim(), collection || null); onClose(); } }}>
      <div className="modal-heading"><h2>{title}</h2><Button type="button" variant="ghost" size="bare" onClick={onClose} aria-label={tr('닫기', 'Close')}><X size={20}/></Button></div>
      <label>{tr('이름', 'Name')}<Input autoFocus value={name} maxLength={200} onChange={event => setName(event.target.value)}/></label>
      {collections && <label>{tr('컬렉션', 'Collection')}<NativeSelect value={collection} onChange={event => setCollection(event.target.value)}>
        <NativeSelectOption value="">{tr('컬렉션 없음', 'No collection')}</NativeSelectOption>
        {collections.map(c => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}
      </NativeSelect></label>}
      <div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>{tr('취소', 'Cancel')}</Button><Button type="submit" disabled={!name.trim()}>{tr('확인', 'OK')}</Button></div>
    </form>
  </ModalSurface>;
}

export function CurlDialog({ initial = '', onImport, onClose }: { initial?: string; onImport: (spec: RequestSpec) => void; onClose: () => void }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [text, setText] = useState(initial), [error, setError] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    try { onImport(parseCurl(text)); onClose(); }
    catch { setError(tr('cURL 명령을 읽지 못했습니다. curl로 시작하고 URL이 들어 있는지 확인하세요.', 'Could not read the cURL command. Check that it starts with curl and includes a URL.')); }
  }
  return <ModalSurface title={tr('cURL 가져오기', 'Import cURL')} onClose={onClose}>
    <form className="modal api-curl-modal" onSubmit={submit}>
      <div className="modal-heading"><h2>{tr('cURL 가져오기', 'Import cURL')}</h2><Button type="button" variant="ghost" size="bare" onClick={onClose} aria-label={tr('닫기', 'Close')}><X size={20}/></Button></div>
      <p className="modal-description">{tr('브라우저 개발자 도구의 "cURL로 복사"나 API 문서의 예제를 붙여넣으면 새 탭으로 엽니다. URL 입력란에 바로 붙여넣어도 됩니다.', 'Paste a command from your browser’s “Copy as cURL” or from API docs to open it in a new tab. Pasting into the URL field works too.')}</p>
      <Textarea autoFocus className="api-curl-text" spellCheck={false} value={text} placeholder={"curl -X POST 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"woojoo\"}'"} onChange={event => { setText(event.target.value); setError(''); }}/>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>{tr('취소', 'Cancel')}</Button><Button type="submit" disabled={!text.trim()}>{tr('가져오기', 'Import')}</Button></div>
    </form>
  </ModalSurface>;
}

/** Edits every environment at once; nothing is stored until Save. */
export function EnvironmentDialog({ environments, initial, onSave, onClose }: {
  environments: Environment[]; initial: string | null; onSave: (next: Environment[], removed: string[]) => Promise<void>; onClose: () => void;
}) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [list, setList] = useState(() => structuredClone(environments));
  const [selected, setSelected] = useState(initial && environments.some(e => e.id === initial) ? initial : environments[0]?.id ?? '');
  const [removed, setRemoved] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = list.find(e => e.id === selected);
  const update = (patch: Partial<Environment>) => setList(previous => previous.map(e => e.id === selected ? { ...e, ...patch } : e));
  function add() {
    const environment: Environment = { id: crypto.randomUUID(), name: tr(`환경 ${list.length + 1}`, `Environment ${list.length + 1}`), sort: list.length, variables: [{ key: 'baseUrl', value: 'http://localhost:8080', enabled: true }] };
    setList(previous => [...previous, environment]); setSelected(environment.id);
  }
  function remove(id: string) {
    const rest = list.filter(e => e.id !== id);
    setList(rest); setRemoved(previous => environments.some(e => e.id === id) ? [...previous, id] : previous); setSelected(rest[0]?.id ?? '');
  }
  async function save() {
    setBusy(true); setError('');
    try { await onSave(list.map((e, sort) => ({ ...e, name: e.name.trim() || tr('이름 없음', 'Untitled'), sort })), removed); onClose(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <ModalSurface title={tr('환경 변수', 'Environments')} onClose={onClose} locked={busy}>
    <section className="modal api-env-modal" role="dialog" aria-modal="true">
      <div className="modal-heading"><h2>{tr('환경 변수', 'Environments')}</h2><Button variant="ghost" size="bare" onClick={onClose} aria-label={tr('닫기', 'Close')}><X size={20}/></Button></div>
      <p className="modal-description">{tr('요청의 URL·헤더·본문·인증에 {{이름}}으로 쓰면 보낼 때 선택한 환경의 값으로 바뀝니다. {{$timestamp}}, {{$isoTimestamp}}, {{$uuid}}, {{$randomInt}}는 보낼 때마다 새로 만들어집니다.', 'Write {{name}} in a URL, header, body or auth field and it is replaced with the selected environment’s value when sent. {{$timestamp}}, {{$isoTimestamp}}, {{$uuid}} and {{$randomInt}} are generated on every send.')}</p>
      <div className="api-env-body">
        <nav className="api-env-list" aria-label={tr('환경 목록', 'Environment list')}>
          {list.map(e => <Button key={e.id} variant="ghost" size="bare" className={`tree-table ${e.id === selected ? 'active' : ''}`} onClick={() => setSelected(e.id)}><span>{e.name || tr('이름 없음', 'Untitled')}</span></Button>)}
          <Button variant="outline" size="xs" onClick={add}><Plus size={12}/>{tr('환경 추가', 'Add environment')}</Button>
        </nav>
        <div className="api-env-editor">{current ? <>
          <div className="api-env-name"><Input aria-label={tr('환경 이름', 'Environment name')} value={current.name} onChange={event => update({ name: event.target.value })}/>
            <Button variant="ghost" size="bare" className="icon-button" title={tr('환경 삭제', 'Delete environment')} aria-label={tr('환경 삭제', 'Delete environment')} onClick={() => remove(current.id)}><Trash2 size={14}/></Button></div>
          <PairTable label={tr('변수', 'Variables')} keyLabel={tr('변수', 'Variable')} pairs={current.variables} onChange={variables => update({ variables })}/>
        </> : <p className="api-hint">{tr('환경을 추가해 로컬·개발·운영 서버 주소와 토큰을 나눠 두세요.', 'Add environments to keep local, dev and production URLs and tokens apart.')}</p>}</div>
      </div>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button variant="outline" onClick={onClose} disabled={busy}>{tr('취소', 'Cancel')}</Button><Button onClick={() => void save()} disabled={busy}>{tr('저장', 'Save')}</Button></div>
    </section>
  </ModalSurface>;
}
