import { useRef, useState, type ReactElement } from 'react';
import { Popover } from 'radix-ui';
import { Check, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { useLanguage } from './i18n';

type Choice = { id: string; label: string };
type Props = {
  label: string;
  choices: Choice[];
  value?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onSelect: (value: string) => void;
  children: ReactElement;
};

export function WorkspacePicker({ label, choices, value, loading, error, onRetry, onSelect, children }: Props) {
  const { language } = useLanguage();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const filtered = choices.filter(choice => choice.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <Popover.Root open={open} onOpenChange={next => { setOpen(next); setSearch(''); }}>
    <Popover.Trigger asChild>{children}</Popover.Trigger>
    <Popover.Portal><Popover.Content className="connection-picker workspace-picker" align="start" sideOffset={6} collisionPadding={12}
      aria-label={label} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-workspace-option]'));
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}>
      <div className="connection-picker-search"><Search size={15}/><Input ref={input} aria-label={tr(`${label} 검색`, `Search ${label.toLowerCase()}`)} placeholder={tr('이름으로 검색', 'Search by name')} value={search} onChange={event => setSearch(event.target.value)}/></div>
      <div className="connection-picker-list">
        {loading ? <p className="connection-picker-empty" role="status">{tr('불러오는 중…', 'Loading…')}</p>
          : error ? <div className="picker-error"><p role="alert">{error}</p>{onRetry && <Button size="sm" variant="outline" onClick={onRetry}>{tr('다시 시도', 'Retry')}</Button>}</div>
          : filtered.map(choice => <Button key={choice.id} variant="ghost" size="bare" className="connection-picker-option" data-workspace-option aria-pressed={choice.id === value} onClick={() => { setOpen(false); setSearch(''); onSelect(choice.id); }}>
            <span className="workspace-choice" title={choice.label}>{choice.label}</span>{choice.id === value && <Check size={15}/>}
          </Button>)}
        {!loading && !error && !filtered.length && <p className="connection-picker-empty">{search ? tr('검색 결과가 없습니다.', 'No matching items.') : tr('항목이 없습니다.', 'No items available.')}</p>}
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
