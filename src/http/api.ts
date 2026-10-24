import { invoke } from '@tauri-apps/api/core';
import { desktop } from '../api';
import type { EnvironmentFormat } from './environment-export';
import { headerValue, type Collection, type Environment, type HistoryDetail, type HistoryEntry, type HttpResponse, type Outgoing, type SavedRequest, type Workspace } from './model';

/**
 * Desktop builds store everything in a local SQLite file and send through Rust.
 * The browser preview keeps an in-memory copy and sends with fetch (CORS applies).
 */
const memory: Workspace & { history: HistoryDetail[] } = { collections: [], requests: [], environments: [], activeEnvironment: null, history: [] };
const controllers = new Map<string, AbortController>();
const upsert = <T extends { id: string }>(list: T[], item: T) => { const index = list.findIndex(x => x.id === item.id); if (index < 0) list.push(item); else list[index] = item; };

export const loadWorkspace = () => desktop ? invoke<Workspace>('http_workspace') : Promise.resolve(structuredClone({ ...memory, history: undefined }) as Workspace);
export async function saveCollection(collection: Collection) {
  if (desktop) return invoke<void>('http_save_collection', { collection });
  upsert(memory.collections, structuredClone(collection));
}
export async function saveRequest(request: SavedRequest): Promise<number> {
  if (desktop) return invoke<number>('http_save_request', { request });
  const updatedAt = Date.now(); upsert(memory.requests, structuredClone({ ...request, updatedAt })); return updatedAt;
}
export async function saveEnvironment(environment: Environment) {
  if (desktop) return invoke<void>('http_save_environment', { environment });
  upsert(memory.environments, structuredClone(environment));
}
export async function exportEnvironmentFile(name: string, format: EnvironmentFormat, text: string): Promise<boolean> {
  const base = name.replace(/\.(?:env|json|ya?ml)$/i, '').replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 100) || 'environment';
  if (desktop) return invoke<boolean>('save_environment_export', { name: base, format, text });
  const types = { env: 'text/plain', json: 'application/json', yml: 'application/yaml' };
  const url = URL.createObjectURL(new Blob([text], { type: `${types[format]};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url; link.download = `${base}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function deleteItem(table: 'collection' | 'request' | 'environment', id: string) {
  if (desktop) return invoke<void>('http_delete', { table, id });
  if (table === 'collection') { memory.collections = memory.collections.filter(x => x.id !== id); memory.requests = memory.requests.filter(x => x.collectionId !== id); }
  if (table === 'request') memory.requests = memory.requests.filter(x => x.id !== id);
  if (table === 'environment') memory.environments = memory.environments.filter(x => x.id !== id);
}
export async function setActiveEnvironment(id: string | null) {
  if (desktop) return invoke<void>('http_set_active_environment', { id });
  memory.activeEnvironment = id;
}
export async function historyList(search: string, offset = 0): Promise<HistoryEntry[]> {
  if (desktop) return invoke<HistoryEntry[]>('http_history', { search, offset });
  const term = search.toLowerCase();
  return memory.history.filter(x => !term || x.url.toLowerCase().includes(term) || x.name.toLowerCase().includes(term)).slice(offset, offset + 100).map(({ request: _r, response: _s, ...entry }) => entry);
}
export async function historyDetail(id: string): Promise<HistoryDetail | null> {
  if (desktop) return invoke<HistoryDetail | null>('http_history_detail', { id });
  return structuredClone(memory.history.find(x => x.id === id) ?? null);
}
export async function clearHistory() {
  if (desktop) return invoke<void>('http_clear_history');
  memory.history = [];
}
export const pickFile = () => desktop ? invoke<string | null>('http_pick_file') : Promise.resolve(null);
export function cancelSend(ticket: string) {
  if (desktop) { void invoke('http_cancel', { ticket }).catch(() => {}); return; }
  controllers.get(ticket)?.abort();
}

export async function send(request: Outgoing, ticket: string): Promise<HttpResponse> {
  if (desktop) return invoke<HttpResponse>('http_send', { request, ticket });
  const controller = new AbortController(); controllers.set(ticket, controller);
  const timer = setTimeout(() => controller.abort('timeout'), request.timeoutMs);
  const started = performance.now();
  try {
    let body: BodyInit | undefined;
    if (request.body.kind === 'text') body = request.body.text;
    if (request.body.kind === 'multipart') { const form = new FormData(); request.body.parts.filter(p => !p.file).forEach(p => form.append(p.name, p.value)); body = form; }
    const url = /^[a-z]+:\/\//i.test(request.url) ? request.url : `http://${request.url}`;
    const result = await fetch(url, { method: request.method, headers: request.headers, body, signal: controller.signal, redirect: request.followRedirects ? 'follow' : 'manual' });
    const bytes = new Uint8Array(await result.arrayBuffer());
    const headers = [...result.headers.entries()] as [string, string][];
    let text = '', binary = false;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { binary = true; text = btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')); }
    const response: HttpResponse = { status: result.status, statusText: result.statusText, version: 'HTTP/1.1', url: result.url, headers, body: text, base64: binary, size: bytes.length, truncated: false, durationMs: Math.round(performance.now() - started), historyId: crypto.randomUUID() };
    record(request, response, null);
    return response;
  } catch (reason) {
    if (controller.signal.aborted && controller.signal.reason !== 'timeout') throw 'HTTP_CANCELLED';
    const error = controller.signal.aborted ? '요청 시간이 초과되었습니다.' : `${reason instanceof Error ? reason.message : reason} (브라우저 미리보기는 CORS를 따릅니다)`;
    record(request, null, error);
    throw error;
  } finally { clearTimeout(timer); controllers.delete(ticket); }
}
function record(request: Outgoing, response: HttpResponse | null, error: string | null) {
  memory.history.unshift({
    id: response?.historyId ?? crypto.randomUUID(), requestId: request.requestId, name: request.name, method: request.method, url: request.url,
    status: response?.status ?? null, durationMs: response?.durationMs ?? 0, size: response?.size ?? 0, error, sentAt: Date.now(),
    request: structuredClone(request), response: response && structuredClone(response),
  });
  memory.history.length = Math.min(memory.history.length, 500);
}
export const contentType = (response: HttpResponse) => headerValue(response.headers, 'content-type');
