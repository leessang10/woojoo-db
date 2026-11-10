import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Eye, EyeOff, LayoutTemplate, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalSurface } from '@/components/ModalSurface';
import { useLanguage } from '../i18n';
import * as store from './api';
import { buildOutgoing } from './model';
import { API_TEMPLATES, looksLive, pickJson, templateFields, templateVariables, type ApiTemplate, type TemplateFetch } from './templates';

/** Picks a ready-made collection, then walks through where to find each key. */
export function TemplateDialog({ onCreate, onClose }: { onCreate: (template: ApiTemplate, values: Record<string, string>) => Promise<void>; onClose: () => void }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const text = (value: { ko: string; en: string }) => language === 'ko' ? value.ko : value.en;
  const [template, setTemplate] = useState<ApiTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false), [fetchResult, setFetchResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  function choose(next: ApiTemplate) {
    setTemplate(next); setError(''); setFetchResult(null); setShown(new Set());
    setValues(Object.fromEntries(templateFields(next).map(field => [field.key, field.value ?? ''])));
  }
  const fields = template ? templateFields(template) : [];
  const live = fields.filter(field => looksLive(field, values[field.key] ?? ''));
  const blank = fields.filter(field => field.required && !(values[field.key] ?? '').trim());

  async function fetchValue(fetch: TemplateFetch) {
    if (!template) return;
    setFetching(true); setFetchResult(null);
    try {
      const { outgoing, missing } = buildOutgoing(fetch.request, templateVariables(template, values));
      if (missing.length) { setFetchResult({ ok: false, message: tr(`먼저 채워 주세요: ${missing.join(', ')}`, `Fill these first: ${missing.join(', ')}`) }); return; }
      const response = await store.send(outgoing, crypto.randomUUID());
      const value = response.status < 300 ? pickJson(response.body, fetch.pick) : null;
      if (value) { setValues(previous => ({ ...previous, [fetch.into]: value })); setFetchResult({ ok: true, message: tr('토큰을 받아 채웠어요.', 'Token fetched and filled in.') }); }
      else setFetchResult({ ok: false, message: tr(`받지 못했어요 (HTTP ${response.status}). Client ID와 Secret이 Sandbox 값인지 확인하세요.`, `Could not fetch it (HTTP ${response.status}). Check that the Client ID and Secret are Sandbox values.`) + (response.body ? ` ${response.body.slice(0, 200)}` : '') });
    } catch (reason) { setFetchResult({ ok: false, message: String(reason) }); }
    finally { setFetching(false); }
  }
  async function create() {
    if (!template || live.length) return;
    setBusy(true); setError('');
    try { await onCreate(template, values); onClose(); }
    catch (reason) { setError(tr(`만들지 못했어요: ${reason}`, `Could not create it: ${reason}`)); }
    finally { setBusy(false); }
  }

  const title = template ? tr(`${template.name} 템플릿`, `${template.name} template`) : tr('템플릿에서 컬렉션 추가', 'Add a collection from a template');
  return <ModalSurface title={title} onClose={onClose} locked={busy}>
    <section className="modal api-template-modal" role="dialog" aria-modal="true">
      <div className="modal-heading">
        <div className="api-template-heading">
          {template && <Button variant="ghost" size="icon-sm" aria-label={tr('템플릿 목록으로', 'Back to templates')} onClick={() => setTemplate(null)} disabled={busy}><ArrowLeft size={16}/></Button>}
          <h2>{title}</h2>
        </div>
        <Button variant="ghost" size="bare" onClick={onClose} disabled={busy} aria-label={tr('닫기', 'Close')}><X size={20}/></Button>
      </div>

      {!template ? <>
        <p className="modal-description">{tr('요청이 미리 들어 있는 컬렉션과 테스트용 환경을 함께 만들어요. 고른 다음 안내를 따라 키만 붙여 넣으면 돼요.', 'Creates a collection of ready-made requests plus a test environment. Pick one, then paste in the keys as guided.')}</p>
        <div className="api-template-list">
          {API_TEMPLATES.map(item => <Button key={item.id} variant="outline" size="bare" className="api-template-card" onClick={() => choose(item)}>
            <span className="api-template-logo" data-template={item.id} aria-hidden="true">{item.name.slice(0, 1)}</span>
            <span className="api-template-text"><strong>{item.name}</strong><span>{text(item.summary)}</span></span>
            <small>{tr(`요청 ${item.requests.length}개 · ${item.steps.length}단계`, `${item.requests.length} requests · ${item.steps.length} steps`)}</small>
          </Button>)}
        </div>
      </> : <>
        <p className="modal-description">{tr(`순서대로 따라 하면서 키를 붙여 넣으세요. "${template.environment}" 환경에 저장되고, 비워 둔 값은 나중에 [환경 변수]에서 채울 수 있어요.`, `Follow the steps and paste in each key. Values go to the "${template.environment}" environment; anything left blank can be filled later under Environments.`)}</p>
        <ol className="api-template-steps">
          {template.steps.map((step, index) => {
            const filled = (key: string) => !!(values[key] ?? '').trim(), stepFields = step.fields ?? [];
            // Optional-only steps count as done once something is typed in; a default value alone does not count.
            const done = stepFields.some(field => field.required)
              ? stepFields.every(field => !field.required || filled(field.key))
              : stepFields.some(field => filled(field.key) && values[field.key] !== field.value);
            return <li key={index} className="api-template-step">
              <span className="api-template-number" data-done={done || undefined} aria-hidden="true">{done ? <Check size={12}/> : index + 1}</span>
              <div className="api-template-step-body">
                <h3>{text(step.title)}</h3>
                <p>{text(step.body)}</p>
                {step.link && <a className="api-template-link" href={step.link.url} target="_blank" rel="noreferrer"><ExternalLink size={12}/>{text(step.link.label)}<span>{step.link.url.replace(/^https:\/\//, '')}</span></a>}
                {step.fields?.map(field => {
                  const value = values[field.key] ?? '', visible = !field.secret || shown.has(field.key);
                  return <label key={field.key} className="api-template-field">
                    <span>{text(field.label)}{field.required && <em>{tr('필수', 'Required')}</em>}<code>{`{{${field.key}}}`}</code></span>
                    <span className="api-template-input">
                      <Input value={value} type={visible ? 'text' : 'password'} placeholder={field.placeholder} spellCheck={false} autoComplete="off" disabled={busy}
                        aria-invalid={looksLive(field, value) || undefined} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))}/>
                      {field.secret && <Button type="button" variant="ghost" size="icon-sm" aria-label={visible ? tr('숨기기', 'Hide') : tr('보기', 'Show')} onClick={() => setShown(previous => { const next = new Set(previous); if (next.has(field.key)) next.delete(field.key); else next.add(field.key); return next; })}>{visible ? <EyeOff size={14}/> : <Eye size={14}/>}</Button>}
                    </span>
                    {looksLive(field, value) && <span className="api-template-warn" role="alert"><AlertTriangle size={12}/>{tr('실서비스(live) 키처럼 보여요. 템플릿에는 테스트 키만 넣어 주세요.', 'This looks like a live key. Use a test key here.')}</span>}
                  </label>;
                })}
                {step.fetch && <div className="api-template-fetch">
                  <Button type="button" variant="outline" size="sm" disabled={fetching || busy} onClick={() => void fetchValue(step.fetch!)}>{fetching ? <Loader2 size={14} className="animate-spin"/> : null}{text(step.fetch.label)}</Button>
                  {fetchResult && <span className={fetchResult.ok ? 'api-hint' : 'api-template-warn'} role="status">{fetchResult.message}</span>}
                </div>}
              </div>
            </li>;
          })}
        </ol>
        <details className="api-template-requests">
          <summary>{tr(`만들어질 요청 ${template.requests.length}개`, `${template.requests.length} requests to create`)}</summary>
          <ul>{template.requests.map(item => <li key={item.name}><span className="api-method-tag" data-method={item.spec.method}>{item.spec.method}</span><span>{item.name}</span><small>{text(item.note)}</small></li>)}</ul>
          <a className="api-template-link" href={template.docs} target="_blank" rel="noreferrer"><ExternalLink size={12}/>{tr('공식 API 문서', 'Official API reference')}</a>
        </details>
        {blank.length > 0 && !live.length && <p className="api-hint api-template-note">{tr(`아직 비어 있어요: ${blank.map(field => text(field.label)).join(', ')}. 지금 만들고 나중에 채워도 돼요.`, `Still blank: ${blank.map(field => text(field.label)).join(', ')}. You can create now and fill them later.`)}</p>}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button variant="outline" onClick={onClose} disabled={busy}>{tr('취소', 'Cancel')}</Button>
          <Button onClick={() => void create()} disabled={busy || live.length > 0}><LayoutTemplate size={14}/>{tr('컬렉션 만들기', 'Create collection')}</Button>
        </div>
      </>}
    </section>
  </ModalSurface>;
}
