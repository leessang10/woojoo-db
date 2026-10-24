import { SortableTable } from '../components/SortableTable';
import { useMemo, useState } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { json as jsonLanguage } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { AlertTriangle, Copy, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '../i18n';
import type { Theme } from '../theme';
import { bodyView, formatDuration, formatSize, headerValue, prettyJson, statusTone, type HttpResponse } from './model';

/** The latest outcome of a tab: a response, an error, or the ticket of a request in flight. */
export type Result = { response?: HttpResponse; error?: string; ticket?: string; sentAt?: number; stale?: boolean };
const readOnly = [EditorView.editable.of(false), EditorView.lineWrapping];

export function ResponseView({ result, theme }: { result?: Result; theme: Theme }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [view, setView] = useState<'body' | 'headers'>('body');
  const [raw, setRaw] = useState(false);
  const response = result?.response;
  const kind = response ? bodyView(response) : 'text';
  const text = useMemo(() => !response ? '' : kind === 'json' && !raw ? prettyJson(response.body) : response.body, [response, kind, raw]);
  const extensions = useMemo(() => kind === 'json' && !raw ? [...readOnly, jsonLanguage()] : readOnly, [kind, raw]);

  if (result?.error && !response) return <div className="api-response-empty api-response-error" role="alert"><AlertTriangle size={18}/><strong>{tr('요청이 실패했습니다', 'The request failed')}</strong><span>{result.error}</span></div>;
  if (!response) return <div className="api-response-empty"><Send size={18}/><span>{tr('보내기를 누르면 응답이 여기에 표시됩니다.', 'Send the request to see the response here.')}</span><small>Ctrl/Cmd+Enter</small></div>;
  const tone = statusTone(response.status);
  return <div className="api-response-body">
    {result?.error && <div className="api-error-banner" role="alert">{result.error}</div>}
    {(result?.stale || result?.ticket) && <p className="api-missing" role="status">{tr('이전 성공 응답', 'Previous successful response')}{result.sentAt && ` · ${new Date(result.sentAt).toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US')}`}</p>}
    <div className="api-response-bar">
      <div className="api-sections" role="tablist" aria-label={tr('응답 보기', 'Response view')}>
        <Button variant="ghost" size="bare" role="tab" className="api-section" aria-selected={view === 'body'} onClick={() => setView('body')}>{tr('본문', 'Body')}</Button>
        <Button variant="ghost" size="bare" role="tab" className="api-section" aria-selected={view === 'headers'} onClick={() => setView('headers')}>{tr('헤더', 'Headers')}<small>{response.headers.length}</small></Button>
      </div>
      {view === 'body' && kind === 'json' && <Button variant="ghost" size="xs" aria-pressed={raw} onClick={() => setRaw(value => !value)}>{raw ? tr('정렬해서 보기', 'Pretty') : tr('원문 보기', 'Raw')}</Button>}
      <span className="tabs-spacer"/>
      <span className="api-status" data-tone={tone}>{response.status} {response.statusText}</span>
      <span className="api-meta">{formatDuration(response.durationMs)}</span>
      <span className="api-meta">{formatSize(response.size)}</span>
      {view === 'body' && !response.base64 && <Button variant="ghost" size="bare" className="icon-button" title={tr('본문 복사', 'Copy body')} aria-label={tr('본문 복사', 'Copy body')} onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}><Copy size={13}/></Button>}
    </div>
    {response.truncated && <p className="api-missing"><AlertTriangle size={13}/>{tr('응답이 커서 앞부분만 표시합니다.', 'The response is large; only the beginning is shown.')}</p>}
    {view === 'headers' ? <div className="api-headers"><SortableTable className="api-pairs api-pairs-readonly"><thead><tr><th>{tr("헤더", "Header")}</th><th>{tr("값", "Value")}</th></tr></thead><tbody>
      {response.headers.map(([key, value], index) => <tr key={index}><td>{key}</td><td>{value}</td></tr>)}
      <tr><td>{tr('최종 URL', 'Final URL')}</td><td>{response.url}</td></tr>
      <tr><td>{tr('프로토콜', 'Protocol')}</td><td>{response.version}</td></tr>
    </tbody></SortableTable></div>
      : kind === 'image' ? <div className="api-image"><img alt={tr('응답 이미지', 'Response image')} src={`data:${headerValue(response.headers, 'content-type')};base64,${response.body}`}/></div>
      : kind === 'binary' ? <div className="api-response-empty"><span>{tr('바이너리 응답입니다', 'Binary response')} · {headerValue(response.headers, 'content-type') || 'application/octet-stream'} · {formatSize(response.size)}</span></div>
      : <div className="api-editor api-response-editor"><CodeMirror value={text} height="100%" theme={theme === 'dark' ? oneDark : 'light'} editable={false} extensions={extensions} basicSetup={{ highlightActiveLine: false }} aria-label={tr('응답 본문', 'Response body')}/></div>}
  </div>;
}
