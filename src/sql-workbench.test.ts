import { describe, expect, it, vi } from 'vitest';
import { bindParameters, executeScript, explainSql, formatSql, isReadOnlySql, parameterLiteral, parameterNames, splitSql, statementAt } from './sql-workbench';
import type { Result } from './model';

describe('SQL workbench lexical handling', () => {
  it('splits statements without splitting quotes, comments or dollar bodies', () => {
    const sql = `SELECT 'one;two', "semi;colon"; -- skip ;\n DO $body$ BEGIN RAISE NOTICE ';'; END $body$; /* outer /* inner ; */ outer */ SELECT 3;`;
    expect(splitSql(sql, 'postgres')).toHaveLength(3);
    expect(splitSql(sql, 'postgres')[1]).toContain("RAISE NOTICE ';'");
    expect(splitSql("-- comment only;\n /* comment */", 'postgres')).toEqual([]);
  });
  it('understands escaped and doubled quotes and mysql hash comments', () => {
    expect(splitSql("SELECT E'a\\';b'; SELECT 'it''s;ok'", 'postgres')).toHaveLength(2);
    expect(splitSql("SELECT 'a\\'; # ;\n SELECT `a;b`", 'mysql')).toHaveLength(2);
  });
  it('fails before executing incomplete quoted scripts', () => {
    expect(() => splitSql("SELECT 1; SELECT 'bad", 'postgres')).toThrow('Unclosed');
    expect(() => splitSql('SELECT $$bad', 'postgres')).toThrow('Unclosed');
    expect(() => splitSql('SELECT 1 /*bad', 'postgres')).toThrow('Unclosed');
  });
  it('finds named values but preserves casts and protected text', () => {
    const sql = `SELECT :value::text, :value, ':ignored', $$:also_ignored$$ -- :comment\n, :other`;
    expect(parameterNames(sql, 'postgres')).toEqual(['value', 'other']);
    const bound = bindParameters(sql, 'postgres', { value: { type: 'text', value: "x'; DROP TABLE y; --\\" }, other: { type: 'null', value: '' } });
    expect(bound).toContain("E'x''; DROP TABLE y; --\\\\'::text");
    expect(bound).toContain("':ignored'");
    expect(bound).toContain(', NULL');
  });
  it('rejects malformed typed parameters and uses mode independent mysql text', () => {
    expect(() => parameterLiteral({ type: 'number', value: '1; SELECT 2' }, 'postgres')).toThrow();
    expect(() => parameterLiteral({ type: 'boolean', value: 'true OR true' }, 'mysql')).toThrow();
    expect(parameterLiteral({ type: 'text', value: "'\\" }, 'mysql')).toBe("CONVERT(X'275c' USING utf8mb4)");
    expect(() => bindParameters('SELECT :missing', 'postgres', {})).toThrow('Missing parameter');
  });
  it('formats clauses while preserving string, parameter and comment contents', () => {
    const formatted = formatSql("select :select, 'from where' from users -- select here\nwhere id=:id;", 'postgres');
    expect(formatted).toContain('SELECT :select');
    expect(formatted).toContain("'from where'");
    expect(formatted).toContain('-- select here\n');
    expect(formatted).toContain('\nWHERE');
    expect(explainSql('SELECT 1;', 'postgres')).toBe('EXPLAIN SELECT 1');
    expect(() => explainSql('SELECT 1; SELECT 2', 'postgres')).toThrow('exactly one');
  });
  it('retains successful results and stops at the first error', async () => {
    const result: Result = { columns: [], rows: [], elapsedMs: 1, affected: 1, truncated: false };
    const execute = vi.fn().mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('syntax error'));
    const report = vi.fn();
    const results = await executeScript('SELECT 1; BROKEN; SELECT 3', 'postgres', execute, report);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(results[0].result).toBe(result);
    expect(results[1]).toMatchObject({ index: 2, sql: 'BROKEN', error: 'Error: syntax error' });
    expect(report).toHaveBeenCalledTimes(2);
  });
});
describe('statement under the cursor', () => {
  const sql = "SELECT 1;\n\nSELECT ';' AS x;\nUPDATE t SET a = 1";
  it('picks the statement containing the cursor and ignores quoted semicolons', () => {
    expect(statementAt(sql, 'postgres', 3)).toBe('SELECT 1;');
    expect(statementAt(sql, 'postgres', sql.indexOf("';'") + 1)).toBe("SELECT ';' AS x;");
    expect(statementAt(sql, 'postgres', sql.length)).toBe('UPDATE t SET a = 1');
  });
  it('treats a cursor after a terminator or on a blank line as the previous statement', () => {
    expect(statementAt(sql, 'postgres', 'SELECT 1;'.length)).toBe('SELECT 1;');
    expect(statementAt(sql, 'postgres', 'SELECT 1;\n'.length)).toBe('SELECT 1;');
    expect(statementAt('  ', 'postgres', 1)).toBe('');
  });
});
describe('read-only SQL detection', () => {
  it('accepts queries and rejects changes, including data-modifying CTEs', () => {
    expect(isReadOnlySql('SELECT updated_at FROM t; SHOW TABLES', 'mysql')).toBe(true);
    expect(isReadOnlySql('EXPLAIN SELECT 1', 'postgres')).toBe(true);
    expect(isReadOnlySql('DELETE FROM t', 'postgres')).toBe(false);
    expect(isReadOnlySql('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', 'postgres')).toBe(false);
    expect(isReadOnlySql('SELECT * INTO copy FROM t', 'postgres')).toBe(false);
    expect(isReadOnlySql('EXPLAIN ANALYZE DELETE FROM t', 'postgres')).toBe(false);
    expect(isReadOnlySql("SELECT 'drop table'", 'postgres')).toBe(true);
  });
});
