import { cellType } from './cell-data';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Pencil, Search, X } from 'lucide-react';
import type { Column, Row } from './model';
import { useLanguage } from './i18n';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { formatInspectorValue } from './row-inspector';
import './row-inspector.css';

type Props = {
  columns: Column[];
  row: Row;
  draft: Record<string, string | null>;
  rowIndex: number;
  position: number;
  total: number;
  canEdit: boolean;
  busy: boolean;
  onMove: (step: 1 | -1) => void;
  onClose: () => void;
  onCopy: (text: string) => void;
  onEdit: (column: Column, value: string | null) => void;
};

export function RowInspector({ columns, row, draft, rowIndex, position, total, canEdit, busy, onMove, onClose, onCopy, onEdit }: Props) {
  const { language } = useLanguage();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [query, setQuery] = useState('');
  const fields = useMemo(() => columns.map(column => {
    const key = `${rowIndex}:${column.name}`;
    const value = key in draft ? draft[key] : row[column.name];
    return { column, value, changed: key in draft && draft[key] !== row[column.name] };
  }), [columns, row, draft, rowIndex]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? fields.filter(({ column, value }) => column.name.toLowerCase().includes(needle) || (value ?? 'null').toLowerCase().includes(needle)) : fields;
  return <aside id="row-inspector" className="row-inspector" aria-label={tr('행 상세', 'Row details')}>
    <header className="row-inspector-head">
      <strong aria-live="polite">{tr(`행 ${position + 1} / ${total}`, `Row ${position + 1} of ${total}`)}</strong>
      <span className="tabs-spacer"/>
      <Button variant="ghost" size="bare" className="icon-button" title={tr('이전 행', 'Previous row')} aria-label={tr('이전 행', 'Previous row')} disabled={position <= 0} onClick={() => onMove(-1)}><ChevronUp size={15}/></Button>
      <Button variant="ghost" size="bare" className="icon-button" title={tr('다음 행', 'Next row')} aria-label={tr('다음 행', 'Next row')} disabled={position >= total - 1} onClick={() => onMove(1)}><ChevronDown size={15}/></Button>
      <Button variant="ghost" size="bare" className="icon-button" title={tr('행 상세 닫기', 'Close row details')} aria-label={tr('행 상세 닫기', 'Close row details')} onClick={onClose}><X size={15}/></Button>
    </header>
    <label className="row-inspector-search"><Search size={13} aria-hidden="true"/><Input aria-label={tr('열과 값 검색', 'Filter columns and values')} placeholder={tr('열과 값 검색', 'Filter columns and values')} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <dl className="row-inspector-fields">
      {shown.map(({ column, value, changed }) => {
        const formatted = value === null ? null : formatInspectorValue(value);
        const editable = canEdit && column.editable && !busy;
        return <div key={column.name} className="row-inspector-field" data-changed={changed || undefined}>
          <dt><span className="row-inspector-name" title={column.name}>{column.name}</span><span className="row-inspector-type">{column.dataType}</span>
            <span className="row-inspector-actions">
              <Button variant="ghost" size="bare" className="icon-button" title={tr('값 복사', 'Copy value')} aria-label={`${tr('값 복사', 'Copy value')}: ${column.name}`} onClick={() => onCopy(value ?? 'NULL')}><Copy size={12}/></Button>
              {editable && <Button variant="ghost" size="bare" className="icon-button" title={tr('셀 편집', 'Edit cell')} aria-label={`${tr('셀 편집', 'Edit cell')}: ${column.name}`} onClick={() => onEdit(column, value)}><Pencil size={12}/></Button>}
            </span>
          </dt>
          <dd data-value-type={cellType(column.dataType,value)} className={`data-cell ${formatted?.json ? 'is-json' : ''}`}>{formatted === null ? <span className="null-value">NULL</span> : formatted.text === '' ? <span className="empty-value">{tr('(빈 문자열)', '(empty string)')}</span> : formatted.text}</dd>
        </div>;
      })}
      {!shown.length && <p className="row-inspector-empty">{tr('일치하는 열이 없습니다.', 'No matching columns.')}</p>}
    </dl>
  </aside>;
}
