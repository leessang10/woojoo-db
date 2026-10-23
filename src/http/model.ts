/** Pure request logic for the API work area: variables, query params, auth, cURL. */
export type Pair = { key: string; value: string; enabled: boolean; file?: boolean };
export type BodyKind = 'none' | 'json' | 'text' | 'xml' | 'form' | 'multipart';
export type AuthKind = 'none' | 'bearer' | 'basic' | 'apiKey';
export type Auth = { kind: AuthKind; token: string; username: string; password: string; key: string; value: string; in: 'header' | 'query' };
export type Options = { timeoutMs: number; followRedirects: boolean; verifyTls: boolean };
export type RequestSpec = {
  method: string; url: string; params: Pair[]; headers: Pair[];
  body: { kind: BodyKind; text: string; form: Pair[] };
  auth: Auth; options: Options;
};
export type Collection = { id: string; name: string; sort: number };
export type SavedRequest = { id: string; collectionId: string | null; name: string; sort: number; spec: RequestSpec; updatedAt: number };
export type Environment = { id: string; name: string; sort: number; variables: Pair[] };
export type Workspace = { collections: Collection[]; requests: SavedRequest[]; environments: Environment[]; activeEnvironment: string | null };
export type OutgoingBody = { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'multipart'; parts: { name: string; value: string; file: boolean }[] };
export type Outgoing = {
  requestId: string | null; name: string; method: string; url: string; headers: [string, string][];
  body: OutgoingBody; timeoutMs: number; followRedirects: boolean; verifyTls: boolean;
};
export type HttpResponse = {
  status: number; statusText: string; version: string; url: string; headers: [string, string][];
  body: string; base64: boolean; size: number; truncated: boolean; durationMs: number; historyId: string | null;
};
export type HistoryEntry = { id: string; requestId: string | null; name: string; method: string; url: string; status: number | null; durationMs: number; size: number; error: string | null; sentAt: number };
export type HistoryDetail = HistoryEntry & { request: Outgoing; response: HttpResponse | null };

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const emptyPair = (): Pair => ({ key: '', value: '', enabled: true });
export function blankSpec(): RequestSpec {
  return {
    method: 'GET', url: '', params: [], headers: [],
    body: { kind: 'none', text: '', form: [] },
    auth: { kind: 'none', token: '', username: '', password: '', key: '', value: '', in: 'header' },
    options: { timeoutMs: 30_000, followRedirects: true, verifyTls: true },
  };
}
/** Fills fields missing from older saved specs or imports. */
export function normalizeSpec(value: Partial<RequestSpec> | null | undefined): RequestSpec {
  const blank = blankSpec(), spec = value ?? {};
  return {
    ...blank, ...spec,
    params: spec.params ?? [], headers: spec.headers ?? [],
    body: { ...blank.body, ...spec.body }, auth: { ...blank.auth, ...spec.auth }, options: { ...blank.options, ...spec.options },
  };
}

// --- Variables ---------------------------------------------------------------
const VARIABLE = /\{\{\s*([^{}\s]+)\s*\}\}/g;
/** Built-in values, regenerated on every send like other API clients. */
function dynamic(name: string): string | undefined {
  if (name === '$timestamp') return String(Math.floor(Date.now() / 1000));
  if (name === '$isoTimestamp') return new Date().toISOString();
  if (name === '$uuid' || name === '$guid') return crypto.randomUUID();
  if (name === '$randomInt') return String(Math.floor(Math.random() * 1001));
  return undefined;
}
export const variableMap = (variables: Pair[]) => new Map(variables.filter(v => v.enabled && v.key.trim()).map(v => [v.key.trim(), v.value]));
/** Replaces `{{name}}`; unknown names stay as written and are reported. Values are not re-expanded. */
export function resolve(text: string, variables: Map<string, string>, missing?: Set<string>) {
  return text.replace(VARIABLE, (match, name: string) => {
    const value = variables.get(name) ?? dynamic(name);
    if (value === undefined) { missing?.add(name); return match; }
    return value;
  });
}
export const variablesIn = (text: string) => [...text.matchAll(VARIABLE)].map(match => match[1]);

// --- Query params <-> URL ------------------------------------------------------
function splitUrl(url: string) {
  const hash = url.indexOf('#'), fragment = hash < 0 ? '' : url.slice(hash);
  const rest = hash < 0 ? url : url.slice(0, hash), mark = rest.indexOf('?');
  return { base: mark < 0 ? rest : rest.slice(0, mark), query: mark < 0 ? null : rest.slice(mark + 1), fragment };
}
/** Params as typed in the URL. Disabled rows exist only in the table, so they are kept. */
export function paramsFromUrl(url: string, previous: Pair[]): Pair[] {
  const { query } = splitUrl(url);
  const parsed: Pair[] = query === null || query === '' ? [] : query.split('&').map(part => {
    const equals = part.indexOf('=');
    return { key: equals < 0 ? part : part.slice(0, equals), value: equals < 0 ? '' : part.slice(equals + 1), enabled: true };
  });
  return [...parsed, ...previous.filter(param => !param.enabled)];
}
export function urlWithParams(url: string, params: Pair[]): string {
  const { base, fragment } = splitUrl(url);
  const query = params.filter(p => p.enabled && (p.key || p.value)).map(p => p.value || url.includes(`${p.key}=`) ? `${p.key}=${p.value}` : p.key).join('&');
  return base + (query ? `?${query}` : '') + fragment;
}

// --- Building what is sent -----------------------------------------------------
const hasHeader = (headers: [string, string][], name: string) => headers.some(([key]) => key.toLowerCase() === name.toLowerCase());
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const CONTENT_TYPES: Partial<Record<BodyKind, string>> = { json: 'application/json', xml: 'application/xml', text: 'text/plain', form: 'application/x-www-form-urlencoded' };
const encode = (text: string) => encodeURIComponent(text).replace(/%20/g, '+');

/** Resolves variables and auth into the exact request the desktop client sends. */
export function buildOutgoing(spec: RequestSpec, variables: Pair[], meta: { requestId?: string | null; name?: string } = {}) {
  const values = variableMap(variables), missing = new Set<string>();
  const r = (text: string) => resolve(text, values, missing);
  let url = r(spec.url.trim());
  const headers: [string, string][] = spec.headers.filter(h => h.enabled && h.key.trim()).map(h => [r(h.key.trim()), r(h.value)]);
  const auth = spec.auth;
  if (auth.kind === 'bearer' && !hasHeader(headers, 'authorization')) headers.push(['Authorization', `Bearer ${r(auth.token)}`]);
  if (auth.kind === 'basic' && !hasHeader(headers, 'authorization')) headers.push(['Authorization', `Basic ${base64(`${r(auth.username)}:${r(auth.password)}`)}`]);
  if (auth.kind === 'apiKey' && auth.key.trim()) {
    if (auth.in === 'header') headers.push([r(auth.key.trim()), r(auth.value)]);
    else url = urlWithParams(url, [...paramsFromUrl(url, []), { key: encodeURIComponent(r(auth.key.trim())), value: encodeURIComponent(r(auth.value)), enabled: true }]);
  }
  let body: OutgoingBody = { kind: 'none' };
  const kind = spec.body.kind;
  if (kind === 'json' || kind === 'text' || kind === 'xml') body = { kind: 'text', text: r(spec.body.text) };
  else if (kind === 'form') body = { kind: 'text', text: spec.body.form.filter(p => p.enabled && p.key.trim()).map(p => `${encode(r(p.key.trim()))}=${encode(r(p.value))}`).join('&') };
  else if (kind === 'multipart') body = { kind: 'multipart', parts: spec.body.form.filter(p => p.enabled && p.key.trim()).map(p => ({ name: r(p.key.trim()), value: p.file ? p.value : r(p.value), file: !!p.file })) };
  // multipart sets its own boundary header.
  if (CONTENT_TYPES[kind] && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', CONTENT_TYPES[kind]!]);
  const outgoing: Outgoing = {
    requestId: meta.requestId ?? null, name: meta.name ?? '', method: spec.method.trim().toUpperCase() || 'GET', url, headers, body,
    timeoutMs: spec.options.timeoutMs, followRedirects: spec.options.followRedirects, verifyTls: spec.options.verifyTls,
  };
  return { outgoing, missing: [...missing] };
}

/** A request rebuilt from a history entry; variables are already filled in. */
export function specFromOutgoing(outgoing: Outgoing): RequestSpec {
  const spec = blankSpec();
  spec.method = outgoing.method; spec.url = outgoing.url; spec.params = paramsFromUrl(outgoing.url, []);
  spec.headers = outgoing.headers.map(([key, value]) => ({ key, value, enabled: true }));
  spec.options = { timeoutMs: outgoing.timeoutMs, followRedirects: outgoing.followRedirects, verifyTls: outgoing.verifyTls };
  const type = headerValue(outgoing.headers, 'content-type').toLowerCase();
  if (outgoing.body.kind === 'text') spec.body = { kind: type.includes('json') ? 'json' : type.includes('xml') ? 'xml' : 'text', text: outgoing.body.text, form: [] };
  if (outgoing.body.kind === 'multipart') spec.body = { kind: 'multipart', text: '', form: outgoing.body.parts.map(p => ({ key: p.name, value: p.value, enabled: true, file: p.file })) };
  return spec;
}

// --- cURL ---------------------------------------------------------------------
/** Splits a shell command line; understands quotes, backslash escapes and line continuations (\ or ^ or `). */
export function shellWords(command: string): string[] {
  const words: string[] = []; let word = '', quote: '"' | "'" | null = null, started = false;
  const text = command.replace(/[\\^`]\r?\n/g, ' ');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) word += text[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (c === '\\' && i + 1 < text.length) { word += text[++i]; started = true; continue; }
    if (/\s/.test(c)) { if (started) { words.push(word); word = ''; started = false; } continue; }
    word += c; started = true;
  }
  if (started) words.push(word);
  return words;
}
export function parseCurl(command: string): RequestSpec {
  const words = shellWords(command.trim().replace(/^\$\s*/, ''));
  if (!words.length || !/^curl(\.exe)?$/i.test(words[0])) throw new Error('CURL_INVALID');
  const spec = blankSpec(); let method = '', data: string[] = [], get = false, url = '';
  const form: Pair[] = [];
  for (let i = 1; i < words.length; i++) {
    let flag = words[i], value: string | undefined;
    const equals = flag.startsWith('--') ? flag.indexOf('=') : -1;
    if (equals > 0) { value = flag.slice(equals + 1); flag = flag.slice(0, equals); }
    const next = () => value ?? words[++i] ?? '';
    // Short flags may carry their value attached: -XPOST, -HAccept:...
    if (/^-[XHdFuA]./.test(flag)) { value = flag.slice(2); flag = flag.slice(0, 2); }
    switch (flag) {
      case '-X': case '--request': method = next(); break;
      case '-H': case '--header': {
        const header = next(), colon = header.indexOf(':');
        if (colon > 0) spec.headers.push({ key: header.slice(0, colon).trim(), value: header.slice(colon + 1).trim(), enabled: true });
        break;
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': case '--json': {
        data.push(next());
        if (flag === '--json') {
          if (!spec.headers.some(h => h.key.toLowerCase() === 'content-type')) spec.headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
          if (!spec.headers.some(h => h.key.toLowerCase() === 'accept')) spec.headers.push({ key: 'Accept', value: 'application/json', enabled: true });
        }
        break;
      }
      case '--data-urlencode': {
        const part = next(), at = part.indexOf('=');
        data.push(at < 0 ? encodeURIComponent(part) : `${part.slice(0, at)}=${encodeURIComponent(part.slice(at + 1))}`);
        break;
      }
      case '-F': case '--form': case '--form-string': {
        const part = next(), at = part.indexOf('='), name = at < 0 ? part : part.slice(0, at), raw = at < 0 ? '' : part.slice(at + 1);
        const file = flag !== '--form-string' && raw.startsWith('@');
        form.push({ key: name, value: file ? raw.slice(1).split(';')[0] : raw, enabled: true, file });
        break;
      }
      case '-u': case '--user': {
        const user = next(), colon = user.indexOf(':');
        spec.auth = { ...spec.auth, kind: 'basic', username: colon < 0 ? user : user.slice(0, colon), password: colon < 0 ? '' : user.slice(colon + 1) };
        break;
      }
      case '-A': case '--user-agent': spec.headers.push({ key: 'User-Agent', value: next(), enabled: true }); break;
      case '-b': case '--cookie': spec.headers.push({ key: 'Cookie', value: next(), enabled: true }); break;
      case '-e': case '--referer': spec.headers.push({ key: 'Referer', value: next(), enabled: true }); break;
      case '--url': url = next(); break;
      case '-G': case '--get': get = true; break;
      case '-I': case '--head': method = 'HEAD'; break;
      case '-k': case '--insecure': spec.options.verifyTls = false; break;
      case '-L': case '--location': spec.options.followRedirects = true; break;
      case '-m': case '--max-time': { const seconds = Number(next()); if (seconds > 0) spec.options.timeoutMs = Math.round(seconds * 1000); break; }
      // Flags with a value that does not affect the request.
      case '-o': case '--output': case '-w': case '--write-out': case '--connect-timeout': case '--retry': case '-x': case '--proxy': next(); break;
      default: if (!flag.startsWith('-') && !url) url = flag;
    }
  }
  if (!url) throw new Error('CURL_INVALID');
  if (get && data.length) { url += (url.includes('?') ? '&' : '?') + data.join('&'); data = []; }
  spec.url = url;
  spec.params = paramsFromUrl(url, []);
  if (form.length) { spec.body = { kind: 'multipart', text: '', form }; }
  else if (data.length) {
    const text = data.join('&');
    const type = spec.headers.find(h => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
    const json = type.includes('json') || (!type && /^\s*[[{]/.test(text) && isJson(text));
    if (type.includes('x-www-form-urlencoded') || (!type && !json && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(text))) {
      spec.body = { kind: 'form', text: '', form: text.split('&').map(part => { const at = part.indexOf('='); return { key: decode(part.slice(0, at < 0 ? undefined : at)), value: at < 0 ? '' : decode(part.slice(at + 1)), enabled: true }; }) };
      spec.headers = spec.headers.filter(h => h.key.toLowerCase() !== 'content-type');
    } else {
      spec.body = { kind: json ? 'json' : type.includes('xml') ? 'xml' : 'text', text: json ? prettyJson(text) : text, form: [] };
      if (json && type === 'application/json') spec.headers = spec.headers.filter(h => h.key.toLowerCase() !== 'content-type');
    }
  }
  spec.method = (method || (data.length || form.length ? 'POST' : 'GET')).toUpperCase();
  return spec;
}
const decode = (text: string) => { try { return decodeURIComponent(text.replace(/\+/g, ' ')); } catch { return text; } };
const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
/** A POSIX-shell cURL command for the resolved request. */
export function toCurl(outgoing: Outgoing): string {
  const lines = [`curl -X ${outgoing.method} ${quote(outgoing.url)}`];
  for (const [key, value] of outgoing.headers) lines.push(`-H ${quote(`${key}: ${value}`)}`);
  if (outgoing.body.kind === 'text' && outgoing.body.text) lines.push(`--data-raw ${quote(outgoing.body.text)}`);
  if (outgoing.body.kind === 'multipart') for (const part of outgoing.body.parts) lines.push(`-F ${quote(`${part.name}=${part.file ? '@' : ''}${part.value}`)}`);
  if (!outgoing.verifyTls) lines.push('-k');
  if (outgoing.followRedirects) lines.push('-L');
  return lines.join(' \\\n  ');
}

// --- Display helpers -------------------------------------------------------------
export function isJson(text: string) { try { JSON.parse(text); return true; } catch { return false; } }
export function prettyJson(text: string) { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } }
export const headerValue = (headers: [string, string][], name: string) => headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? '';
export type BodyView = 'json' | 'html' | 'xml' | 'image' | 'text' | 'binary';
export function bodyView(response: HttpResponse): BodyView {
  const type = headerValue(response.headers, 'content-type').toLowerCase();
  if (response.base64) return type.startsWith('image/') ? 'image' : 'binary';
  if (type.includes('json') || (!type && isJson(response.body))) return 'json';
  if (type.includes('html')) return 'html';
  if (type.includes('xml')) return 'xml';
  return 'text';
}
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'], power = Math.min(units.length, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power - 1]}`;
}
export const formatDuration = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
export const statusTone = (status: number | null) => status === null ? 'error' : status >= 500 ? 'error' : status >= 400 ? 'warn' : status >= 300 ? 'info' : 'ok';
/** A short name for an unsaved request, from its path. */
export function requestTitle(spec: RequestSpec) {
  const { base } = splitUrl(spec.url.trim());
  const path = base.replace(/^[a-z]+:\/\//i, '').replace(/^[^/]*/, '');
  return path && path !== '/' ? path : base.replace(/^[a-z]+:\/\//i, '') || '';
}
const SPEC_KEYS: (keyof RequestSpec)[] = ['method', 'url', 'params', 'headers', 'body', 'auth', 'options'];
export const sameSpec = (a: RequestSpec, b: RequestSpec) => SPEC_KEYS.every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));

// --- Tabs -------------------------------------------------------------------------
export type ApiTab = { id: string; requestId: string | null; name: string; collectionId: string | null; spec: RequestSpec; saved: RequestSpec | null; historyId?: string };
const TABS_KEY = 'woojoo-api-tabs-v1';
export function readApiTabs(): { tabs: ApiTab[]; active: string } {
  try {
    const value = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}');
    const tabs: ApiTab[] = Array.isArray(value.tabs) ? value.tabs.filter((tab: ApiTab) => tab && typeof tab.id === 'string').map((tab: ApiTab) => ({ ...tab, spec: normalizeSpec(tab.spec), saved: tab.saved ? normalizeSpec(tab.saved) : null })) : [];
    return { tabs, active: tabs.some(tab => tab.id === value.active) ? value.active : tabs[0]?.id ?? '' };
  } catch { return { tabs: [], active: '' }; }
}
export function writeApiTabs(tabs: ApiTab[], active: string) {
  try { localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active })); } catch { /* Session-only tabs. */ }
}
