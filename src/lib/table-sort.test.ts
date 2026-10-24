import { describe, expect, it } from 'vitest';
import { compareValues, nextDirection, stableSort } from './table-sort';
describe('table sorting', () => {
 it('cycles ascending, descending, then unsorted', () => { expect(nextDirection()).toBe('ascending'); expect(nextDirection('ascending')).toBe('descending'); expect(nextDirection('descending')).toBeUndefined(); });
 it('compares numbers, large integers, natural names and dates', () => {
  expect(compareValues('-10', '-2')).toBeLessThan(0);
  expect(compareValues('9007199254740993', '9007199254740992')).toBeGreaterThan(0);
  expect(compareValues('item2','item10')).toBeLessThan(0);
  expect(compareValues('2026-01-01T01:00:00+09:00','2026-01-01T00:00:00Z')).toBeLessThan(0);
 });
 it('preserves ties and source order, keeps missing values last', () => {
  const rows = [{id:'a',n:10},{id:'b',n:2},{id:'c',n:2},{id:'d',n:null}];
  expect(stableSort(rows,r=>r.n,'ascending').map(r=>r.id)).toEqual(['b','c','a','d']);
  expect(stableSort(rows,r=>r.n,'descending').map(r=>r.id)).toEqual(['a','b','c','d']);
  expect(stableSort(rows,r=>r.n).map(r=>r.id)).toEqual(['a','b','c','d']);
  expect(rows.map(r=>r.id)).toEqual(['a','b','c','d']);
 });
});
