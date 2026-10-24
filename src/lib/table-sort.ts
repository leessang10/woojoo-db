export type SortDirection = 'ascending' | 'descending';
export function nextDirection(current?: SortDirection): SortDirection | undefined {
  return current === 'ascending' ? 'descending' : current === 'descending' ? undefined : 'ascending';
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareValues(a: unknown, b: unknown): number {
  const left = String(a ?? ''), right = String(b ?? '');
  if (/^[+-]?\d+$/.test(left) && /^[+-]?\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right); return x < y ? -1 : x > y ? 1 : 0;
  }
  if (left.trim() && right.trim() && Number.isFinite(Number(left)) && Number.isFinite(Number(right))) return Number(left) - Number(right);
  if (/^\d{4}-\d{2}-\d{2}(?:T| |$)/.test(left) && /^\d{4}-\d{2}-\d{2}(?:T| |$)/.test(right)) {
    const x = Date.parse(left), y = Date.parse(right); if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  }
  return collator.compare(left, right);
}
export function stableSort<T>(rows: readonly T[], value: (row: T) => unknown, direction?: SortDirection): T[] {
  if (!direction) return [...rows];
  const missing = (v: unknown) => v === null || v === undefined || v === '—' || v === '';
  return rows.map((row, index) => ({ row, index, value: value(row) })).sort((a, b) => {
    if (missing(a.value) !== missing(b.value)) return missing(a.value) ? 1 : -1;
    if (missing(a.value) && missing(b.value)) return a.index - b.index;
    return compareValues(a.value, b.value) * (direction === 'ascending' ? 1 : -1) || a.index - b.index;
  }).map(item => item.row);
}
