import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Edit, Profile, Result, Row, Table } from './model';

export const desktop = isTauri();
const columns = [
  { name: 'id', dataType: 'int8', primary: true, editable: false },
  { name: 'name', dataType: 'varchar', primary: false, editable: true },
  { name: 'email', dataType: 'varchar', primary: false, editable: true },
  { name: 'role', dataType: 'varchar', primary: false, editable: true },
  { name: 'status', dataType: 'varchar', primary: false, editable: true },
  { name: 'created_at', dataType: 'timestamp', primary: false, editable: false },
];
const people = [
  ['Alex Morgan', 'alex.morgan', 'Admin', 'active'], ['Sofia Chen', 'sofia.chen', 'Editor', 'active'],
  ['James Park', 'james.park', 'Member', 'active'], ['Olivia Kim', 'olivia.kim', 'Member', 'pending'],
  ['Noah Williams', 'noah.w', 'Editor', 'active'], ['Emma Wilson', 'emma.wilson', 'Member', 'active'],
  ['Liam Davis', 'liam.davis', 'Member', 'inactive'], ['Isabella Lee', 'isabella.lee', 'Admin', 'active'],
  ['Lucas Brown', 'lucas.brown', 'Member', 'active'], ['Mia Johnson', 'mia.j', 'Editor', 'pending'],
  ['Ethan Miller', 'ethan.miller', 'Member', 'active'], ['Amelia Song', 'amelia.song', 'Member', 'active'],
];
let demoRows: Row[] = people.map((p, i) => ({ id: String(1001 + i), name: p[0], email: p[1] + '@woojoo.dev', role: p[2], status: p[3], created_at: `2026-10-${String(20 - i).padStart(2, '0')} 09:24:00` }));
const wait = () => new Promise(r => setTimeout(r, 180));
export async function connect(profile: Profile): Promise<string> {
  if (!desktop) throw new Error('실제 DB 연결은 데스크톱 앱에서 지원합니다. npm run desktop으로 실행해 주세요.');
  return invoke('connect_db', { profile });
}
export async function disconnect(id: string) { if (id !== 'demo') await invoke('disconnect_db', { id }); }
export async function tables(id: string): Promise<Table[]> {
  if (id === 'demo') return [{ schema: 'public', name: 'users' }];
  return invoke('list_tables', { id });
}
export async function readTable(id: string, table: Table): Promise<Result> {
  if (id === 'demo') { await wait(); return { columns, rows: structuredClone(demoRows), elapsedMs: 12, affected: 0, truncated: false }; }
  return invoke('read_table', { id, table });
}
export async function query(id: string, sql: string): Promise<Result> {
  if (id === 'demo') {
    await wait();
    if (!/^\s*select\s+\*\s+from\s+(?:(?:"?public"?|`public`)\.)?(?:"users"|`users`|users)(?:\s+limit\s+\d+)?\s*;?\s*$/i.test(sql)) {
      throw new Error('데모는 users 테이블의 SELECT * 미리보기만 지원합니다. 자유 SQL은 실제 DB 연결 후 실행하세요.');
    }
    return { ...(await readTable(id, {schema:'public', name:'users'})), columns: columns.map(c => ({...c, editable:false})) };
  }
  return invoke('run_query', { id, sql });
}
export async function save(id: string, table: Table, edits: Edit[]) {
  if (id === 'demo') {
    await wait();
    demoRows = demoRows.map(row => {
      const edit = edits.find(e => e.original.id === row.id);
      return edit ? { ...row, ...edit.changes } : row;
    });
    return edits.length;
  }
  return invoke<number>('apply_edits', { id, table, edits });
}
