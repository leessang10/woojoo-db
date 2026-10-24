import { describe, expect, it } from 'vitest';
import { parseEnvironmentFile } from './environment-import';

describe('environment file import', () => {
  it('keeps dotenv parsing for .env variants', () => {
    expect(parseEnvironmentFile('TOKEN=a=b', '.env.local')).toEqual([{ key: 'TOKEN', value: 'a=b', enabled: true }]);
  });
  it.each([
    ['settings.JSON', '\uFEFF{"database":{"host":"localhost","port":5432},"enabled":false,"empty":null,"list":["a","b"]}'],
    ['settings.yml', 'database:\n  host: localhost\n  port: 5432\nenabled: false\nempty: null\nlist: [a, b]'],
    ['settings.yaml', 'database: {host: localhost, port: 5432}\nenabled: false\nempty:\nlist: [a, b]'],
  ])('converts %s into string variables with dotted nested keys', (name, text) => {
    expect(parseEnvironmentFile(text, name)).toEqual([
      { key: 'database.host', value: 'localhost', enabled: true },
      { key: 'database.port', value: '5432', enabled: true },
      { key: 'enabled', value: 'false', enabled: true },
      { key: 'empty', value: '', enabled: true },
      { key: 'list', value: '["a","b"]', enabled: true },
    ]);
  });
  it('reads YAML multiline strings, comments and literal references', () => {
    expect(parseEnvironmentFile('TOKEN: "a#b" # comment\nTEXT: |\n  first\n  second\nREF: ${TOKEN}', 'a.yml')).toEqual([
      { key: 'TOKEN', value: 'a#b', enabled: true },
      { key: 'TEXT', value: 'first\nsecond\n', enabled: true },
      { key: 'REF', value: '${TOKEN}', enabled: true },
    ]);
  });
  it.each([
    ['a.json', '{"TOKEN":secret}'], ['a.yml', 'TOKEN: [secret'],
    ['a.json', '[1,2]'], ['a.yml', '- item'], ['a.json', 'null'],
    ['a.yml', 'A: 1\nA: 2'], ['a.yml', 'A: !custom secret'],
    ['a.json', '{"a.b":1,"a":{"b":2}}'], ['a.yml', 'A: &loop\n  self: *loop'],
    ['a.yml', '? [a, b]\n: value'], ['a.json', '{" ":"secret"}'],
  ])('rejects invalid or ambiguous input in %s without revealing contents', (name, text) => {
    expect(() => parseEnvironmentFile(text, name)).toThrow(/^Invalid environment file$/);
  });
  it('allows empty mappings and safely handles object property names', () => {
    expect(parseEnvironmentFile('{}', 'a.json')).toEqual([]);
    expect(parseEnvironmentFile('__proto__: safe', 'a.yml')).toEqual([{ key: '__proto__', value: 'safe', enabled: true }]);
  });
});
