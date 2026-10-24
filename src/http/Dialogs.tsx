import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, FileDown, FileUp, Plus, Trash2, X } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ModalSurface } from '@/components/ModalSurface';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import { PairTable } from './PairTable';
import { parseCurl, type Collection, type Environment, type RequestSpec } from './model';
import { mergeEnvVariables } from './dotenv';
import { parseEnvironmentFile } from './environment-import';
import { serializeEnvironment, type EnvironmentFormat } from './environment-export';
import { exportEnvironmentFile } from './api';

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
      <p className="modal-description">{tr('cURL 명령을 붙여넣어 새 요청을 만드세요.', 'Paste a cURL command to create a request.')}</p>
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
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const importing = useRef(false);
  const [fileDrag, setFileDrag] = useState(false);
  useEffect(() => {
    // Dropping outside the dialog must not navigate the webview to the file.
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);
  const [notice, setNotice] = useState('');
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
  async function importEnv(file: File) {
    if (busy || importing.current) return;
    if (!/\.env(?:\..+)?$|\.(?:json|ya?ml)$/i.test(file.name)) {
      setError(tr('.env, .json, .yml 또는 .yaml 파일을 선택하세요.', 'Choose an .env, .json, .yml or .yaml file.'));
      setNotice('');
      return;
    }
    importing.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const variables = parseEnvironmentFile(await file.text(), file.name);
      if (!variables.length) {
        setError(tr('파일에 가져올 환경 변수가 없습니다.', 'The file contains no environment variables.'));
        return;
      }
      if (current) {
        setList(previous => previous.map(environment => environment.id === current.id
          ? { ...environment, variables: mergeEnvVariables(environment.variables, variables) } : environment));
      } else {
        const environment: Environment = { id: crypto.randomUUID(), name: file.name, sort: list.length, variables };
        setList(previous => [...previous, environment]); setSelected(environment.id);
      }
      setNotice(tr(`${variables.length}개 변수를 가져왔습니다. 목록을 확인한 뒤 저장하세요.`, `Imported ${variables.length} variables. Review the list and save.`));
    } catch (reason) {
      const line = reason instanceof Error ? /^Invalid \.env syntax at line (\d+)$/.exec(reason.message)?.[1] : undefined;
      setError(line
        ? tr(`${line}번째 줄의 .env 형식을 확인하세요. 가져온 내용은 적용되지 않았습니다.`, `Check the .env syntax on line ${line}. Nothing was imported.`)
        : tr('파일 형식을 확인하세요. .env 또는 키·값 객체 형식의 JSON/YAML 파일을 선택하세요. 중복 키나 펼친 키의 충돌은 허용하지 않습니다. 가져온 내용은 적용되지 않았습니다.', 'Check the file format. Choose .env or a JSON/YAML key-value object. Duplicate YAML keys and conflicting flattened keys are not allowed. Nothing was imported.'));
    } finally { importing.current = false; setBusy(false); }
  }
  async function exportEnv(format: EnvironmentFormat) {
    if (!current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const text = serializeEnvironment(current.variables, format);
      if (await exportEnvironmentFile(current.name, format, text)) {
        setNotice(tr('환경 변수를 내보냈습니다.', 'Environment variables exported.'));
      }
    } catch {
      setError(tr('내보내지 못했습니다. 비어 있거나 중복된 키와 저장 위치를 확인하세요. .env 키에는 영문·숫자·밑줄·점·하이픈을 사용할 수 있습니다.', 'Could not export. Check for empty or duplicate keys and the save location. .env keys support letters, numbers, underscores, dots and hyphens.'));
    } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try { await onSave(list.map((e, sort) => ({ ...e, name: e.name.trim() || tr('이름 없음', 'Untitled'), sort })), removed); onClose(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <ModalSurface title={tr('환경 변수', 'Environments')} onClose={onClose} locked={busy} initialFocusRef={importButton}>
    <section className="modal api-env-modal" role="dialog" aria-modal="true" data-file-drag={fileDrag || undefined}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); event.stopPropagation();
        if (!busy) { dragDepth.current++; setFileDrag(true); }
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      }}
      onDragLeave={event => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setFileDrag(false);
      }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); event.stopPropagation();
        dragDepth.current = 0; setFileDrag(false);
        if (busy) return;
        if (event.dataTransfer.files.length !== 1) {
          setError(tr('파일을 한 번에 하나씩 놓아 주세요.', 'Drop one file at a time.')); setNotice('');
          return;
        }
        void importEnv(event.dataTransfer.files[0]);
      }}>
      {fileDrag && <div className="api-env-drop-overlay" aria-hidden="true"><FileUp size={28}/><strong>{tr('여기에 놓아 가져오기', 'Drop here to import')}</strong><span>.env / .json / .yml</span></div>}
      <div className="modal-heading">
        <div className="api-env-heading"><h2>{tr('환경 변수', 'Environments')}</h2>
          <Tooltip.Provider delayDuration={200}><Tooltip.Root>
            <Tooltip.Trigger asChild><Button variant="ghost" size="icon-sm" className="api-env-help-trigger" aria-label={tr('변수 사용법·파일 형식', 'Variable usage and file formats')}><CircleHelp size={16}/></Button></Tooltip.Trigger>
            <Tooltip.Portal><Tooltip.Content className="api-env-help-tooltip" side="bottom" align="start" sideOffset={8} collisionPadding={16}>
              <p>{tr('URL·헤더·본문·인증에서 {{이름}}을 사용합니다.', 'Use {{name}} in URLs, headers, bodies and authentication.')}</p>
              <p>{tr('자동 생성 변수: {{$timestamp}}, {{$isoTimestamp}}, {{$uuid}}, {{$randomInt}}', 'Generated on send: {{$timestamp}}, {{$isoTimestamp}}, {{$uuid}}, {{$randomInt}}')}</p>
              <p>{tr('지원 파일: .env · JSON · YAML', 'Supported files: .env · JSON · YAML')}</p>
              <p>{tr('중첩 키는 database.host 형식으로 가져옵니다. 배열은 JSON 문자열, null은 빈 값으로 변환합니다.', 'Nested keys use database.host. Arrays become JSON strings; null becomes an empty value.')}</p>
              <p>{tr('선택한 환경의 모든 키·값을 내보냅니다. 사용 여부는 파일에 포함되지 않습니다.', 'Exports all keys and values in the selected environment. Enabled switches are not included.')}</p>
            </Tooltip.Content></Tooltip.Portal>
          </Tooltip.Root></Tooltip.Provider>
        </div>
        <Button variant="ghost" size="bare" onClick={onClose} disabled={busy} aria-label={tr('닫기', 'Close')}><X size={20}/></Button>
      </div>
      <p className="modal-description">{tr('요청에 {{baseUrl}}처럼 변수를 넣어 사용하세요.', 'Use variables such as {{baseUrl}} in your requests.')}</p>
      <fieldset disabled={busy} className="api-env-fields">
      <div className="api-env-import">
        <input ref={fileInput} type="file" hidden aria-label={tr('환경 변수 파일 선택', 'Choose environment file')} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void importEnv(file);
        }}/>
        <Button ref={importButton} variant="outline" size="sm" onClick={() => fileInput.current?.click()} title={tr('같은 키의 값은 덮어씁니다.', 'Matching keys will be overwritten.')}><FileUp size={14}/>{tr('가져오기', 'Import')}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" disabled={busy || !current}><FileDown size={14}/>{tr('내보내기', 'Export')}<ChevronDown size={12}/></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(['env', 'json', 'yml'] as const).map(format => <DropdownMenuItem key={format} disabled={busy} onSelect={() => void exportEnv(format)}>.{format}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="api-hint">{tr('파일을 이 창에 끌어다 놓으세요', 'Drop a file into this dialog')} · .env / .json / .yml</span>
      </div>
      <div className="api-env-body">
        <nav className="api-env-list" aria-label={tr('환경 목록', 'Environment list')}>
          {list.map(e => <Button key={e.id} variant="ghost" size="bare" className={`tree-table ${e.id === selected ? 'active' : ''}`} onClick={() => setSelected(e.id)}><span>{e.name || tr('이름 없음', 'Untitled')}</span></Button>)}
          <Button variant="default" size="sm" onClick={add}><Plus size={12}/>{tr('환경 추가', 'Add environment')}</Button>
        </nav>
        <div className="api-env-editor">{current ? <>
          <div className="api-env-name"><Input aria-label={tr('환경 이름', 'Environment name')} value={current.name} onChange={event => update({ name: event.target.value })}/>
            <Button variant="destructive" size="icon-sm" className="icon-button" title={tr('환경 삭제', 'Delete environment')} aria-label={tr('환경 삭제', 'Delete environment')} onClick={() => remove(current.id)}><Trash2 size={14}/></Button></div>
          <PairTable label={tr('변수', 'Variables')} keyLabel={tr('변수', 'Variable')} pairs={current.variables} onChange={variables => update({ variables })}/>
        </> : <p className="api-hint">{tr('환경을 추가하거나 파일을 가져오세요.', 'Add an environment or import a file.')}</p>}</div>
      </div>
      </fieldset>
      {notice && <p className="api-hint" role="status">{notice}</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button variant="outline" onClick={onClose} disabled={busy}>{tr('취소', 'Cancel')}</Button><Button onClick={() => void save()} disabled={busy}>{tr('저장', 'Save')}</Button></div>
    </section>
  </ModalSurface>;
}
