import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { EditorView, Prec, keymap } from '@uiw/react-codemirror';
import { json as jsonLanguage } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { AlertTriangle, Braces, Copy, Loader2, Save, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import type { Theme } from '../theme';
import { PairTable } from './PairTable';
import { ResponseView, type Result } from './ResponseView';
import { METHODS, buildOutgoing, isJson, paramsFromUrl, prettyJson, toCurl, urlWithParams, type ApiTab, type AuthKind, type BodyKind, type Pair, type RequestSpec } from './model';

type Section = 'params' | 'headers' | 'body' | 'auth' | 'options';
const BODY_KINDS: [BodyKind, string, string][] = [['none', '없음', 'None'], ['json', 'JSON', 'JSON'], ['text', '텍스트', 'Text'], ['xml', 'XML', 'XML'], ['form', 'x-www-form-urlencoded', 'x-www-form-urlencoded'], ['multipart', 'form-data', 'form-data']];
const SPLIT_KEY = 'woojoo-api-split';

/** One request tab: the request line, its settings and the latest response below. */
export function RequestPanel({ tab, variables, result, theme, dirty, onChange, onSend, onCancel, onSave }: {
  tab: ApiTab; variables: Pair[]; result?: Result; theme: Theme; dirty: boolean;
  onChange: (spec: RequestSpec) => void; onSend: () => void; onCancel: () => void; onSave: () => void;
}) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const spec = tab.spec;
  const [section, setSection] = useState<Section>(() => spec.body.kind !== 'none' ? 'body' : 'params');
  const [split, setSplit] = useState(() => { try { const value = Number(localStorage.getItem(SPLIT_KEY)); return value > 0.15 && value < 0.85 ? value : 0.45; } catch { return 0.45; } });
  const area = useRef<HTMLDivElement>(null);
  const missing = useMemo(() => buildOutgoing(spec, variables).missing, [spec, variables]);
  const sending = !!result?.ticket;
  const patch = (value: Partial<RequestSpec>) => onChange({ ...spec, ...value });
  const send = useRef(onSend); send.current = onSend;
  const editorKeys = useMemo(() => Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { send.current(); return true; } }])), []);

  function setUrl(url: string) { patch({ url, params: paramsFromUrl(url, spec.params) }); }
  function setParams(params: Pair[]) { patch({ params, url: urlWithParams(spec.url, params) }); }
  function dragSplit(event: React.PointerEvent<HTMLDivElement>) {
    const box = area.current?.getBoundingClientRect(); if (!box) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setSplit(Math.min(0.85, Math.max(0.15, (e.clientY - box.top) / box.height)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setSplit(value => { try { localStorage.setItem(SPLIT_KEY, String(value)); } catch { /* Session-only. */ } return value; }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  const count = (pairs: Pair[]) => pairs.filter(p => p.enabled && p.key).length;
  const sections: [Section, string, number?][] = [
    ['params', tr('파라미터', 'Params'), count(spec.params)], ['headers', tr('헤더', 'Headers'), count(spec.headers)],
    ['body', tr('본문', 'Body')], ['auth', tr('인증', 'Auth')], ['options', tr('설정', 'Settings')],
  ];
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => { if (copyNotice !== tr('복사했습니다', 'Copied')) return; const timer = setTimeout(() => setCopyNotice(''), 2500); return () => clearTimeout(timer); }, [copyNotice, language]);
  async function copyCurl() {
    try { await navigator.clipboard.writeText(toCurl(buildOutgoing(spec, variables).outgoing)); setCopyNotice(tr('복사했습니다', 'Copied')); }
    catch { setCopyNotice(tr('복사하지 못했습니다. 다시 시도하세요.', 'Could not copy. Try again.')); }
  }
  const auth = spec.auth, setAuth = (value: Partial<typeof auth>) => patch({ auth: { ...auth, ...value } });
  const body = spec.body, setBody = (value: Partial<typeof body>) => patch({ body: { ...body, ...value } });
  const editorTheme = theme === 'dark' ? oneDark : 'light';

  return <div className="api-request">
    <form className="api-line" onSubmit={event => { event.preventDefault(); if (sending) onCancel(); else onSend(); }}>
      <NativeSelect size="sm" className="api-method" data-method={spec.method} aria-label={tr('HTTP 메서드', 'HTTP method')} value={spec.method} onChange={event => patch({ method: event.target.value })}>
        {METHODS.map(method => <NativeSelectOption key={method} value={method}>{method}</NativeSelectOption>)}
      </NativeSelect>
      <Input className="api-url" aria-label="URL" placeholder="https://api.example.com/users?page=1  ·  {{baseUrl}}/users" spellCheck={false} value={spec.url} onChange={event => setUrl(event.target.value)}
        onPaste={event => { const text = event.clipboardData.getData('text'); if (/^\s*curl\s/i.test(text)) { event.preventDefault(); window.dispatchEvent(new CustomEvent('woojoo-api-curl', { detail: text })); } }}/>
      {sending
        ? <Button type="submit" variant="outline" size="sm" className="api-send"><Square size={13}/>{tr('취소', 'Cancel')}</Button>
        : <Button type="submit" size="sm" className="api-send" disabled={!spec.url.trim()} title={tr('보내기', 'Send') + ' · Ctrl/Cmd+Enter'}><Send size={13}/>{tr('보내기', 'Send')}</Button>}
      <Button type="button" variant="default" size="sm" title={tr('저장', 'Save') + ' · Ctrl/Cmd+S'} onClick={onSave}><Save size={13}/>{tr('저장', 'Save')}{dirty && <span className="api-dirty" aria-label={tr('저장 안 됨', 'Unsaved')}/>}</Button>
    </form>
    {copyNotice && <div className="api-copy-notice" role="status"><span>{copyNotice}</span><Button variant="ghost" size="icon-sm" aria-label={tr("알림 닫기", "Dismiss notification")} onClick={() => setCopyNotice('')}>×</Button></div>}
    {missing.length > 0 && <p className="api-missing" role="status"><AlertTriangle size={13}/>{tr('정의되지 않은 변수', 'Undefined variables')}: {missing.map(name => `{{${name}}}`).join(', ')}</p>}
    <div className="api-split" ref={area} style={{ gridTemplateRows: `minmax(80px,${split}fr) 6px minmax(80px,${1 - split}fr)` }}>
      <section className="api-config">
        <div className="api-sections" role="tablist" aria-label={tr('요청 설정', 'Request settings')}>
          {sections.map(([id, label, n]) => <Button key={id} variant="ghost" size="bare" role="tab" className="api-section" aria-selected={section === id} onClick={() => setSection(id)}>
            {label}{!!n && <small>{n}</small>}{id === 'body' && body.kind !== 'none' && <small>•</small>}{id === 'auth' && auth.kind !== 'none' && <small>•</small>}
          </Button>)}
          <span className="tabs-spacer"/>
          <Button variant="ghost" size="xs" title={tr('변수를 채운 cURL 명령 복사', 'Copy as cURL with variables resolved')} onClick={copyCurl}><Copy size={12}/>cURL</Button>
        </div>
        <div className="api-section-body" role="tabpanel">
          {section === 'params' && <PairTable label={tr('쿼리 파라미터', 'Query params')} pairs={spec.params} onChange={setParams}/>}
          {section === 'headers' && <PairTable label={tr('헤더', 'Headers')} pairs={spec.headers} onChange={headers => patch({ headers })}/>}
          {section === 'body' && <div className="api-body">
            <div className="api-body-kinds" role="radiogroup" aria-label={tr('본문 형식', 'Body type')}>
              {BODY_KINDS.map(([kind, ko, en]) => <label key={kind}><input type="radio" name={`body-${tab.id}`} checked={body.kind === kind} onChange={() => setBody({ kind })}/>{tr(ko, en)}</label>)}
              {body.kind === 'json' && <Button variant="ghost" size="xs" className="api-beautify" disabled={!isJson(body.text)} onClick={() => setBody({ text: prettyJson(body.text) })}><Braces size={12}/>{tr('정렬', 'Beautify')}</Button>}
            </div>
            {(body.kind === 'json' || body.kind === 'text' || body.kind === 'xml') && <div className="api-editor">
              <CodeMirror key={`${tab.id}-${body.kind}`} value={body.text} height="100%" theme={editorTheme} extensions={[editorKeys, EditorView.lineWrapping, ...(body.kind === 'json' ? [jsonLanguage()] : [])]} onChange={text => setBody({ text })} aria-label={tr('요청 본문', 'Request body')}/>
            </div>}
            {(body.kind === 'form' || body.kind === 'multipart') && <PairTable label={tr('폼 필드', 'Form fields')} pairs={body.form} files={body.kind === 'multipart'} onChange={form => setBody({ form })}/>}
            {body.kind === 'none' && <p className="api-hint">{tr('이 요청은 본문을 보내지 않습니다.', 'This request has no body.')}</p>}
          </div>}
          {section === 'auth' && <div className="api-form">
            <label>{tr('방식', 'Type')}<NativeSelect size="sm" value={auth.kind} onChange={event => setAuth({ kind: event.target.value as AuthKind })}>
              <NativeSelectOption value="none">{tr('없음', 'None')}</NativeSelectOption>
              <NativeSelectOption value="bearer">Bearer Token</NativeSelectOption>
              <NativeSelectOption value="basic">Basic Auth</NativeSelectOption>
              <NativeSelectOption value="apiKey">API Key</NativeSelectOption>
            </NativeSelect></label>
            {auth.kind === 'bearer' && <label>{tr('토큰', 'Token')}<Input value={auth.token} spellCheck={false} placeholder="{{token}}" onChange={event => setAuth({ token: event.target.value })}/></label>}
            {auth.kind === 'basic' && <><label>{tr('사용자 이름', 'Username')}<Input value={auth.username} onChange={event => setAuth({ username: event.target.value })}/></label>
              <label>{tr('비밀번호', 'Password')}<Input type="password" value={auth.password} onChange={event => setAuth({ password: event.target.value })}/></label></>}
            {auth.kind === 'apiKey' && <><label>{tr('키 이름', 'Key')}<Input value={auth.key} spellCheck={false} placeholder="X-API-Key" onChange={event => setAuth({ key: event.target.value })}/></label>
              <label>{tr('값', 'Value')}<Input value={auth.value} spellCheck={false} placeholder="{{apiKey}}" onChange={event => setAuth({ value: event.target.value })}/></label>
              <label>{tr('위치', 'Add to')}<NativeSelect size="sm" value={auth.in} onChange={event => setAuth({ in: event.target.value as 'header' | 'query' })}>
                <NativeSelectOption value="header">{tr('헤더', 'Header')}</NativeSelectOption><NativeSelectOption value="query">{tr('쿼리 파라미터', 'Query params')}</NativeSelectOption>
              </NativeSelect></label></>}
            {auth.kind !== 'none' && <p className="api-hint">{tr('Authorization 헤더가 우선합니다. 인증 값은 이 PC에 암호화 없이 저장됩니다.', 'The Authorization header takes precedence. Credentials are stored unencrypted on this PC.')}</p>}
          </div>}
          {section === 'options' && <div className="api-form">
            <label>{tr('시간 제한 (초)', 'Timeout (seconds)')}<Input type="number" min={1} max={600} value={Math.round(spec.options.timeoutMs / 1000)} onChange={event => patch({ options: { ...spec.options, timeoutMs: Math.min(600, Math.max(1, Number(event.target.value) || 30)) * 1000 } })}/></label>
            <label className="api-check"><input type="checkbox" checked={spec.options.followRedirects} onChange={event => patch({ options: { ...spec.options, followRedirects: event.target.checked } })}/>{tr('리디렉션 따라가기 (최대 10회)', 'Follow redirects (up to 10)')}</label>
            <label className="api-check"><input type="checkbox" checked={spec.options.verifyTls} onChange={event => patch({ options: { ...spec.options, verifyTls: event.target.checked } })}/>{tr('TLS 인증서 검증', 'Verify TLS certificates')}</label>
            {!spec.options.verifyTls && <p className="api-hint api-warn"><AlertTriangle size={12}/>{tr('자체 서명 인증서를 쓰는 로컬·개발 서버에만 끄세요.', 'Turn off only for local or development servers with self-signed certificates.')}</p>}
          </div>}
        </div>
      </section>
      <div className="api-resizer" role="separator" aria-orientation="horizontal" aria-label={tr('요청과 응답 크기 조절', 'Resize request and response')} tabIndex={0} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(split * 100)} onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? .15 : event.key === 'End' ? .85 : Math.min(.85, Math.max(.15, split + (event.key === 'ArrowUp' ? -.05 : .05)));
        setSplit(next); try { localStorage.setItem(SPLIT_KEY, String(next)); } catch { /* Session only. */ }
      }} onPointerDown={dragSplit}/>
      <section className="api-response" aria-label={tr('응답', 'Response')} aria-busy={sending}>
        {sending && !result?.response ? <div className="api-response-empty"><Loader2 size={18} className="spin"/><span>{tr('요청 보내는 중…', 'Sending request…')}</span></div>
          : <ResponseView result={result} theme={theme}/>}
      </section>
    </div>
  </div>;
}
