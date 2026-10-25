import { NativeSelect } from '@/components/ui/native-select';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '../components/ConfirmProvider';
import { text } from './model';
import { DockerGraph } from './Graph';
import type { Theme } from '../theme';
import { composeAction, composeCreate, composeForget, composeImport, composeList, composePreview, composeRead, composeSave, composeTopology, generateCompose, newService, type ComposeDocument, type ComposePreview, type ComposeProject, type WizardService } from './compose';

type Props = { createRevision?: number; toolbar?: ReactNode; context: string; language: string; theme: Theme; disabled: boolean; onChanged: () => void; editProject?: string; editRevision?: number };
export function ComposeManager({ context, language, theme, disabled, onChanged, editProject, editRevision, toolbar, createRevision }: Props) {
  const tr = (ko: string, en: string) => text(language, ko, en);
  const { requestConfirm } = useConfirm();
  const [projects, setProjects] = useState<ComposeProject[]>([]);
  const [open, setOpen] = useState(false), [wizard, setWizard] = useState(false), [step, setStep] = useState(0);
  const [doc, setDoc] = useState<ComposeDocument | null>(null), [source, setSource] = useState('');
  const [preview, setPreview] = useState<ComposePreview | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [name, setName] = useState('my-app');
  const [services, setServices] = useState<WizardService[]>([newService('postgres')]);
  const lock = useRef(false), currentContext = useRef(context); currentContext.current = context;
  const dirty = !!doc && source !== doc.source;
  const visualServices = wizard ? services.map(s => ({ name: s.name, image: s.image, build: false, ports: s.ports.split('\n').filter(Boolean), volumes: s.volumes.split('\n').filter(Boolean), depends: s.depends, profiles: [] })) : preview?.services;
  async function refresh() { setProjects(await composeList() ?? []); }
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  useEffect(() => { setOpen(false); setDoc(null); setPreview(null); setError(''); }, [context]);
  async function task(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function load(project: ComposeProject) {
    const target = context;
    await task(async () => {
      const result = await composeRead(project.id);
      if (target !== currentContext.current) return;
      setDoc(result); setSource(result.source); setPreview(null); setWizard(false); setOpen(true);
    });
  }
  useEffect(() => {
    if (!editRevision || !editProject) return;
    const p = projects.find(p => p.context === context && p.name === editProject);
    if (p) void load(p);
    else setError(tr('이 프로젝트의 Compose 파일을 먼저 불러오세요. 실행 시 -p로 지정한 이름은 Compose의 name에도 맞춰 주세요.', 'Import this project’s Compose file first. Match its name to any -p name used when launching.'));
  }, [editRevision]);
  useEffect(() => {
    if (!createRevision || disabled || lock.current || !context) return;
    setDoc(null); setPreview(null); setWizard(true); setStep(0); setName('my-app');
    setServices([newService('postgres')]); setError(''); setNotice(''); setOpen(true);
  }, [createRevision]);
  async function importProject() {
    await task(async () => {
      const target = context; const next = await composeImport(target); await refresh();
      if (next && currentContext.current === target) { setDoc(next); setSource(next.source); setPreview(null); setWizard(false); }
    });
  }
  async function close() {
    if (busy) return;
    if ((dirty || wizard) && !await requestConfirm(tr('저장하지 않은 편집 내용을 닫을까요?', 'Discard unsaved edits?'))) return;
    setOpen(false);
  }
  function updateService(index: number, patch: Partial<WizardService>) { setServices(list => list.map((s, i) => i === index ? { ...s, ...patch } : s)); }
  async function validate() { if (!doc) return; await task(async () => setPreview(await composePreview(doc.project.id, source))); }
  async function save() {
    if (!doc || !preview) return;
    await task(async () => {
      const next = await composeSave(doc.project.id, source, doc.source);
      setDoc(next); setSource(next.source); setPreview(null);
      setNotice(tr('파일을 저장했습니다. 실행에 반영하려면 다시 검증 후 실행·적용하세요.', 'File saved. Validate again and apply to update containers.'));
    });
  }
  async function act(action: string, service = '') {
    if (!doc || !preview || dirty) return;
    const target = doc.project;
    await task(async () => {
      const message = action === 'up'
        ? tr('설정이 바뀐 컨테이너는 다시 생성될 수 있습니다. 이미지 다운로드·빌드와 의존 서비스 시작이 발생할 수 있습니다. 마운트 밖의 컨테이너 내부 데이터는 재생성 시 사라집니다.', 'Changed containers may be recreated. Images may be downloaded/built and dependencies started. Data outside mounts is lost on recreation.')
        : action === 'down' || action === 'remove'
          ? tr('컨테이너를 중지하고 삭제합니다. 볼륨·이미지와 원본 파일은 보존합니다. 익명 볼륨은 다음 실행 시 자동 연결되지 않을 수 있습니다.', 'Stops and removes containers. Volumes, images and source files are preserved. Anonymous volumes may not reconnect on the next run.')
          : tr('실행 중인 서비스가 중단될 수 있습니다.', 'Running services may be interrupted.');
      if (!await requestConfirm(`${target.context} / ${target.name}${service ? ` / ${service}` : ''}\n${message}`, { title: tr('Compose 작업 확인', 'Confirm Compose action'), confirmLabel: action, destructive: action !== 'up' })) return;
      if (currentContext.current !== target.context) return;
      await composeAction(target.id, preview.token, action, service);
      setNotice(tr('명령을 완료했습니다. 실제 실행·건강 상태는 관계도에서 확인하세요.', 'Command completed. Check runtime and health in the topology.'));
      onChanged();
    });
  }
  const buttons = (service = '') => <div className="compose-actions">{(['up', 'stop', 'restart', service ? 'remove' : 'down'] as const).map(action => <Button key={action} size="sm" variant={action === 'down' || action === 'remove' ? 'destructive' : action === 'up' ? 'default' : 'outline'} disabled={busy || dirty || !preview} onClick={() => void act(action, service)}>{({ up: tr('실행·적용', 'Run / apply'), stop: tr('중지', 'Stop'), restart: tr('재시작', 'Restart'), down: tr('프로젝트 내리기', 'Take down'), remove: tr('컨테이너 삭제', 'Remove containers') })[action]}</Button>)}</div>;
  return <>
    <div className="compose-launchers">{toolbar}</div>
    {!!projects.filter(p => p.context === context).length && <div className="compose-registered"><span>{tr('연결한 Compose 파일', 'Linked Compose files')}</span>{projects.filter(p => p.context === context).map(p => <span key={p.id} className="compose-registration"><Button size="sm" variant="ghost" disabled={disabled || busy} title={p.path} onClick={() => void load(p)}>{p.name}</Button><Button size="sm" variant="ghost" disabled={busy} aria-label={`${p.name} ${tr("연결 해제", "Unlink")}`} onClick={() => void task(async () => { if (!await requestConfirm(tr("목록에서만 연결을 해제합니다. 파일과 리소스는 유지됩니다.", "Unlink only. Files and resources remain."))) return; await composeForget(p.id); await refresh(); })}>×</Button></span>)}</div>}
    {error && !open && <div role="alert" className="docker-banner docker-warning">{error}</div>}
    <Dialog.Root open={open} onOpenChange={value => { if (!value) void close(); }}>
      <Dialog.Portal><Dialog.Overlay className="compose-overlay"/><Dialog.Content className={`compose-dialog ${wizard ? 'compose-registration-dialog' : ''}`} onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { e.preventDefault(); void close(); }}>
        <header><Dialog.Title>{wizard ? tr('새 Compose 프로젝트', 'New Compose project') : doc?.project.name}</Dialog.Title><Button variant="ghost" size="sm" disabled={busy} onClick={() => void close()}>{tr('닫기', 'Close')}</Button></header>
        <Dialog.Description>{wizard ? tr('프로젝트 → 서비스 → 설정 → 미리보기·저장', 'Project → Services → Settings → Preview / save') : `${doc?.project.context} · ${doc?.project.path}`}</Dialog.Description>
        {error && <div role="alert" className="docker-banner docker-warning">{error}</div>}{notice && <div role="status" className="docker-banner">{notice}</div>}
        {busy && <div role="status">{tr('작업 중… 이미지 다운로드·빌드는 최대 3분까지 기다립니다.', 'Working… Image downloads/builds may take up to 3 minutes.')}</div>}
        <fieldset disabled={busy}>
          {visualServices && (!wizard || step > 0) && <details className="compose-graph-preview" open><summary>{tr('구성 미리보기', 'Configuration preview')}</summary><div style={{ height: 300, display: 'flex' }}><DockerGraph graph={composeTopology(visualServices)} selected="" onSelect={() => {}} language={language} theme={theme} storageKey={`woojoo-compose-preview:${doc?.project.id || 'wizard'}`}/></div></details>}
          {wizard ? <>
            <div className="compose-steps">{[tr('프로젝트', 'Project'), tr('서비스', 'Services'), tr('설정', 'Settings'), tr('미리보기', 'Preview')].map((label, i) => <span key={i} aria-current={step === i ? 'step' : undefined}>{i + 1}. {label}</span>)}</div>
            {step === 0 && <><div className="compose-import-option"><span>{tr('기존 Compose 파일이 있나요?', 'Already have a Compose file?')}</span><Button variant="outline" size="sm" onClick={() => void importProject()}>{tr('Compose 불러오기', 'Import Compose')}</Button></div><label>{tr('프로젝트 이름', 'Project name')}<Input aria-label={tr("프로젝트 이름", "Project name")} value={name} onChange={e => setName(e.target.value)}/><small>{tr('마지막 단계에서 파일 저장 위치를 선택합니다.', 'Choose the file location in the last step.')}</small></label></>}
            {step === 1 && <><p>{tr('서비스마다 컨테이너를 생성합니다. 템플릿은 나중에 수정할 수 있습니다.', 'Each service creates a container. Templates can be edited.')}</p><div className="compose-actions">{['postgres', 'redis', 'custom'].map(template => <Button key={template} variant="default" size="sm" onClick={() => setServices(list => { const s = newService(template); let name = s.name; let n = 2; while (list.some(item => item.name === name)) name = `${s.name}${n++}`; return [...list, { ...s, name, volumes: name === s.name ? s.volumes : s.volumes.replaceAll(`${s.name}-data:`, `${name}-data:`), ports: list.some(item => item.ports === s.ports) ? '' : s.ports }]; })}>+ {template}</Button>)}</div>{services.map((s, i) => <div className="compose-service" key={i}><label>{tr('서비스 이름', 'Service name')}<Input value={s.name} onChange={e => updateService(i, { name: e.target.value })}/></label><label>{tr('이미지', 'Image')}<Input value={s.image} onChange={e => updateService(i, { image: e.target.value })}/></label><Button variant="destructive" size="sm" onClick={() => setServices(list => list.filter((_, index) => index !== i).map(item => ({ ...item, depends: item.depends.filter(d => d !== s.name) })))}>{tr('서비스 제외', 'Remove service')}</Button></div>)}</>}
            {step === 2 && <>{services.map((s, i) => <section className="compose-service" key={i}><h3>{s.name}</h3><div className="compose-fields"><label>{tr('포트 · 호스트:컨테이너, 한 줄에 하나', 'Ports · host:container, one per line')}<textarea value={s.ports} onChange={e => updateService(i, { ports: e.target.value })}/><small>{tr('127.0.0.1에만 공개합니다.', 'Published on 127.0.0.1 only.')}</small></label><label>{tr('볼륨 · 이름:/컨테이너경로', 'Volumes · name:/container/path')}<textarea value={s.volumes} onChange={e => updateService(i, { volumes: e.target.value })}/></label><label>{tr('환경변수 · KEY=value', 'Environment · KEY=value')}<textarea spellCheck={false} value={s.environment} onChange={e => updateService(i, { environment: e.target.value })}/><small>{tr('파일에 평문 저장됩니다. 기본 비밀번호 change-me를 변경하세요.', 'Saved in plain text. Replace the default change-me password.')}</small></label><label>{tr('실행 명령', 'Command')}<Input value={s.command} onChange={e => updateService(i, { command: e.target.value })}/></label><label>{tr('상태 검사 명령', 'Healthcheck command')}<Input value={s.healthcheck} onChange={e => updateService(i, { healthcheck: e.target.value })}/></label><label>{tr('재시작 정책', 'Restart policy')}<NativeSelect value={s.restart} onChange={e => updateService(i, { restart: e.target.value })}>{['no', 'unless-stopped', 'always', 'on-failure'].map(v => <option key={v}>{v}</option>)}</NativeSelect></label></div><p>{tr('먼저 시작할 서비스 (건강 상태 대기는 Compose 편집에서 설정)', 'Start dependencies (configure health waiting in Compose source)')}</p>{services.filter(other => other.name !== s.name).map(other => <label className="compose-checkbox" key={other.name}><input type="checkbox" checked={s.depends.includes(other.name)} onChange={e => updateService(i, { depends: e.target.checked ? [...s.depends, other.name] : s.depends.filter(d => d !== other.name) })}/>{other.name}</label>)}</section>)}</>}
            {step === 3 && <><p>{tr('저장 전 구성을 확인하세요. 저장만으로 실행되지는 않습니다.', 'Review the configuration before saving. Saving does not start the project.')}</p><pre className="compose-source-preview">{source}</pre><Button disabled={busy} onClick={() => void task(async () => { const next = await composeCreate(context, name, source); if (next) { await refresh(); setDoc(next); setSource(next.source); setWizard(false); setPreview(await composePreview(next.project.id, next.source)); } })}>{tr('위치 선택·저장', 'Choose location / save')}</Button></>}
            <footer><Button variant="outline" disabled={step === 0} onClick={() => setStep(s => s - 1)}>{tr('이전', 'Back')}</Button>{step < 3 && <Button onClick={() => { try { if (step === 2) setSource(generateCompose(name, services)); setError(''); setStep(s => s + 1); } catch (e) { setError(String(e)); } }}>{tr('다음', 'Next')}</Button>}</footer>
          </> : doc && <>
            <p>{tr('파일의 name을 바꿔도 실행 대상 프로젝트는 변경되지 않습니다.', 'Changing name in the file does not change the target project.')}</p>
            <label>Compose YAML / JSON<textarea className="compose-editor" spellCheck={false} value={source} onChange={e => { setSource(e.target.value); setPreview(null); }}/></label>
            {dirty && <details><summary>{tr('저장 전 원본과 비교', 'Compare with saved source')}</summary><div className="compose-diff"><pre>{doc.source}</pre><pre>{source}</pre></div></details>}
            <div className="compose-actions"><Button variant="outline" onClick={() => void validate()}>{tr('검증·미리보기', 'Validate / preview')}</Button><Button disabled={!dirty || !preview} onClick={() => void save()}>{tr('파일 저장', 'Save file')}</Button><Button variant="ghost" onClick={() => void task(async () => { if (!await requestConfirm(tr('목록에서만 연결을 해제합니다. 파일과 실행 중인 리소스는 유지됩니다.', 'Remove this link only. Files and running resources remain.'))) return; await composeForget(doc.project.id); await refresh(); setOpen(false); })}>{tr('연결 해제', 'Unlink')}</Button></div>
            {preview && <><h3>{tr('적용할 구성', 'Configuration to apply')}</h3><p>{tr('실행·적용하면 설정이 바뀐 컨테이너가 다시 생성될 수 있습니다.', 'Applying changes may recreate containers whose configuration has changed.')}</p>{buttons()}<div className="compose-topology">{preview.services.map(s => <article className="compose-service" key={s.name}><div className="compose-flow"><span>{s.image || (s.build ? 'Dockerfile' : '—')}</span><b>→ {s.name}</b></div>{s.ports.map((p, i) => <code key={i}>↳ {p}</code>)}{s.volumes.map((v, i) => <code key={i}>↳ {v}</code>)}{!!s.depends.length && <p>{tr('먼저 시작', 'Dependencies')}: {s.depends.join(' → ')}</p>}{!!s.profiles.length && <p>{tr('프로필 서비스 · 개별 실행으로 활성화', 'Profile service · activate by running individually')}: {s.profiles.join(', ')}</p>}{buttons(s.name)}</article>)}</div></>}
          </>}
        </fieldset>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </>;
}
