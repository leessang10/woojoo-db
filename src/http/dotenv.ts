import type { Pair } from './model';

/** Parse data only: references and shell commands are never evaluated. */
export function parseEnv(text: string): Pair[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const values = new Map<string, Pair>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    const startLine = index + 1;
    const invalid = () => new Error(`Invalid .env syntax at line ${startLine}`);
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw invalid();
    const key = match[1];
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let end = -1;
      for (let cursor = 1; ; cursor++) {
        if (cursor >= value.length) {
          if (++index >= lines.length) throw invalid();
          value += `\n${lines[index]}`;
        }
        if (value[cursor] === quote) { end = cursor; break; }
        // Escaped quotes belong to the value, not the closing delimiter.
        if (value[cursor] === '\\' && cursor + 1 < value.length) cursor++;
      }
      const tail = value.slice(end + 1).trim();
      if (tail && !tail.startsWith('#')) throw invalid();
      value = value.slice(1, end);
      if (quote === '"') value = value.replace(/\\([\\"nr])/g, (_match, escaped: string) => escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped);
    } else {
      value = value.split('#', 1)[0].trim();
    }
    values.set(key, { key, value, enabled: true });
  }
  return [...values.values()];
}

/** Keep existing switches and order; append new keys and update matching values. */
export function mergeEnvVariables(existing: Pair[], imported: Pair[]): Pair[] {
  const incoming = new Map(imported.map(pair => [pair.key, pair]));
  const keys = new Set(existing.map(pair => pair.key));
  return [
    ...existing.map(pair => incoming.has(pair.key) ? { ...pair, value: incoming.get(pair.key)!.value } : pair),
    ...imported.filter(pair => !keys.has(pair.key)),
  ];
}
