import { Children, Fragment, cloneElement, isValidElement, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { nextDirection, stableSort, type SortDirection } from '../lib/table-sort';
import './SortableTable.css';

type ElementProps = { children?: ReactNode; value?: unknown; 'data-sort-value'?: unknown; 'data-sort-fixed'?: boolean; colSpan?: number };
function elements(children: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(children).filter(isValidElement) as ReactElement<ElementProps>[];
}
function flatten(children: ReactNode): ReactElement<ElementProps>[] {
  return elements(children).flatMap(child => child.type === Fragment ? flatten(child.props.children) : [child]);
}
function valueOf(node: ReactNode): unknown {
  if (!isValidElement<ElementProps>(node)) return typeof node === 'boolean' ? '' : node ?? '';
  if ('data-sort-value' in node.props) return node.props['data-sort-value'];
  if ('value' in node.props) return node.props.value;
  return Children.toArray(node.props.children).map(valueOf).join('');
}
/** Sort React rows, never the source data: handlers/keys keep their original row identity.
 * A fragment (e.g. an expanded history record) moves as one unit. */
export function SortableTable({ children, ...props }: ComponentProps<'table'>) {
  const parts = elements(children), head = parts.find(p => p.type === 'thead');
  const headings = flatten(flatten(head?.props.children)[0]?.props.children);
  const signature = headings.map(h => valueOf(h)).join('\u0000');
  const [sort, setSort] = useState<{ column: number; direction: SortDirection; signature: string }>();
  const current = sort?.signature === signature ? sort : undefined;
  function toggle(column: number) {
    setSort(previous => { const direction = nextDirection(previous?.signature === signature && previous.column === column ? previous.direction : undefined); return direction ? { column, direction, signature } : undefined; });
  }
  return <table {...props}>{parts.map(part => {
    if (part.type === 'thead') return cloneElement(part, {}, elements(part.props.children).map(row => cloneElement(row, {}, flatten(row.props.children).map((heading, column) => {
      if (!String(valueOf(heading) ?? '').trim()) return heading;
      const direction = current?.column === column ? current.direction : undefined;
      return cloneElement(heading as ReactElement<ComponentProps<'th'>>, {
        scope: 'col', tabIndex: 0, 'aria-sort': direction ?? 'none', className: `${(heading.props as ComponentProps<'th'>).className ?? ''} sortable-heading`,
        onClick: () => toggle(column), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggle(column); } },
      }, <>{heading.props.children}<span className="table-sort-arrow" aria-hidden="true">{direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : '↕'}</span></>);
    }))));
    if (part.type !== 'tbody' || !current) return part;
    const rows = elements(part.props.children);
    const firstRow = (row: ReactElement<ElementProps>) => row.type === Fragment ? flatten(row.props.children)[0] : row;
    const pinned = (row: ReactElement<ElementProps>) => firstRow(row)?.props['data-sort-fixed'];
    const sorted = stableSort(rows.filter(row => !pinned(row)), row => valueOf(flatten(firstRow(row)?.props.children)[current.column]), current.direction);
    return cloneElement(part, {}, [...sorted, ...rows.filter(pinned)]);
  })}</table>;
}
