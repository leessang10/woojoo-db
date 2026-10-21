import type { Profile } from './model';

export const PROFILE_KEY = 'woojoo-profiles-v1';
export function safeProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (!['postgres','mysql','mariadb','sqlite'].includes(String(p.engine)) ||
      !['id','name','host','database','username'].every(k => typeof p[k] === 'string') ||
      !p.id || p.id === 'demo' || !Number.isInteger(p.port)) return null;
  return {
    id: String(p.id), name: String(p.name), engine: p.engine as Profile['engine'],
    host: String(p.host), database: String(p.database), username: String(p.username),
    port: Number(p.port), tls: p.tls === true, password: '',
    group: typeof p.group === 'string' ? p.group : '',
    environment: ['development','staging','production'].includes(String(p.environment))
      ? p.environment as Profile['environment'] : 'development',
    readOnly: p.readOnly === true,
    rememberPassword: p.engine !== 'sqlite' && p.rememberPassword === true,
  };
}
export function readProfiles(): Profile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.slice(0,500).flatMap(value => {
      const profile = safeProfile(value);
      if (!profile || seen.has(profile.id)) return [];
      seen.add(profile.id); return [profile];
    });
  } catch { return []; }
}
export function writeProfiles(profiles: Profile[]) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles.map(safeProfile).filter(Boolean)));
}
