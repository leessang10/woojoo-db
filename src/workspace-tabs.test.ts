import { beforeEach, describe, expect, it } from 'vitest';
import { createTab, restoreTabs } from './workspace-tabs';

const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
const save = (tabs: object[]) => store.set('woojoo-workspace-v1', JSON.stringify({ tabs }));
const users = { schema: 'public', name: 'users' };

describe('restoring saved tabs', () => {
  beforeEach(() => store.clear());
  it('turns legacy structure and ERD tabs into views of table and schema tabs', () => {
    save([
      { id: 'a', profileId: 'p', kind: 'details', selected: users, objectSchema: 'public', editorSql: '' },
      { id: 'b', profileId: 'p', kind: 'erd', selected: null, objectSchema: 'public', editorSql: '' },
    ]);
    const tabs = restoreTabs(createTab('demo', 0));
    expect(tabs.map(tab => [tab.id, tab.kind, tab.view])).toEqual([['a', 'table', 'structure'], ['b', 'schema', 'erd']]);
  });
  it('folds a legacy tab into an existing tab for the same object and keeps saved views', () => {
    save([
      { id: 'data', profileId: 'p', kind: 'table', view: 'relations', selected: users, objectSchema: 'public', editorSql: 'SELECT 1' },
      { id: 'old', profileId: 'p', kind: 'details', selected: users, objectSchema: 'public', editorSql: '' },
      { id: 'schema', profileId: 'p', kind: 'schema', selected: null, objectSchema: 'public', editorSql: '' },
      { id: 'erd', profileId: 'p', kind: 'erd', selected: null, objectSchema: 'public', editorSql: '' },
      { id: 'q', profileId: 'p', kind: 'query', selected: null, objectSchema: '', editorSql: 'SELECT 2', querySchema: 'sales' },
    ]);
    const tabs = restoreTabs(createTab('demo', 0));
    expect(tabs.map(tab => tab.id)).toEqual(['data', 'schema', 'q']);
    expect(tabs[0].view).toBe('relations');
    expect(tabs[2].querySchema).toBe('sales');
  });
});
