import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, GitBranch, KeyRound, Loader2, Table2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { readErd } from './api';
import { useLanguage } from './i18n';
import { tableId, type ErdSchema, type ForeignKey } from './erd-model';
import type { Table } from './model';

type Props = { session: string; table: Table; revision: number; onOpen: (table: Table) => void; onSchemaErd: (schema: string) => void };

/** A focused ERD: the table in the middle, tables it references on the right, tables referencing it on the left. */
export function RelationsView({ session, table, revision, onOpen, onSchemaErd }: Props) {
  const { language } = useLanguage();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [schema, setSchema] = useState<ErdSchema | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setSchema(null); setError('');
    readErd(session, table.schema).then(value => { if (live) setSchema(value); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [session, table.schema, table.name, revision]);
  const id = tableId(table);
  const outgoing = schema?.foreignKeys.filter(key => tableId(key.source) === id) ?? [];
  const incoming = schema?.foreignKeys.filter(key => tableId(key.target) === id && tableId(key.source) !== id) ?? [];
  const self = schema?.tables.find(item => tableId(item.table) === id);
  const keyColumns = new Set(outgoing.flatMap(key => key.sourceColumns));
  const relation = (key: ForeignKey, other: Table, direction: 'in' | 'out') => <li key={key.id}>
    <Button variant="outline" size="sm" className="relation-table" onClick={() => onOpen(other)} title={tr('이 테이블의 관계 보기', 'Show this table’s relations')}><Table2 size={13}/>{other.schema !== table.schema ? `${other.schema}.` : ''}{other.name}</Button>
    <code className="relation-columns">{direction === 'out'
      ? `${key.sourceColumns.join(', ')} → ${other.name}.${key.targetColumns.join(', ')}`
      : `${other.name}.${key.sourceColumns.join(', ')} → ${key.targetColumns.join(', ')}`}</code>
    {key.name && <small>{key.name}</small>}
  </li>;
  return <section className="relations-view" aria-label={tr('관계', 'Relations')}>
    <div className="relations-toolbar"><p>{tr('외래키로 연결된 테이블입니다. 테이블을 누르면 그 테이블의 관계로 이동합니다.', 'Tables linked by foreign keys. Choose a table to follow its relations.')}</p><Button variant="outline" size="sm" onClick={() => onSchemaErd(table.schema)}><GitBranch size={14}/>{tr('스키마 ERD에서 보기', 'Open schema ERD')}</Button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!schema && !error ? <div className="object-empty"><Loader2 size={16} className="spin"/> {tr('관계를 불러오는 중…', 'Loading relations…')}</div> : schema && <div className="relations-grid">
      <div className="relations-column"><h3><ArrowRight size={13}/>{tr('이 테이블을 참조', 'Referenced by')} <span>{incoming.length}</span></h3>{incoming.length ? <ul>{incoming.map(key => relation(key, key.source, 'in'))}</ul> : <p className="relations-none">{tr('없음', 'None')}</p>}</div>
      <div className="relations-center"><div className="relations-card"><header><Table2 size={14}/><strong>{table.name}</strong><small>{table.schema}</small></header>
        <ul>{(self?.columns ?? []).map(column => <li key={column.name}>{column.primary ? <KeyRound size={11} aria-label="PK"/> : keyColumns.has(column.name) ? <span className="relations-fk">FK</span> : <span className="relations-pad"/>}<span>{column.name}</span><code>{column.dataType}</code></li>)}</ul></div></div>
      <div className="relations-column"><h3><ArrowLeft size={13}/>{tr('이 테이블이 참조', 'References')} <span>{outgoing.length}</span></h3>{outgoing.length ? <ul>{outgoing.map(key => relation(key, key.target, 'out'))}</ul> : <p className="relations-none">{tr('없음', 'None')}</p>}</div>
    </div>}
    {schema && !incoming.length && !outgoing.length && <p className="relations-empty">{tr('이 테이블에는 외래키 관계가 없습니다.', 'This table has no foreign key relations.')}</p>}
  </section>;
}
