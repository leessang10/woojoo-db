import { Channel, invoke } from '@tauri-apps/api/core';
import type { DockerContext, Snapshot } from './model';
export type LogEvent = { subscription: string; lines: string[]; truncated: boolean; done: boolean; error: string | null };
export const dockerContexts = () => invoke<DockerContext[]>('docker_contexts');
export const dockerSnapshot = (context: string, resources: boolean) => invoke<Snapshot>('docker_snapshot', { context, resources });
export const dockerAction = (context: string, id: string, action: string) => invoke<void>('docker_action', { context, id, action });
export const stopLogs = (subscription: string) => invoke<void>('docker_logs_stop', { subscription });
export function startLogs(context: string, id: string, subscription: string, callback: (event: LogEvent) => void) {
  const onEvent = new Channel<LogEvent>(); onEvent.onmessage = callback;
  return invoke<void>('docker_logs_start', { context, id, subscription, onEvent });
}
export function errorMessage(error: unknown, language: string) {
  const message = String(error);
  const messages: Record<string, [string, string]> = {
    DOCKER_CLI_NOT_FOUND: ['Docker CLI가 없습니다. Docker를 설치한 뒤 다시 연결하세요.', 'Docker CLI not found. Install Docker and reconnect.'],
    DOCKER_ENGINE_UNAVAILABLE: ['Docker 엔진에 연결할 수 없습니다. Docker 실행 상태와 연결 대상을 확인하세요.', 'Cannot reach the Docker engine. Check Docker and the selected context.'],
    DOCKER_ACCESS_DENIED: ['Docker 접근 권한이 없습니다.', 'Docker access denied.'],
    DOCKER_TIMEOUT: ['응답 시간이 초과되었습니다. 실행 동작의 결과는 미확정이며 상태를 다시 확인해야 합니다.', 'Timed out. An action may have completed; refresh to verify its outcome.'],
    DOCKER_BUSY: ['다른 Docker 작업이 진행 중입니다.', 'Another Docker operation is in progress.'],
  };
  const key = Object.keys(messages).find(k => message.includes(k));
  return key ? `${messages[key][language === 'ko' ? 0 : 1]}\n${message}` : message;
}
