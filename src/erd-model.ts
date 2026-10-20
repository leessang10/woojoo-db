import dagre from '@dagrejs/dagre';
import type { Column, Table } from './model';

export type ErdTable = { table: Table; columns: Column[] };
export type ForeignKey = { id: string; name: string; source: Table; target: Table; sourceColumns: string[]; targetColumns: string[] };
export type ErdSchema = { tables: ErdTable[]; foreignKeys: ForeignKey[] };
export type ColumnMode = 'pk' | 'keys' | 'all';
export type TableStyle = { x: number; y: number; color: string; shape: 'square' | 'rounded' | 'card'; width: number };
export type Relation = {
  id: string; source: string; target: string; sourceColumns: string[]; targetColumns: string[];
  label: string; color: string; path: 'smoothstep' | 'default' | 'straight';
  arrow: 'end' | 'start' | 'both' | 'none'; dashed: boolean; custom: boolean; labelOffset?: number;
};
export type ErdDocument = {
  version: 1; schema: ErdSchema; mode: ColumnMode; styles: Record<string, TableStyle>;
  relations: Relation[]; hiddenRelations: string[];
};
export const tableId = (table: Table) => JSON.stringify([table.schema, table.name]);
export function visibleColumns(table: ErdTable, mode: ColumnMode, schema: ErdSchema) {
  const fk = new Set(schema.foreignKeys.filter(key => tableId(key.source) === tableId(table.table)).flatMap(key => key.sourceColumns));
  return table.columns.filter(column => mode === 'all' || column.primary || mode === 'keys' && fk.has(column.name));
}
export function arrange(document: ErdDocument): ErdDocument {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 130, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const table of document.schema.tables) {
    const id = tableId(table.table);
    graph.setNode(id, { width: document.styles[id].width, height: 60 + Math.max(1, visibleColumns(table, document.mode, document.schema).length) * 28 });
  }
  for (const edge of document.relations) graph.setEdge(edge.source, edge.target, {}, edge.id);
  dagre.layout(graph);
  return { ...document, styles: Object.fromEntries(Object.entries(document.styles).map(([id, style]) => {
    const node = graph.node(id);
    return [id, { ...style, x: node.x - node.width / 2, y: node.y - node.height / 2 }];
  })) };
}
export function mergeSchema(schema: ErdSchema, old?: ErdDocument | null): ErdDocument {
  const styles = Object.fromEntries(schema.tables.map(table => {
    const id = tableId(table.table);
    return [id, old?.styles[id] ?? { x: 0, y: 0, color: '#396da8', shape: 'rounded' as const, width: 270 }];
  }));
  const ids = new Set(Object.keys(styles));
  const hiddenRelations = old?.hiddenRelations ?? [];
  const relations: Relation[] = schema.foreignKeys.filter(key => !hiddenRelations.includes(key.id)).map(key => {
    const previous = old?.relations.find(edge => edge.id === key.id);
    return {
      id: key.id, source: tableId(key.source), target: tableId(key.target),
      sourceColumns: key.sourceColumns, targetColumns: key.targetColumns,
      label: key.name, color: '#7d8fa8', path: 'smoothstep', arrow: 'end', dashed: false, custom: false,
      ...previous,
      // Metadata refresh retains visual styles but restores the actual FK endpoints.
      ...(previous?.custom ? {} : { source: tableId(key.source), target: tableId(key.target), sourceColumns: key.sourceColumns, targetColumns: key.targetColumns }),
    };
  });
  relations.push(...(old?.relations.filter(edge => edge.custom && !schema.foreignKeys.some(key => key.id === edge.id)) ?? []));
  const next: ErdDocument = { version: 1, schema, mode: old?.mode ?? 'all', styles, relations: relations.filter(edge => ids.has(edge.source) && ids.has(edge.target)), hiddenRelations };
  const laidOut = arrange(next);
  return old ? { ...next, styles: Object.fromEntries(Object.entries(laidOut.styles).map(([id, style]) => [id, old.styles[id] ?? style])) } : laidOut;
}
export function readSavedErd(key: string): ErdDocument | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as ErdDocument | null;
    if (value?.version !== 1 || !['all', 'pk', 'keys'].includes(value.mode) || !Array.isArray(value.schema?.tables) || !Array.isArray(value.schema?.foreignKeys) || !Array.isArray(value.relations) || !Array.isArray(value.hiddenRelations)) return null;
    for (const style of Object.values(value.styles)) {
      if (![style.x, style.y, style.width].every(Number.isFinite) || style.width < 220 || style.width > 520 || !/^#[0-9a-f]{6}$/i.test(style.color) || !['square', 'rounded', 'card'].includes(style.shape)) return null;
    }
    return value;
  } catch { return null; }
}
