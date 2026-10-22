import type { Engine, Result } from './model';

type Token = { text: string; kind: 'code' | 'quoted' | 'comment' };
/** Lexical boundaries are shared by splitting, formatting and parameter substitution. */
export function sqlTokens(sql: string, engine: Engine): Token[] {
  const out: Token[] = [];
  let i = 0, start = 0;
  const emit = (end: number, kind: Token['kind']) => {
    if (i > start) out.push({ text: sql.slice(start, i), kind: 'code' });
    out.push({ text: sql.slice(i, end), kind }); i = end; start = end;
  };
  while (i < sql.length) {
    if (sql.startsWith('--', i) || ((engine === 'mysql' || engine === 'mariadb') && sql[i] === '#')) {
      const end = sql.indexOf('\n', i); emit(end < 0 ? sql.length : end + 1, 'comment'); continue;
    }
    if (sql.startsWith('/*', i)) {
      let end = i + 2, depth = 1;
      while (end < sql.length && depth) {
        if (sql.startsWith('/*', end) && engine === 'postgres') { depth++; end += 2; }
        else if (sql.startsWith('*/', end)) { depth--; end += 2; }
        else end++;
      }
      if (depth) throw new Error('Unclosed SQL comment');
      emit(end, 'comment'); continue;
    }
    const dollar = engine === 'postgres' ? sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/)?.[0] : undefined;
    if (dollar) {
      const close = sql.indexOf(dollar, i + dollar.length);
      if (close < 0) throw new Error('Unclosed dollar-quoted SQL string');
      emit(close + dollar.length, 'quoted'); continue;
    }
    const quote = sql[i];
    if (quote === "'" || quote === '"' || quote === '`' || (String(engine) === 'sqlite' && quote === '[')) {
      const closing = quote === '[' ? ']' : quote;
      // Sessions explicitly enable NO_BACKSLASH_ESCAPES for MySQL/MariaDB.
      const escapes = engine === 'postgres' && quote === "'" && /(?:^|\W)[eE]$/.test(sql.slice(0, i));
      let end = i + 1, closed = false;
      while (end < sql.length) {
        if (sql[end] === '\\' && escapes) { end += 2; continue; }
        if (sql[end] === closing) {
          if (sql[end + 1] === closing && closing !== ']') { end += 2; continue; }
          end++; closed = true; break;
        }
        end++;
      }
      if (!closed) throw new Error('Unclosed SQL quote');
      emit(end, 'quoted'); continue;
    }
    i++;
  }
  if (start < i) out.push({ text: sql.slice(start), kind: 'code' });
  return out;
}

export function splitSql(sql: string, engine: Engine): string[] {
  const statements: string[] = [];
  let current = '', meaningful = false;
  for (const token of sqlTokens(sql, engine)) {
    if (token.kind !== 'code') { current += token.text; meaningful ||= token.kind === 'quoted'; continue; }
    const parts = token.text.split(';');
    parts.forEach((part, index) => {
      current += part; meaningful ||= !!part.trim();
      if (index < parts.length - 1) {
        if (meaningful) statements.push(current.trim());
        current = ''; meaningful = false;
      }
    });
  }
  if (meaningful) statements.push(current.trim());
  return statements;
}
/** The statement under the cursor; a cursor on a blank gap belongs to the preceding statement. */
export function statementAt(sql: string, engine: Engine, offset: number): string {
  const ranges: { from: number; to: number }[] = [];
  let position = 0, from = 0;
  for (const token of sqlTokens(sql, engine)) {
    if (token.kind === 'code') {
      for (let i = 0; i < token.text.length; i++) if (token.text[i] === ';') { ranges.push({ from, to: position + i + 1 }); from = position + i + 1; }
    }
    position += token.text.length;
  }
  ranges.push({ from, to: sql.length });
  const meaningful = ranges.filter(range => splitSql(sql.slice(range.from, range.to), engine).length);
  if (!meaningful.length) return '';
  const lineStart = sql.lastIndexOf('\n', offset - 1) + 1, lineEnd = sql.indexOf('\n', offset);
  const blankLine = !sql.slice(lineStart, lineEnd < 0 ? sql.length : lineEnd).trim();
  const index = meaningful.findIndex(range => offset >= range.from && offset <= range.to);
  // Before a statement's first character on a blank line, the user just finished the previous one.
  const before = index > 0 && blankLine && !sql.slice(meaningful[index].from, offset).trim();
  const current = index < 0 ? meaningful.find(range => range.from >= offset) ?? meaningful[meaningful.length - 1] : meaningful[before ? index - 1 : index];
  return sql.slice(current.from, current.to).trim();
}
/** Conservative read-only check used for production warnings; anything unknown counts as a change. */
export function isReadOnlySql(sql: string, engine: Engine): boolean {
  try {
    return splitSql(sql, engine).every(statement => {
      const code = sqlTokens(statement, engine).filter(token => token.kind === 'code').map(token => token.text).join(' ').trim();
      if (!/^(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC|VALUES|TABLE|PRAGMA)\b/i.test(code)) return false;
      return !/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|INTO)\b/i.test(code) || /^(EXPLAIN|SHOW|DESCRIBE|DESC)\b/i.test(code) && !/\bANALYZE\b/i.test(code);
    });
  } catch { return false; }
}
const parameterPattern = /(?<!:):([a-zA-Z_][a-zA-Z_0-9]*)/g;
export function parameterNames(sql: string, engine: Engine): string[] {
  return [...new Set(sqlTokens(sql, engine).filter(t => t.kind === 'code').flatMap(t => [...t.text.matchAll(parameterPattern)].map(m => m[1])))];
}
export type Parameter = { type: 'text' | 'number' | 'boolean' | 'null'; value: string };
export function parameterLiteral(parameter: Parameter, engine: Engine): string {
  if (parameter.type === 'null') return 'NULL';
  if (parameter.type === 'boolean') {
    if (!/^(true|false)$/i.test(parameter.value)) throw new Error('Boolean must be true or false');
    return parameter.value.toUpperCase();
  }
  if (parameter.type === 'number') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(parameter.value)) throw new Error('Invalid numeric parameter');
    return parameter.value;
  }
  // Hex conversion avoids both SQL mode backslash ambiguity and quote injection in MySQL.
  if (engine === 'mysql' || engine === 'mariadb') {
    const hex = [...new TextEncoder().encode(parameter.value)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `CONVERT(X'${hex}' USING utf8mb4)`;
  }
  const text = parameter.value.replaceAll("'", "''");
  return engine === 'postgres' ? `E'${text.replaceAll('\\', '\\\\')}'` : `'${text}'`;
}
export function bindParameters(sql: string, engine: Engine, parameters: Record<string, Parameter>) {
  return sqlTokens(sql, engine).map(token => token.kind === 'code' ? token.text.replace(parameterPattern, (_, name: string) => {
    if (!parameters[name]) throw new Error(`Missing parameter: ${name}`);
    return parameterLiteral(parameters[name], engine);
  }) : token.text).join('');
}
export function formatSql(sql: string, engine: Engine): string {
  return sqlTokens(sql, engine).map(token => token.kind === 'code'
    ? token.text.replace(/[ \t]+/g, ' ').replace(/(?<![:\w])\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|RETURNING|UNION ALL|UNION|LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN|SET|VALUES)\b/gi, word => `\n${word.toUpperCase()}`).replace(/;[ \t]*/g, ';\n')
    : token.text).join('').trim();
}
export function explainSql(sql: string, engine: Engine) {
  const statements = splitSql(sql, engine);
  if (statements.length !== 1) throw new Error('Explain requires exactly one statement');
  return `${String(engine) === 'sqlite' ? 'EXPLAIN QUERY PLAN' : 'EXPLAIN'} ${statements[0]}`;
}
export type ScriptResult = { index: number; sql: string; result?: Result; error?: string };
export async function executeScript(sql: string, engine: Engine, execute: (sql: string) => Promise<Result>, onResult?: (results: ScriptResult[]) => void, shouldCancel?: () => boolean) {
  const results: ScriptResult[] = [];
  for (const statement of splitSql(sql, engine)) {
    if (shouldCancel?.()) { results.push({ index: results.length + 1, sql: statement, error: 'Script cancelled' }); onResult?.([...results]); break; }
    try { results.push({ index: results.length + 1, sql: statement, result: await execute(statement) }); }
    catch (error) { results.push({ index: results.length + 1, sql: statement, error: String(error) }); onResult?.([...results]); break; }
    onResult?.([...results]);
  }
  return results;
}
export type QueryHistory = { id: string; sql: string; engine: Engine; at: string; success: boolean; count: number; duration?: number; durationScope?: 'db' | 'total'; connection?: string; connectionName?: string };
export const HISTORY_KEY = 'woojoo-query-history-v1';
export function readQueryHistory(connection?: string): QueryHistory[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(rows) ? rows.filter((row): row is QueryHistory => !!row && typeof row.sql === 'string' && typeof row.id === 'string' && typeof row.at === 'string' && typeof row.engine === 'string' && (!connection || row.connection === connection)).slice(0, 200) : [];
  } catch { return []; }
}
export function appendQueryHistory(entry: QueryHistory): boolean {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...readQueryHistory()].slice(0, 200))); return true; }
  catch { return false; }
}
