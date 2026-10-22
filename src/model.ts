export type Engine = 'postgres' | 'mysql' | 'mariadb' | 'sqlite';
export type Row = Record<string, string | null>;
export type Column = { name: string; dataType: string; primary: boolean; editable: boolean };
export type Table = { schema: string; name: string };
export type ColumnDetail = Column & { nullable: boolean; defaultValue: string | null; charset?: string | null; collation?: string | null; comment?: string; extra?: string; ordinal?: number };
export type TableInfo = Table & { owner?: string | null; engine?: string | null; charset?: string | null; collation?: string | null; estimatedRows?: number | null; sizeBytes?: number | null; comment?: string; createdAt?: string | null };
export type SchemaInfo = { info: { name: string; owner?: string | null; charset?: string | null; collation?: string | null; comment?: string; version?: string }; tables: TableInfo[] };
export type TableObjects = { indexes: { name: string; definition: string }[]; constraints: { name: string; definition: string }[] };
export type Result = { columns: Column[]; rows: Row[]; elapsedMs: number; affected: number; truncated: boolean };
export type Profile = { id: string; name: string; engine: Engine; host: string; port: number; database: string; username: string; password: string; tls: boolean; group?: string; environment?: 'development' | 'staging' | 'production'; readOnly?: boolean; rememberPassword?: boolean; queryTimeoutSeconds?: number };
export type Edit = { original: Row; changes: Row };
export function collectEdits(rows: Row[], draft: Record<string, string | null>): Edit[] {
  return rows.flatMap((original, index) => {
    const changes: Row = {};
    for (const [key, value] of Object.entries(draft)) {
      const colon = key.indexOf(':');
      if (Number(key.slice(0, colon)) === index) {
        const col = key.slice(colon + 1);
        if (original[col] !== value) changes[col] = value;
      }
    }
    return Object.keys(changes).length ? [{ original, changes }] : [];
  });
}
export function tableQuery(engine: Engine, schema: string, table: string) {
  const q = (s: string) => engine === 'postgres' || engine === 'sqlite' ? `"${s.replaceAll('"', '""')}"` : `\`${s.replaceAll('`', '``')}\``;
  return `SELECT *\nFROM ${q(schema)}.${q(table)}\nLIMIT 500;`;
}
export function csv(columns: string[], rows: Row[]) {
  const quote = (value: string | null) => {
    const text = value ?? '';
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [columns, ...rows.map(r => columns.map(c => r[c]))].map(r => r.map(quote).join(',')).join('\r\n');
}
