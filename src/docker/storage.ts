import { invoke } from '@tauri-apps/api/core';
export type DockerDisk = { id: string; path: string; fileBytes: number; allocatedBytes: number; token: string };
export type StorageReport = { supported: boolean; disks: DockerDisk[] };
export type CompactResult = { before: DockerDisk; after: DockerDisk };
export const inspectStorage = (context: string) => invoke<StorageReport>('docker_storage_inspect', { context });
export const pickStorage = (context: string) => invoke<DockerDisk | null>('docker_storage_pick', { context });
export const stopDesktopForStorage = (context: string) => invoke<void>('docker_storage_stop', { context });
export const trimStorage = (context: string) => invoke<string>('docker_storage_trim', { context });
export const compactStorage = (context: string, id: string, token: string) => invoke<CompactResult>('docker_storage_compact', { context, id, token });
export const reclaimedBytes = (before: Pick<DockerDisk, 'allocatedBytes'>, after: Pick<DockerDisk, 'allocatedBytes'>) => Math.max(0, before.allocatedBytes - after.allocatedBytes);
export function storageSize(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 2 : 0)} ${units[i]}`;
}
