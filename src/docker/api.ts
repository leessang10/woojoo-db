import { Channel, invoke } from '@tauri-apps/api/core';
import type { DockerContext, Snapshot } from './model';
export type LogEvent = { subscription: string; lines: string[]; truncated: boolean; done: boolean; error: string | null };
export const dockerContexts = () => invoke<DockerContext[]>('docker_contexts');
export const startDockerDesktop = (context: string) => invoke<void>('docker_start_desktop', { context });
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
    DOCKER_DESKTOP_START_FAILED: ['Docker Desktop을 시작하지 못했습니다. Docker Desktop에서 오류를 확인한 뒤 다시 시도하세요.', 'Could not start Docker Desktop. Check Docker Desktop for startup errors and try again.'],
    DOCKER_DESKTOP_CONTEXT_NOT_READY: ['Docker Desktop은 시작했지만 선택한 엔진에 아직 연결할 수 없습니다. Docker Desktop의 Linux/Windows 컨테이너 모드와 연결 대상을 확인하세요.', 'Docker Desktop started, but the selected engine is not ready. Check its Linux/Windows container mode and context.'],
    DOCKER_DESKTOP_START_UNSUPPORTED: ['설치된 Docker CLI는 Desktop 시작을 지원하지 않습니다. Docker Desktop을 직접 실행하거나 업데이트하세요.', 'This Docker CLI does not support starting Desktop. Open Docker Desktop manually or update it.'],
    DOCKER_DESKTOP_LOCAL_ONLY: ['로컬 Docker Desktop 연결에서만 시작할 수 있습니다.', 'Starting Docker Desktop is only available for a local Desktop context.'],
    DOCKER_DESKTOP_START_BUSY: ['이미 Docker Desktop을 시작하고 있습니다.', 'Docker Desktop is already starting.'],
    DOCKER_CLI_NOT_FOUND: ['Docker CLI가 없습니다. Docker를 설치한 뒤 다시 연결하세요.', 'Docker CLI not found. Install Docker and reconnect.'],
    DOCKER_ENGINE_UNAVAILABLE: ['Docker 엔진에 연결할 수 없습니다. Docker 실행 상태와 연결 대상을 확인하세요.', 'Cannot reach the Docker engine. Check Docker and the selected context.'],
    DOCKER_ACCESS_DENIED: ['Docker 접근 권한이 없습니다.', 'Docker access denied.'],
    DOCKER_TIMEOUT: ['응답 시간이 초과되었습니다. 실행 동작의 결과는 미확정이며 상태를 다시 확인해야 합니다.', 'Timed out. An action may have completed; refresh to verify its outcome.'],
    DOCKER_BUSY: ['다른 Docker 작업이 진행 중입니다.', 'Another Docker operation is in progress.'],
  };
  const key = Object.keys(messages).find(k => message.includes(k));
  return key ? `${messages[key][language === 'ko' ? 0 : 1]}\n${message}` : message;
}
