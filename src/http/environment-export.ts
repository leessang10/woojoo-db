import { stringify } from 'yaml';
import type { Pair } from './model';

export type EnvironmentFormat = 'env' | 'json' | 'yml';

/** Export all named rows. File formats do not carry editor enabled switches. */
export function serializeEnvironment(pairs: Pair[], format: EnvironmentFormat): string {
  const entries = new Map<string, string>();
  for (const pair of pairs) {
    if (!pair.key && !pair.value) continue;
    if (!pair.key.trim() || entries.has(pair.key)) throw new Error('Invalid or duplicate key');
    if (format === 'env' && !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(pair.key)) throw new Error('Invalid dotenv key');
    entries.set(pair.key, pair.value);
  }
  if (format === 'env') return [...entries].map(([key, value]) => {
    const quoted = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    return `${key}="${quoted}"\n`;
  }).join('');
  const values = Object.fromEntries(entries);
  return format === 'json' ? `${JSON.stringify(values, null, 2)}\n` : stringify(values);
}
