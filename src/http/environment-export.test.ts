import { describe, expect, it } from 'vitest';
import { serializeEnvironment } from './environment-export';
import { parseEnvironmentFile } from './environment-import';

describe('environment export', () => {
  const pairs = [
    { key: 'server.host', value: 'localhost', enabled: true },
    { key: 'TOKEN', value: ' spaces # = "quoted" \'single\' `tick` \\n\n\r\t\\', enabled: true },
    { key: 'EMPTY', value: '', enabled: true },
    { key: 'DISABLED', value: 'false', enabled: false },
    { key: '__proto__', value: 'safe', enabled: true },
  ];
  it.each(['env', 'json', 'yml'] as const)('round trips keys and exact string values through %s', format => {
    expect(parseEnvironmentFile(serializeEnvironment(pairs, format), `settings.${format}`))
      .toEqual(pairs.map(pair => ({ ...pair, enabled: true })));
  });
  it('does not silently lose duplicate keys', () => {
    expect(() => serializeEnvironment([pairs[0], pairs[0]], 'json')).toThrow();
  });
  it('rejects dotenv keys that cannot be represented', () => {
    expect(() => serializeEnvironment([{ key: 'bad=key', value: 'x', enabled: true }], 'env')).toThrow();
  });
  it('ignores fully empty editor rows but rejects values without keys', () => {
    expect(serializeEnvironment([{ key: '', value: '', enabled: true }], 'json')).toBe('{}\n');
    expect(() => serializeEnvironment([{ key: '', value: 'lost', enabled: true }], 'json')).toThrow();
  });
});
