import { describe, expect, it } from 'vitest';
import { cellType, cellDestinations } from './cell-data';
import type { Column } from './model';
import type { ForeignKey } from './erd-model';

const parent = { schema: 'app', name: 'parents' };
const child = { schema: 'other', name: 'children' };
const keys: ForeignKey[] = [{ id: 'fk', name: 'child_parent', source: child, target: parent, sourceColumns: ['tenant_id', 'parent_id'], targetColumns: ['tenant', 'id'] }];
const columns: Column[] = [{ name: 'tenant', dataType: 'varchar', primary: true, editable: false }, { name: 'id', dataType: 'bigint', primary: true, editable: false }];

describe('cell display types', () => {
  it('uses column metadata and distinguishes null from text', () => {
    expect(cellType('varchar', '00123')).toBe('text');
    expect(cellType('varchar', 'NULL')).toBe('text');
    expect(cellType('bigint', null)).toBe('null');
    expect(cellType('decimal(20,4)', '12.4')).toBe('number');
    expect(cellType('timestamp with time zone', '2026-11-18')).toBe('temporal');
    expect(cellType('boolean', 'false')).toBe('boolean');
    expect(cellType('jsonb', '{}')).toBe('json');
    expect(cellType('bytea', '0x12')).toBe('binary');
    expect(cellType('point', '(1,2)')).toBe('text');
  });
});

describe('cell destinations', () => {
  it('follows every column of a composite foreign key across schemas', () => {
    const links = cellDestinations(child, [], keys, 'parent_id', { tenant_id: '', parent_id: '0' });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ direction: 'reference', table: parent, filters: [{ column: 'tenant', operator: 'eq', value: '' }, { column: 'id', operator: 'eq', value: '0' }] });
  });
  it('offers the original primary-key row and its referencing rows', () => {
    const links = cellDestinations(parent, columns, keys, 'id', { tenant: 'a', id: '7' });
    expect(links.map(link => link.direction)).toEqual(['original', 'referencing']);
    expect(links[1]).toMatchObject({ table: child, filters: [{ column: 'tenant_id', operator: 'eq', value: 'a' }, { column: 'parent_id', operator: 'eq', value: '7' }] });
  });
  it('suppresses incomplete and null keys and unrelated columns', () => {
    expect(cellDestinations(child, [], keys, 'parent_id', { tenant_id: null, parent_id: '7' })).toEqual([]);
    expect(cellDestinations(parent, columns, keys, 'id', { id: '7' })).toEqual([]);
    expect(cellDestinations(parent, columns, keys, 'name', { tenant: 'a', id: '7', name: 'test' })).toEqual([]);
  });
  it('does not offer malformed relation metadata', () => {
    expect(cellDestinations(child, [], [{ ...keys[0], targetColumns: ['id'] }], 'parent_id', { tenant_id: 'a', parent_id: '7' })).toEqual([]);
    expect(cellDestinations(child, [], [{ ...keys[0], targetColumns: ['', 'id'] }], 'parent_id', { tenant_id: 'a', parent_id: '7' })).toEqual([]);
  });
});
