import { describe, expect, it } from 'vitest';
import { mergeEnvVariables, parseEnv } from './dotenv';

const pair = (key: string, value: string, enabled = true) => ({ key, value, enabled });

describe('dotenv import', () => {
  it('reads BOM, CRLF, exports, empty values, comments and equals signs', () => {
    expect(parseEnv('\uFEFF# comment\r\nexport URL = https://host?a=b=c # note\r\nEMPTY=\r\n')).toEqual([
      pair('URL', 'https://host?a=b=c'), pair('EMPTY', ''),
    ]);
  });

  it('preserves quoted spaces and hashes, multiline values and literal references', () => {
    expect(parseEnv('A="  # hello  " # comment\nB=\'${A}\\n\'\nC="one\\ntwo\\rthree"\nD="line1\nline2"\nE=$(whoami)')).toEqual([
      pair('A', '  # hello  '), pair('B', '${A}\\n'), pair('C', 'one\ntwo\rthree'),
      pair('D', 'line1\nline2'), pair('E', '$(whoami)'),
    ]);
  });

  it('uses the last value for duplicate keys, including object property names', () => {
    expect(parseEnv('A=first\n__proto__=safe\nA=last')).toEqual([pair('A', 'last'), pair('__proto__', 'safe')]);
  });

  it.each(['GOOD=yes\ninvalid', '1BAD=value', 'A="unfinished', 'A="ok" trailing'])('rejects malformed input without exposing values: %s', text => {
    expect(() => parseEnv(text)).toThrow(/^Invalid .env syntax at line \d+$/);
  });

  it('accepts comment-only files as empty', () => {
    expect(parseEnv('# comment\n\n')).toEqual([]);
  });

  it('merges by key while retaining other rows and their enabled state', () => {
    const existing = [pair('KEEP', 'old', false), pair('TOKEN', 'old', false)];
    expect(mergeEnvVariables(existing, parseEnv('TOKEN=new\nADD=value'))).toEqual([
      pair('KEEP', 'old', false), pair('TOKEN', 'new', false), pair('ADD', 'value'),
    ]);
    expect(existing[1].value).toBe('old');
  });
});
