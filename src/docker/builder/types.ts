export type SourcePath = (string | number)[];
export interface Patch { path: SourcePath; value?: unknown; remove?: boolean }
export type Condition = '' | 'service_started' | 'service_healthy' | 'service_completed_successfully';
export interface ValidationIssue { code: string; severity: 'error' | 'warning' | 'info'; service?: string; field?: string; message: string; detail?: string }
export interface Port { target: number; published?: string; hostIp?: string; protocol: string; raw: unknown }
export interface Mount { type: string; source: string; target: string; readOnly: boolean; raw: unknown }
export interface Resource { key: string; external: boolean; name?: string; driver?: string; internal?: boolean }
export interface ServiceView {
  key: string; image: string; build?: Record<string, unknown>; environment: Record<string, string | null>;
  envFiles: string[]; ports: Port[]; networks: string[]; mounts: Mount[];
  depends: Record<string, { condition: Condition; [key: string]: unknown }>; healthcheck?: Record<string, unknown>;
  restart: string; command?: unknown; profiles: string[]; editable: boolean; lockReason?: string;
  raw: Record<string, unknown>;
}
export interface ProjectView { services: ServiceView[]; networks: Resource[]; volumes: Resource[]; issues: ValidationIssue[]; editable: boolean }
export interface SourceFile { path: string; original: string; source: string }
export interface Mapping {
  key: string; value: string; enabled: boolean; existing?: string | null; replace: boolean;
  reference?: { service: string; field: 'host' | 'port' | 'environment'; key?: string };
  secret?: boolean;
}
export interface ConnectionProposal {
  id: string; consumer: string; provider: string; origin: 'container' | 'browser'; injection: 'runtime' | 'build';
  network: string; condition: Condition; mappings: Mapping[]; endpoint: number;
  healthcheck?: Record<string, unknown>; publicUrl: string;
}
export interface ConnectionIntent extends ConnectionProposal { owned: { path: SourcePath; value: unknown; previous?: unknown }[] }
export interface DraftFrame { source: string; connections: ConnectionIntent[] }
export interface ProjectDraft extends DraftFrame {
  id: string; name: string; context: string; revision: number; files: SourceFile[]; profiles: string[];
  positions: Record<string, {x: number; y: number}>; past: DraftFrame[]; future: DraftFrame[];
  needsInput: boolean; savedSource?: string; nativeId?: string;
}
export interface ComponentInput { template?: string; image?: string; name?: string; build?: { context: string; dockerfile: string }; publish?: boolean }
