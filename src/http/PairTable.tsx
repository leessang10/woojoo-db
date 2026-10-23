import { FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '../i18n';
import { pickFile } from './api';
import type { Pair } from './model';

/** Editable key/value rows. A blank last row is always there; typing into it adds a row. */
export function PairTable({ pairs, onChange, files = false, keyLabel, valueLabel, secretValues = false, label }: {
  pairs: Pair[]; onChange: (pairs: Pair[]) => void; files?: boolean; keyLabel?: string; valueLabel?: string; secretValues?: boolean; label: string;
}) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const rows = [...pairs, { key: '', value: '', enabled: true }];
  function update(index: number, patch: Partial<Pair>) {
    const next = rows.map((pair, i) => i === index ? { ...pair, ...patch } : pair);
    onChange(next.filter((pair, i) => i < next.length - 1 || pair.key || pair.value || pair.file));
  }
  const remove = (index: number) => onChange(pairs.filter((_, i) => i !== index));
  async function choose(index: number) { const path = await pickFile(); if (path) update(index, { value: path, file: true }); }
  return <table className="api-pairs" aria-label={label}>
    <thead><tr><th className="api-pair-check"/><th>{keyLabel ?? tr('키', 'Key')}</th><th>{valueLabel ?? tr('값', 'Value')}</th><th className="api-pair-tools"/></tr></thead>
    <tbody>{rows.map((pair, index) => { const last = index === rows.length - 1; return <tr key={index} data-disabled={!pair.enabled || undefined}>
      <td className="api-pair-check">{!last && <input type="checkbox" checked={pair.enabled} aria-label={tr('사용', 'Enabled')} onChange={event => update(index, { enabled: event.target.checked })}/>}</td>
      <td><input value={pair.key} placeholder={last ? tr('추가', 'Add') : ''} aria-label={keyLabel ?? tr('키', 'Key')} spellCheck={false} onChange={event => update(index, { key: event.target.value })}/></td>
      <td>{pair.file
        ? <span className="api-pair-file" title={pair.value}><FileUp size={12}/><span>{pair.value.split(/[\\/]/).pop()}</span></span>
        : <input value={pair.value} type={secretValues && !last ? 'password' : 'text'} aria-label={valueLabel ?? tr('값', 'Value')} spellCheck={false} onChange={event => update(index, { value: event.target.value })}/>}</td>
      <td className="api-pair-tools">
        {files && <Button variant="ghost" size="bare" className="icon-button" title={pair.file ? tr('텍스트 값으로 바꾸기', 'Use a text value') : tr('파일 선택', 'Choose file')} aria-label={tr('파일 선택', 'Choose file')} onClick={() => pair.file ? update(index, { file: false, value: '' }) : void choose(index)}><FileUp size={13}/></Button>}
        {!last && <Button variant="ghost" size="bare" className="icon-button" title={tr('삭제', 'Remove')} aria-label={tr('행 삭제', 'Remove row')} onClick={() => remove(index)}><X size={13}/></Button>}
      </td>
    </tr>; })}</tbody>
  </table>;
}
