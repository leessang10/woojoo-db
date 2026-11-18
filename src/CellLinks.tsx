import { ArrowUpRight } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { Button } from './components/ui/button';
import { useLanguage } from './i18n';
import type { CellDestination } from './cell-data';

type Props = { destinations: CellDestination[]; column: string; disabled?: boolean; onNavigate: (destination: CellDestination) => void };

export function CellLinks({ destinations, column, disabled, onNavigate }: Props) {
  const { language } = useLanguage();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  if (!destinations.length) return null;
  const label = (destination: CellDestination) => {
    const name = `${destination.table.schema}.${destination.table.name}`;
    const target = destination.filters.map(filter => `${filter.column} = ${filter.value}`).join(', ');
    return `${destination.direction === 'original' ? tr('원본 행', 'Original row') : destination.direction === 'reference' ? tr('참조 행', 'Referenced row') : tr('참조하는 행', 'Referencing rows')} · ${name} · ${target}`;
  };
  const trigger = <Button variant="ghost" size="bare" className="cell-navigation" disabled={disabled} title={destinations.length === 1 ? label(destinations[0]) : tr(`${column} 관계 이동`, `Follow ${column} relations`)} aria-label={tr(`${column} 관계 이동`, `Follow ${column} relations`)}
    onClick={destinations.length === 1 ? event => { event.stopPropagation(); onNavigate(destinations[0]); } : undefined}
    onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <ArrowUpRight size={12}/>
  </Button>;
  if (destinations.length === 1) return trigger;
  return <DropdownMenu><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger><DropdownMenuContent align="start">
    {destinations.map(destination => <DropdownMenuItem key={destination.id} onSelect={() => onNavigate(destination)}>{label(destination)}</DropdownMenuItem>)}
  </DropdownMenuContent></DropdownMenu>;
}
