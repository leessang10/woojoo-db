import type { Table } from './model';

// Deliberately accept only SELECT * from one known base table. Expressions,
// aliases, joins and partial projections have no reliable editable provenance.
export function queryOrigin(sql:string,tables:Table[]):Table|null {
  const ident='(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[A-Za-z_][A-Za-z0-9_$]*)';
  const match=new RegExp(`^\\s*SELECT\\s+\\*\\s+FROM\\s+(${ident})(?:\\s*\\.\\s*(${ident}))?\\s*((?:WHERE\\s|ORDER\\s+BY\\s|LIMIT\\s)[\\s\\S]*|;?\\s*)$`,'i').exec(sql);
  if(!match||!match[2]||/\b(JOIN|UNION|INTERSECT|EXCEPT|GROUP|HAVING|SELECT|RETURNING|INTO|FOR)\b|--|\/\*/i.test(match[3])||match[3].replace(/;\s*$/,'').includes(';'))return null;
  const unquote=(v:string)=>v.startsWith('"')?v.slice(1,-1).replaceAll('""','"'):v.startsWith('`')?v.slice(1,-1).replaceAll('``','`'):v;
  const schema=match[2]?unquote(match[1]):null,name=unquote(match[2]??match[1]);
  const matches=tables.filter(t=>t.name===name&&(!schema||t.schema===schema));
  return matches.length===1?matches[0]:null;
}
