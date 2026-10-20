import { describe, expect, it } from 'vitest';
import { collectEdits, csv, tableQuery } from './model';
describe('editable results', () => {
  it('collects only actual changes and preserves NULL separately from empty text', () => {
    const rows = [{ id: '9007199254740993', name: null, email: 'before' }];
    expect(collectEdits(rows, { '0:name': '', '0:email': 'before' })).toEqual([
      { original: rows[0], changes: { name: '' } },
    ]);
  });
  it('removes changes that have been reverted', () => {
    expect(collectEdits([{ id: '1', name: 'a' }], { '0:name': 'a' })).toEqual([]);
  });
  it('quotes identifiers for both database families', () => {
    expect(tableQuery('postgres', 'a"b', 'orders')).toContain('"a""b"."orders"');
    expect(tableQuery('mysql', 'shop', 'a`b')).toContain('`shop`.`a``b`');
  });
  it('exports quotes, line breaks and spreadsheet formulas safely', () => {
    expect(csv(['name'], [{name: '=1+1'}, {name:'a"b\nc'}])).toBe('"name"\r\n"\'=1+1"\r\n"a""b\nc"');
  });
});
