import type { ColumnDetail, Engine, Table } from './model';

export type ColumnDraft = { name: string; dataType: string; nullable: boolean; primary: boolean; defaultMode: 'keep' | 'none' | 'literal' | 'expression'; defaultValue: string; charset: string; collation: string; comment: string };
export type StructureChange = {
  kind: 'createTable' | 'alterTable' | 'dropTable' | 'addColumn' | 'alterColumn' | 'dropColumn';
  table: Table; name: string; charset: string; collation: string; comment: string;
  columns: ColumnDraft[]; original?: ColumnDetail;
};
export type StructurePlan = { change: StructureChange; sqls: string[]; expectedColumns?: ColumnDetail[] };
export const commonTypes = ['bigint', 'integer', 'smallint', 'varchar(255)', 'text', 'boolean', 'numeric(12,2)', 'date', 'timestamp', 'json'];
export function columnDraft(column?: ColumnDetail): ColumnDraft {
  return { name: column?.name ?? '', dataType: column?.dataType ?? 'varchar(255)', nullable: column?.nullable ?? true,
    primary: column?.primary ?? false, defaultMode: column ? 'keep' : 'none', defaultValue: column?.defaultValue ?? '',
    charset: column?.charset ?? '', collation: column?.collation ?? '', comment: column?.comment ?? '' };
}
const literal = (value: string) => {
  if (value.includes('\0')) throw new Error('NUL 문자는 사용할 수 없습니다.');
  return `'${value.replaceAll("'", "''")}'`;
};
function ident(name: string, pg: boolean) {
  if (!name.trim() || name.includes('\0') || (pg ? new TextEncoder().encode(name).length > 63 : [...name].length > 64)) throw new Error('이름이 비어 있거나 DB 식별자 길이 제한을 초과했습니다.');
  const quote = pg ? '"' : '`';
  return quote + name.replaceAll(quote, quote + quote) + quote;
}
export function supportedType(type: string) {
  return /^(?:(?:bigint|smallint|integer|int|tinyint|mediumint)(?:\(\d+\))?(?: unsigned)?|(?:varchar|char|character varying|character|varbinary|binary)\(\d+\)|(?:numeric|decimal)(?:\(\d+(?:,\s*\d+)?\))?|(?:timestamp|time)(?:\([0-6]\))?(?: (?:with|without) time zone)?|datetime(?:\([0-6]\))?|text|tinytext|mediumtext|longtext|boolean|bool|date|jsonb?|uuid|real|double precision|double|float|bytea|blob)(?:\[\])?$/i.test(type.trim());
}
function typeSql(type: string, pg: boolean) {
  if (!supportedType(type)) throw new Error('지원하지 않는 자료형입니다. SQL 편집기에서 변경하세요.');
  if (!pg && /uuid|jsonb|bytea|\[\]|with(?:out)? time zone/i.test(type)) throw new Error('이 DB에서 지원하지 않는 자료형입니다.');
  if (pg && /unsigned|tinyint|mediumint|datetime|blob|binary|tinytext|mediumtext|longtext/i.test(type)) throw new Error('이 DB에서 지원하지 않는 자료형입니다.');
  return type.trim();
}
function charsetSql(charset: string, collation: string) {
  for (const value of [charset, collation]) if (value && !/^[A-Za-z0-9_]+$/.test(value)) throw new Error('charset/collation 이름을 확인하세요.');
  return (charset ? ` CHARACTER SET ${charset}` : '') + (collation ? ` COLLATE ${collation}` : '');
}
function expression(value: string, pg: boolean) {
  if (!/^(CURRENT_TIMESTAMP(?:\([0-6]?\))?|CURRENT_DATE(?:\(\))?|CURRENT_TIME(?:\([0-6]?\))?|now\(\)|gen_random_uuid\(\))$/i.test(value.trim()) || !pg && /gen_random_uuid/i.test(value)) throw new Error('지원하는 기본값 표현식만 사용할 수 있습니다.');
  return value.trim();
}
function defaultSql(column: ColumnDraft, pg: boolean, old?: ColumnDetail, engine?: Engine) {
  if (column.defaultMode === 'none') return '';
  if (column.defaultMode === 'literal') return ` DEFAULT ${literal(column.defaultValue)}`;
  if (column.defaultMode === 'expression') return ` DEFAULT ${expression(column.defaultValue, pg)}`;
  if (!old || old.defaultValue === null) return '';
  const value = old.defaultValue;
  if (pg) return ''; // ALTER COLUMN leaves the server's existing default untouched.
  if (/^(CURRENT_TIMESTAMP(?:\([0-6]?\))?|CURRENT_DATE(?:\(\))?|CURRENT_TIME(?:\([0-6]?\))?|now\(\))$/i.test(value)) return ` DEFAULT ${value}`;
  if (/DEFAULT_GENERATED/i.test(old.extra ?? '')) throw new Error('이 기본값 표현식은 SQL 편집기에서 변경하세요.');
  if (engine === 'mariadb') {
    if (value === 'NULL') return ' DEFAULT NULL';
    if (value.startsWith("'") && value.endsWith("'") && !value.includes('\\')) return ` DEFAULT ${literal(value.slice(1,-1).replaceAll("''", "'"))}`;
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('이 기본값은 SQL 편집기에서 변경하거나 새 기본값을 지정하세요.');
  }
  return ` DEFAULT ${literal(value)}`;
}
function extraSql(old?: ColumnDetail) {
  const extra = (old?.extra ?? '').replace(/\bDEFAULT_GENERATED\b/ig, '').trim();
  if (!extra) return '';
  if (/^(auto_increment|on update CURRENT_TIMESTAMP(?:\([0-6]?\))?)$/i.test(extra)) return ' ' + extra;
  throw new Error('생성 열·특수 속성은 SQL 편집기에서 변경하세요.');
}
export function planStructure(engine: Engine, change: StructureChange, columns: ColumnDetail[] = []): StructurePlan {
  const pg = engine === 'postgres', quote = (name: string) => ident(name, pg);
  const table = `${quote(change.table.schema)}.${quote(change.table.name)}`;
  const sqls: string[] = [];
  const columnDefinition = (column: ColumnDraft, old?: ColumnDetail) => {
    const nullable = column.primary ? false : column.nullable;
    return `${quote(column.name)} ${typeSql(column.dataType, pg)}${pg ? '' : charsetSql(column.charset, column.collation)}${nullable ? ' NULL' : ' NOT NULL'}${defaultSql(column,pg,old,engine)}${pg ? '' : extraSql(old) + ` COMMENT ${literal(column.comment)}`}`;
  };
  if (change.kind === 'dropTable') sqls.push(`DROP TABLE ${table}${pg ? ' RESTRICT' : ''}`);
  else if (change.kind === 'dropColumn') {
    if (!change.original) throw new Error('컬럼을 선택하세요.');
    sqls.push(`ALTER TABLE ${table} DROP COLUMN ${quote(change.original.name)}${pg ? ' RESTRICT' : ''}`);
  } else if (change.kind === 'createTable') {
    if (!change.columns.length) throw new Error('컬럼을 하나 이상 추가하세요.');
    const names=change.columns.map(c=>c.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new Error('컬럼 이름이 중복됩니다.');
    const definitions=change.columns.map(c=>columnDefinition(c));
    const keys=change.columns.filter(c=>c.primary).map(c=>quote(c.name));
    if (keys.length) definitions.push(`PRIMARY KEY (${keys.join(', ')})`);
    sqls.push(`CREATE TABLE ${table} (\n  ${definitions.join(',\n  ')}\n)${pg ? '' : charsetSql(change.charset,change.collation) + ` COMMENT ${literal(change.comment)}`}`);
    if (pg) {
      if (change.comment) sqls.push(`COMMENT ON TABLE ${table} IS ${literal(change.comment)}`);
      for (const col of change.columns) if(col.comment) sqls.push(`COMMENT ON COLUMN ${table}.${quote(col.name)} IS ${literal(col.comment)}`);
    }
  } else if (change.kind === 'alterTable') {
    if (pg) {
      if (change.name !== change.table.name) sqls.push(`ALTER TABLE ${table} RENAME TO ${quote(change.name)}`);
      sqls.push(`COMMENT ON TABLE ${quote(change.table.schema)}.${quote(change.name)} IS ${literal(change.comment)}`);
    } else {
      const clauses = [`COMMENT = ${literal(change.comment)}`];
      if (change.name !== change.table.name) clauses.push(`RENAME TO ${quote(change.table.schema)}.${quote(change.name)}`);
      if(change.charset || change.collation) clauses.push(`DEFAULT${charsetSql(change.charset,change.collation)}`);
      sqls.push(`ALTER TABLE ${table} ${clauses.join(', ')}`);
    }
  } else {
    const column=change.columns[0]; if(!column) throw new Error('컬럼을 입력하세요.');
    const old=change.original;
    if(change.kind==='addColumn') {
      sqls.push(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition(column)}${column.primary ? ' PRIMARY KEY' : ''}`);
      if(pg && column.comment) sqls.push(`COMMENT ON COLUMN ${table}.${quote(column.name)} IS ${literal(column.comment)}`);
    } else {
      if(!old || !columns.some(c=>c.name===old.name)) throw new Error('변경할 컬럼이 없습니다.');
      if(pg) {
        if(old.extra) throw new Error('생성 열·특수 속성은 SQL 편집기에서 변경하세요.');
        const col=`ALTER TABLE ${table} ALTER COLUMN ${quote(old.name)}`;
        if(column.dataType!==old.dataType) sqls.push(`${col} TYPE ${typeSql(column.dataType,pg)}`);
        if(column.nullable!==old.nullable) sqls.push(`${col} ${column.nullable?'DROP':'SET'} NOT NULL`);
        if(column.defaultMode!=='keep') sqls.push(`${col} ${column.defaultMode==='none'?'DROP DEFAULT':'SET'+defaultSql(column,pg)}`);
        if(column.name!==old.name) sqls.push(`ALTER TABLE ${table} RENAME COLUMN ${quote(old.name)} TO ${quote(column.name)}`);
        if(column.comment!==(old.comment??'')) sqls.push(`COMMENT ON COLUMN ${table}.${quote(column.name)} IS ${literal(column.comment)}`);
      } else sqls.push(`ALTER TABLE ${table} CHANGE COLUMN ${quote(old.name)} ${columnDefinition({...column,primary:old.primary},old)}`);
    }
  }
  if(!sqls.length) throw new Error('변경 사항이 없습니다.');
  return { change, sqls, expectedColumns: change.kind==='createTable' ? undefined : columns };
}
