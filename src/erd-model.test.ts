import { describe, expect, it } from 'vitest';
import { mergeSchema, tableId, visibleColumns, type ErdSchema } from './erd-model';

const parent = { schema: 'other', name: 'users' }, child = { schema: 'public', name: 'orders' };
const column = (name: string, primary = false) => ({ name, primary, dataType: 'int', editable: !primary });
const schema: ErdSchema = {
  tables: [{ table: parent, columns: [column('tenant', true), column('id', true), column('name')] },
    { table: child, columns: [column('id', true), column('tenant'), column('user_id'), column('total')] }],
  foreignKeys: [{ id: 'composite', name: 'order_user', source: child, target: parent, sourceColumns: ['tenant', 'user_id'], targetColumns: ['tenant', 'id'] }],
};
describe('ERD metadata and document merging', () => {
  it('filters composite PK/FK columns without losing relation endpoints', () => {
    expect(visibleColumns(schema.tables[1], 'pk', schema).map(c => c.name)).toEqual(['id']);
    expect(visibleColumns(schema.tables[1], 'keys', schema).map(c => c.name)).toEqual(['id', 'tenant', 'user_id']);
    expect(visibleColumns(schema.tables[1], 'all', schema)).toHaveLength(4);
    const document = mergeSchema(schema);
    expect(document.relations).toHaveLength(1);
    expect(document.relations[0].target).toBe(tableId(parent));
    expect(document.relations[0].sourceColumns).toEqual(['tenant', 'user_id']);
    expect(document.styles[tableId(parent)].x).not.toBe(document.styles[tableId(child)].x);
  });
  it('preserves user positions and styles across refresh and removes stale edges', () => {
    const document = mergeSchema(schema);
    document.styles[tableId(child)] = { x: -200, y: 150, width: 400, color: '#ff0000', shape: 'square' };
    document.relations[0].color = '#00ff00';
    const refreshed = mergeSchema(schema, document);
    expect(refreshed.styles[tableId(child)]).toEqual(document.styles[tableId(child)]);
    expect(refreshed.relations[0].color).toBe('#00ff00');
    expect(mergeSchema({ tables: [schema.tables[0]], foreignKeys: [] }, document).relations).toHaveLength(0);
  });
  it('keeps deleted FK lines hidden on refresh and lays out isolated tables', () => {
    const document = mergeSchema(schema);
    document.hiddenRelations = ['composite']; document.relations = [];
    expect(mergeSchema(schema, document).relations).toHaveLength(0);
    const empty = mergeSchema({ tables: [], foreignKeys: [] });
    expect(empty.styles).toEqual({});
    expect(tableId({ schema: 'a.b', name: 'c' })).not.toBe(tableId({ schema: 'a', name: 'b.c' }));
  });
});
