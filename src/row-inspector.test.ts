import { describe, expect, it } from 'vitest';
import { formatInspectorValue, isNumericType } from './row-inspector';

describe('row inspector values', () => {
  it('pretty-prints JSON objects and arrays only', () => {
    expect(formatInspectorValue('{"a":1,"b":[2]}')).toEqual({ text: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}', json: true });
    expect(formatInspectorValue('[1,2]').json).toBe(true);
    expect(formatInspectorValue('{not json')).toEqual({ text: '{not json', json: false });
    expect(formatInspectorValue('42')).toEqual({ text: '42', json: false });
  });
  it('recognises numeric column types for right alignment', () => {
    for (const type of ['int8', 'BIGINT UNSIGNED', 'numeric(10,2)', 'double precision', 'decimal']) expect(isNumericType(type)).toBe(true);
    for (const type of ['varchar', 'text', 'timestamp', 'json']) expect(isNumericType(type)).toBe(false);
  });
});
