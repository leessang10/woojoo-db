import { invoke } from '@tauri-apps/api/core';
import { desktop } from '../api';
import type { KeyMeta, QueueInfo, ReadRequest, RedisProfile, RedisValue, SavedView, ScanResult, Workspace } from './model';
export function redisApi(demo = false) {
  const call = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (demo) { const { demoCall } = await import('./demo'); return demoCall(command, args ?? {}) as T; }
    if (!desktop) throw 'DESKTOP_REQUIRED: Redis connections and profile storage require the desktop app.';
    return invoke<T>(command, args);
  };
  return {
    load: () => call<Workspace>('redis_workspace_load'),
    saveProfile: (profile: RedisProfile) => call<void>('redis_profile_save', { profile }),
    deleteProfile: (id: string) => call<void>('redis_profile_delete', { id }),
    saveView: (view: SavedView) => call<void>('redis_view_save', { view }),
    deleteView: (id: string) => call<void>('redis_view_delete', { id }),
    connect: (profile: RedisProfile, password: string | null, remember: boolean) => call<{ sessionId: string }>('redis_connect', { profile, password, remember }),
    test: (profile: RedisProfile, password: string | null) => call<void>('redis_test_connection', { profile, password }),
    disconnect: (sessionId: string) => call<void>('redis_disconnect', { sessionId }),
    forget: (id: string) => call<void>('redis_forget_password', { id }),
    scan: (request: ReadRequest) => call<ScanResult>('redis_scan', { request }),
    metadata: (request: ReadRequest) => call<KeyMeta>('redis_key_metadata', { request }),
    value: (request: ReadRequest) => call<RedisValue>('redis_read_value', { request }),
    queue: (request: ReadRequest) => call<QueueInfo>('redis_queue_inspect', { request }),
    info: (request: ReadRequest) => call<{ info: string | null; dbSize: string | null; errors: string[] }>('redis_server_info', { request }),
    flowEvents: (request: ReadRequest, afterId: string | null) => call<{ records: { id: string; fields: Record<string, string> }[]; lastId: string; gap: boolean; observedAt: number; baseline: boolean }>('redis_flow_events', { request, afterId }),
    notificationsStart: (sessionId: string) => call<{ subscriptionId: string; configuration: string | null; coverage: string }>('redis_notifications_start', { sessionId }),
    notificationsPoll: (sessionId: string, subscriptionId: string) => call<{ records: { id: string; keyBase64: string; operation: string; observedAt: number }[]; gap: boolean; connected: boolean; error: string | null; observedAt: number }>('redis_notifications_poll', { sessionId, subscriptionId }),
    notificationsStop: (sessionId: string, subscriptionId: string) => call<void>('redis_notifications_stop', { sessionId, subscriptionId }),
    cancel: (sessionId: string, requestId: string) => call<void>('redis_cancel', { sessionId, requestId }),
  };
}
export type RedisApi = ReturnType<typeof redisApi>;
