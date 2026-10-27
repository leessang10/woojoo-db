import { Channel, invoke } from "@tauri-apps/api/core";
import type { ProjectDraft } from "./types";
export interface NativeFile {
  path: string;
  original: string | null;
  source: string;
}
export interface BuildInput {
  id: string;
  context: string;
  name: string;
  files: NativeFile[];
  profiles: string[];
  env: Record<string, string>;
  rebuild: boolean;
}
export interface Review {
  token: string;
  effective: Record<string, unknown>;
  baseline?: Record<string, unknown> | null;
  changedFields?: Record<string, string[]>;
  fingerprint: string;
  files: { path: string; changed: boolean }[];
  extraFiles: { path: string; purpose: string }[];
  checked: number;
}
export interface Operation {
  id: string;
  context: string;
  project: string;
  fingerprint: string;
  state: string;
  started: number;
  finished?: number;
  code?: number;
  lines: string[];
}
export const importFiles = (paths?: string[]) =>
  invoke<NativeFile[] | null>("docker_builder_import", {
    paths: paths ?? null,
  });
export const chooseDestination = () =>
  invoke<string | null>("docker_builder_destination");
export const pickApp = () =>
  invoke<{ context: string; dockerfiles: string[] } | null>(
    "docker_builder_pick_app",
  );
export const pickPath = () => invoke<string | null>("docker_builder_pick_path");
export const exampleKeys = () =>
  invoke<string[] | null>("docker_builder_example_keys");
export const searchImages = (query: string) =>
  invoke<{
    results: {
      Name: string;
      Description: string;
      IsOfficial: string;
      StarCount: string;
    }[];
    checked: number;
  }>("docker_builder_search", { query });
export interface ImageTag {
  name: string;
  digest?: string;
  images: { architecture: string; os: string }[];
}
export const imageTags = (repository: string, page: number) =>
  invoke<{
    results: ImageTag[];
    next: boolean;
    checked: number;
    cached: boolean;
    warning?: string;
  }>("docker_builder_tags", { repository, page });
export const reviewProject = (input: BuildInput) =>
  invoke<Review>("docker_builder_review", { input });
export const saveReview = (token: string) =>
  invoke<NativeFile[]>("docker_builder_save", { token });
export const saveDraftFile = (input: BuildInput) =>
  invoke<NativeFile[]>("docker_builder_save_draft", { input });
export const operations = () =>
  invoke<Operation[]>("docker_builder_operations");
export const cancelOperation = (id: string) =>
  invoke<void>("docker_builder_cancel", { id });
export function startOperation(
  token: string,
  seconds: number,
  onEvent: (event: {
    id: string;
    line?: string;
    state?: string;
    code?: number;
  }) => void,
) {
  const channel = new Channel<Parameters<typeof onEvent>[0]>();
  channel.onmessage = onEvent;
  return invoke<Operation>("docker_builder_start", {
    token,
    seconds,
    onEvent: channel,
  });
}
export const inputFor = (
  d: ProjectDraft,
  env: Record<string, string>,
): BuildInput => ({
  id: d.id,
  context: d.context,
  name: d.name,
  profiles: d.profiles,
  files: d.files.map((f) => ({
    ...f,
    source: d.files.length === 1 ? d.source : f.source,
  })),
  env,
  rebuild: !!d.rebuild,
});
