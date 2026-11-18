import type { Column, Row, Table } from './model';
import type { ForeignKey } from './erd-model';
import type { DataFilter } from './data-workbench';
import { isNumericType } from './row-inspector';

export function cellType(dataType: string, value: string | null) {
  if (value === null) return 'null';
  const type = dataType.trim();
  if (/^(bool|boolean)\b/i.test(type)) return 'boolean';
  if (/^(date|time|timestamp|timestamptz|timetz|datetime|datetime2|smalldatetime|datetimeoffset|interval|year)\b/i.test(type)) return 'temporal';
  if (/^jsonb?\b/i.test(type)) return 'json';
  if (/^(bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary)\b/i.test(type)) return 'binary';
  return isNumericType(type) ? 'number' : 'text';
}

export type CellDestination = {
  id: string;
  direction: 'original' | 'reference' | 'referencing';
  table: Table;
  filters: DataFilter[];
};
const sameTable = (a: Table, b: Table) => a.schema === b.schema && a.name === b.name;

/** A link is usable only when every participating key has a non-null value. */
function keyFilters(row: Row, source: string[], target: string[]): DataFilter[] | null {
  if (!source.length || source.length !== target.length || target.some(name => !name) || source.some(name => !name || typeof row[name] !== 'string')) return null;
  return source.map((name, index) => ({ column: target[index], operator: 'eq', value: row[name]! }));
}

export function cellDestinations(table: Table, columns: Column[], keys: ForeignKey[], column: string, row: Row): CellDestination[] {
  const destinations: CellDestination[] = [];
  if (columns.some(item => item.name === column && item.primary)) {
    const primary = columns.filter(item => item.primary).map(item => item.name);
    const filters = keyFilters(row, primary, primary);
    if (filters) destinations.push({ id: 'original', direction: 'original', table, filters });
  }
  for (const key of keys) {
    if (sameTable(key.source, table) && key.sourceColumns.includes(column)) {
      const filters = keyFilters(row, key.sourceColumns, key.targetColumns);
      if (filters) destinations.push({ id: `reference:${key.id}`, direction: 'reference', table: key.target, filters });
    }
    if (columns.some(item => item.name === column && item.primary) && sameTable(key.target, table) && key.targetColumns.includes(column)) {
      const filters = keyFilters(row, key.targetColumns, key.sourceColumns);
      if (filters) destinations.push({ id: `referencing:${key.id}`, direction: 'referencing', table: key.source, filters });
    }
  }
  return destinations;
}
