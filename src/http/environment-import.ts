import { parseDocument } from 'yaml';
import { parseEnv } from './dotenv';
import type { Pair } from './model';

/** Import file data without evaluating variable references or YAML custom tags. */
export function parseEnvironmentFile(text: string, filename: string): Pair[] {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension !== 'json' && extension !== 'yml' && extension !== 'yaml') return parseEnv(text);
  try {
    const source = text.replace(/^\uFEFF/, '');
    let value: unknown;
    if (extension === 'json') value = JSON.parse(source);
    else {
      const document = parseDocument(source, { schema: 'core', stringKeys: true });
      if (document.errors.length || document.warnings.length) throw new Error();
      value = document.toJS({ maxAliasCount: 100 });
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const pairs: Pair[] = [];
    const keys = new Set<string>();
    const ancestors = new Set<object>();
    function visit(item: unknown, path: string) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (ancestors.has(item)) throw new Error();
        ancestors.add(item);
        const entries = Object.entries(item);
        if (entries.length) {
          for (const [key, child] of entries) {
            if (!key.trim()) throw new Error();
            visit(child, path ? `${path}.${key}` : key);
          }
          ancestors.delete(item);
          return;
        }
        ancestors.delete(item);
        if (!path) return;
      }
      if (keys.has(path)) throw new Error();
      keys.add(path);
      // JSON.stringify also rejects circular arrays. Reject non-finite YAML numbers.
      const serialized = typeof item === 'object' && item !== null
        ? JSON.stringify(item, (_key, child) => {
          if (typeof child === 'number' && !Number.isFinite(child)) throw new Error();
          return child;
        }) : item === null ? '' : String(item);
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error();
      pairs.push({ key: path, value: serialized, enabled: true });
    }
    visit(value, '');
    return pairs;
  } catch {
    // Parser errors may include source snippets containing secrets.
    throw new Error('Invalid environment file');
  }
}
