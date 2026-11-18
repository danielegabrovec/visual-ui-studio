/**
 * Schema/CTE/Alias-Aware SQL Autocomplete, Statement Splitter & Offline Italian Query Explainer.
 * Ported & adapted from `Database Manager/src/editor/sqlLanguage.ts` (zero Monaco dependency).
 *
 * Supports all 5 SQL dialects (`sqlite`, `postgresql`, `mysql`, `mariadb`, `sqlserver` T-SQL).
 * Pure TypeScript, zero Node imports.
 */

import { DIALECT_TYPE_CHOICES, qualifyTableName, quoteIdentifier } from './sql-dialects';
import type { SqlColumnDef, SqlDesignDocument, SqlDialect, SqlTableDef } from './sql-ir';

export interface SqlLexToken {
  text: string;
  value: string;
  start: number;
  end: number;
  kind: 'word' | 'identifier' | 'string' | 'comment' | 'symbol';
  closed?: boolean;
}

export interface SqlAliasBinding {
  alias: string;
  table: SqlTableDef;
  scopeStart: number;
  scopeEnd: number;
  source: 'table' | 'cte' | 'subquery';
}

export interface SqlCompletionItem {
  label: string;
  insertText: string;
  detail: string;
  documentation: string;
  kind: 'table' | 'column' | 'alias' | 'keyword' | 'function' | 'snippet';
  replacementStart: number;
  replacementEnd: number;
}

export interface SqlQueryExplanationStep {
  clause: string;
  title: string;
  explanation: string;
  start: number;
  end: number;
}

export interface SqlQueryExplanation {
  summary: string;
  steps: SqlQueryExplanationStep[];
  warnings: string[];
  parameters: string[];
  tables: string[];
  logicalOrder: string[];
}

export interface SqlFunctionMeta {
  name: string;
  signature: string;
  description: string;
  dialects?: SqlDialect[];
}

export const SQL_CLAUSE_HELP_IT: Record<string, { title: string; description: string }> = {
  SELECT: {
    title: 'Colonne del risultato',
    description:
      'Sceglie le colonne e le espressioni da restituire. Usa AS per assegnare un alias leggibile.',
  },
  TOP: {
    title: 'Limite righe T-SQL',
    description:
      'SQL Server: restituisce soltanto le prime N righe. Abbinalo a ORDER BY per un ordine deterministico.',
  },
  FROM: {
    title: 'Origine dei dati',
    description:
      'Indica la tabella, vista o sottoquery da leggere. Un alias breve consente riferimenti come c.email.',
  },
  JOIN: {
    title: 'Collegamento tra tabelle',
    description:
      'Combina righe tramite la condizione ON. INNER JOIN conserva solo le corrispondenze; LEFT JOIN mantiene tutte le righe di sinistra.',
  },
  'INNER JOIN': {
    title: 'Collegamento interno (INNER JOIN)',
    description:
      'Restituisce soltanto le righe che hanno corrispondenza in entrambe le tabelle collegate.',
  },
  'LEFT JOIN': {
    title: 'Collegamento sinistro (LEFT JOIN)',
    description:
      'Conserva tutte le righe della tabella di sinistra, valorizzando con NULL i campi mancanti a destra.',
  },
  ON: {
    title: 'Condizione della relazione',
    description:
      'Specifica l\'uguaglianza tra chiave esterna e chiave primaria delle due tabelle.',
  },
  WHERE: {
    title: 'Filtro sulle righe',
    description:
      'Filtra le righe prima del raggruppamento. Per verificare NULL usa IS NULL o IS NOT NULL.',
  },
  'GROUP BY': {
    title: 'Raggruppamento',
    description:
      'Raggruppa righe con gli stessi valori per calcolare COUNT, SUM, AVG, MIN o MAX.',
  },
  HAVING: {
    title: 'Filtro sui gruppi',
    description:
      'Filtra i gruppi risultanti da GROUP BY su valori aggregati (es. HAVING COUNT(*) > 1).',
  },
  'ORDER BY': {
    title: 'Ordinamento risultati',
    description:
      'Ordina il risultato in senso crescente (ASC) o decrescente (DESC).',
  },
  LIMIT: {
    title: 'Limite numero di righe',
    description:
      'Restituisce al massimo il numero indicato di righe (SQLite, PostgreSQL, MySQL, MariaDB).',
  },
  OFFSET: {
    title: 'Scorrimento paginazione',
    description:
      'Salta le prime N righe prima di restituire la pagina richiesta.',
  },
  FETCH: {
    title: 'Paginazione standard / T-SQL',
    description:
      'FETCH NEXT n ROWS ONLY restituisce la pagina successiva dopo OFFSET in SQL Server e PostgreSQL.',
  },
  WITH: {
    title: 'Common Table Expression (CTE)',
    description:
      'Definisce una vista temporanea nominata riutilizzabile all\'interno della query corrente.',
  },
  INSERT: {
    title: 'Inserimento righe',
    description:
      'Aggiunge nuovi record nella tabella rispettando chiavi primarie, esterne e vincoli NOT NULL / CHECK.',
  },
  UPDATE: {
    title: 'Aggiornamento dati',
    description:
      'Modifica i campi delle righe selezionate da WHERE. Senza WHERE aggiorna l\'intera tabella!',
  },
  DELETE: {
    title: 'Eliminazione righe',
    description:
      'Rimuove le righe individuate da WHERE. Senza WHERE svuota l\'intera tabella!',
  },
  CREATE: {
    title: 'Creazione struttura DDL',
    description:
      'Crea tabelle, schemi, viste o indici nel database.',
  },
  ALTER: {
    title: 'Modifica struttura DDL',
    description:
      'Aggiorna colonne, chiavi o vincoli di una tabella esistente.',
  },
  DROP: {
    title: 'Rimozione oggetto DDL',
    description:
      'Elimina definitivamente una tabella, vista o indice e i relativi dati.',
  },
};

export const SQL_BUILTIN_FUNCTIONS: SqlFunctionMeta[] = [
  {
    name: 'COUNT',
    signature: 'COUNT(* | colonna)',
    description: 'Conta tutte le righe (*) oppure i valori non NULL della colonna.',
  },
  {
    name: 'SUM',
    signature: 'SUM(espressione)',
    description: 'Calcola la somma dei valori numerici non NULL.',
  },
  {
    name: 'AVG',
    signature: 'AVG(espressione)',
    description: 'Calcola la media aritmetica dei valori numerici non NULL.',
  },
  {
    name: 'MIN',
    signature: 'MIN(espressione)',
    description: 'Restituisce il valore minimo non NULL.',
  },
  {
    name: 'MAX',
    signature: 'MAX(espressione)',
    description: 'Restituisce il valore massimo non NULL.',
  },
  {
    name: 'COALESCE',
    signature: 'COALESCE(val1, val2, ...)',
    description: 'Restituisce il primo argomento non NULL.',
  },
  {
    name: 'LOWER',
    signature: 'LOWER(testo)',
    description: 'Converte una stringa in lettere minuscole.',
  },
  {
    name: 'UPPER',
    signature: 'UPPER(testo)',
    description: 'Converte una stringa in lettere maiuscole.',
  },
  {
    name: 'ROUND',
    signature: 'ROUND(numero, decimali)',
    description: 'Arrotonda un valore numerico al numero di cifre decimali specificato.',
  },
  {
    name: 'STRFTIME',
    signature: "STRFTIME('%Y-%m-%d', colonna)",
    description: 'SQLite: formatta date e timestamp.',
    dialects: ['sqlite'],
  },
  {
    name: 'DATE_TRUNC',
    signature: "DATE_TRUNC('day', colonna)",
    description: 'PostgreSQL: tronca un timestamp all\'unità temporale richiesta.',
    dialects: ['postgresql'],
  },
  {
    name: 'DATE_FORMAT',
    signature: "DATE_FORMAT(colonna, '%Y-%m-%d')",
    description: 'MySQL / MariaDB: formatta una data con pattern.',
    dialects: ['mysql', 'mariadb'],
  },
  {
    name: 'ISNULL',
    signature: 'ISNULL(espressione, valore_alternativo)',
    description: 'SQL Server T-SQL: sostituisce NULL con il valore specificato.',
    dialects: ['sqlserver'],
  },
  {
    name: 'DATEADD',
    signature: 'DATEADD(day, numero, data)',
    description: 'SQL Server T-SQL: aggiunge un intervallo a una data.',
    dialects: ['sqlserver'],
  },
  {
    name: 'NEWID',
    signature: 'NEWID()',
    description: 'SQL Server T-SQL: genera un nuovo UNIQUEIDENTIFIER (UUID v4).',
    dialects: ['sqlserver'],
  },
  {
    name: 'ROW_NUMBER',
    signature: 'ROW_NUMBER() OVER (ORDER BY ...)',
    description: 'Assegna un numero sequenziale alle righe della partizione.',
  },
];

const RESERVED_SQL_WORDS = new Set(
  'SELECT TOP FROM WHERE JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING GROUP BY HAVING ORDER LIMIT OFFSET FETCH NEXT ROWS ONLY AS UNION ALL DISTINCT WITH RECURSIVE INSERT INTO VALUES UPDATE SET DELETE CREATE ALTER DROP TABLE VIEW INDEX BEGIN TRANSACTION COMMIT ROLLBACK AND OR NOT NULL IS IN LIKE ILIKE BETWEEN EXISTS ASC DESC OVER PARTITION CASE WHEN THEN ELSE END GO'.split(
    ' ',
  ),
);

export function tokenizeSql(text: string): SqlLexToken[] {
  const result: SqlLexToken[] = [];
  let i = 0;

  const push = (
    start: number,
    kind: SqlLexToken['kind'],
    value?: string,
    closed?: boolean,
  ) => {
    result.push({
      text: text.slice(start, i),
      value: value ?? text.slice(start, i),
      start,
      end: i,
      kind,
      closed,
    });
  };

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const start = i;
    if (text.startsWith('--', i)) {
      while (i < text.length && text[i] !== '\n') i++;
      push(start, 'comment');
      continue;
    }
    if (text.startsWith('/*', i)) {
      i += 2;
      let depth = 1;
      while (i < text.length && depth > 0) {
        if (text.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (text.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      push(start, 'comment');
      continue;
    }
    const dollarTag = text.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0];
    if (dollarTag) {
      i += dollarTag.length;
      const end = text.indexOf(dollarTag, i);
      i = end < 0 ? text.length : end + dollarTag.length;
      push(start, 'string', undefined, end >= 0);
      continue;
    }
    if ((text[i] === 'N' || text[i] === 'n') && text[i + 1] === "'") {
      i += 2;
      let val = '';
      let closed = false;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            val += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        val += text[i++];
      }
      push(start, 'string', val, closed);
      continue;
    }
    if ('\'"`['.includes(text[i])) {
      const opener = text[i++];
      const closer = opener === '[' ? ']' : opener;
      let val = '';
      let closed = false;
      while (i < text.length) {
        if (text[i] === closer) {
          if (text[i + 1] === closer) {
            val += closer;
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (opener === "'" && text[i] === '\\' && i + 1 < text.length) {
          val += text[i + 1];
          i += 2;
        } else {
          val += text[i++];
        }
      }
      push(start, opener === "'" ? 'string' : 'identifier', val, closed);
      continue;
    }
    if (/[\w$@\u0080-\uFFFF]/.test(text[i])) {
      while (i < text.length && /[\w$@\u0080-\uFFFF]/.test(text[i])) i++;
      push(start, 'word');
      continue;
    }
    i++;
    push(start, 'symbol');
  }
  return result;
}

export function maskSqlNonCode(text: string): string {
  const parts: string[] = [];
  let offset = 0;
  for (const tok of tokenizeSql(text)) {
    if (tok.kind !== 'string' && tok.kind !== 'comment' && tok.kind !== 'identifier') continue;
    parts.push(text.slice(offset, tok.start), tok.text.replace(/[^\r\n]/g, ' '));
    offset = tok.end;
  }
  parts.push(text.slice(offset));
  return parts.join('');
}

/**
 * Safely splits a multi-statement SQL script on top-level `;` (and T-SQL `GO` batch lines),
 * ignoring semicolons inside strings, quoted identifiers, dollar strings, and comments.
 */
export function splitSqlStatements(sql: string, dialect?: SqlDialect): string[] {
  const normalized =
    dialect === 'sqlserver'
      ? sql.replace(/^\s*GO(?:\s+\d+)?\s*;?\s*$/gim, ';')
      : sql;

  const tokens = tokenizeSql(normalized);
  const statements: string[] = [];
  let segStart = 0;

  for (const tok of tokens) {
    if (tok.kind === 'symbol' && tok.value === ';') {
      const slice = normalized.slice(segStart, tok.start).trim();
      if (slice && slice.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '').trim()) {
        statements.push(slice);
      }
      segStart = tok.end;
    }
  }
  const tail = normalized.slice(segStart).trim();
  if (tail && tail.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '').trim()) {
    statements.push(tail);
  }
  return statements;
}

function isIdentToken(tok: SqlLexToken | undefined): tok is SqlLexToken {
  if (!tok) return false;
  if (tok.kind === 'identifier') return true;
  return (
    tok.kind === 'word' &&
    !RESERVED_SQL_WORDS.has(tok.value.toUpperCase()) &&
    !/^\d/.test(tok.value)
  );
}

function findClosingParen(tokens: SqlLexToken[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].kind === 'symbol' && tokens[i].value === '(') depth++;
    else if (tokens[i].kind === 'symbol' && tokens[i].value === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function inferSubqueryColumns(subSql: string, tables: SqlTableDef[]): SqlColumnDef[] {
  const sig = tokenizeSql(subSql).filter((t) => t.kind !== 'comment' && t.kind !== 'string');
  const selIdx = sig.findIndex((t) => t.kind === 'word' && t.value.toUpperCase() === 'SELECT');
  if (selIdx < 0) return [];
  let depth = 0;
  let fromIdx = sig.length;
  for (let i = selIdx + 1; i < sig.length; i++) {
    if (sig[i].kind === 'symbol' && sig[i].value === '(') depth++;
    else if (sig[i].kind === 'symbol' && sig[i].value === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && sig[i].kind === 'word' && sig[i].value.toUpperCase() === 'FROM') {
      fromIdx = i;
      break;
    }
  }
  const groups: SqlLexToken[][] = [[]];
  depth = 0;
  for (const tok of sig.slice(selIdx + 1, fromIdx)) {
    if (depth === 0 && tok.kind === 'symbol' && tok.value === ',') {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1].push(tok);
    if (tok.kind === 'symbol' && tok.value === '(') depth++;
    else if (tok.kind === 'symbol' && tok.value === ')') depth = Math.max(0, depth - 1);
  }

  const out: SqlColumnDef[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    const asIdx = g.findIndex((t) => t.kind === 'word' && t.value.toUpperCase() === 'AS');
    if (asIdx >= 0 && isIdentToken(g[asIdx + 1])) {
      const colName = g[asIdx + 1].value;
      out.push({
        id: `cte_${colName}`,
        name: colName,
        canonicalType: 'varchar',
        nativeType: 'EXPR',
        nullable: true,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
      });
      continue;
    }
    const last = g[g.length - 1];
    if (last.kind === 'symbol' && last.value === '*') {
      const fromTblTok = sig[fromIdx + 1];
      const matched = tables.find(
        (t) => t.name.toLowerCase() === (fromTblTok?.value ?? '').toLowerCase(),
      );
      if (matched) out.push(...matched.columns);
      continue;
    }
    if (isIdentToken(last)) {
      const existing = tables.flatMap((t) => t.columns).find((c) => c.name === last.value);
      out.push(
        existing ?? {
          id: `cte_${last.value}`,
          name: last.value,
          canonicalType: 'varchar',
          nativeType: 'EXPR',
          nullable: true,
          primaryKey: false,
          unique: false,
          autoIncrement: false,
        },
      );
    }
  }
  return out;
}

export function parseSqlAliases(
  sql: string,
  schema?: SqlDesignDocument | null,
): SqlAliasBinding[] {
  const sig = tokenizeSql(sql).filter((t) => t.kind !== 'comment' && t.kind !== 'string');
  const actualTables = schema?.tables ?? [];
  const virtualTables: SqlTableDef[] = [];
  const bindings: SqlAliasBinding[] = [];

  // 1. Parse WITH CTEs (`WITH cte_name AS (SELECT ...)`)
  if (sig.some((t) => t.kind === 'word' && t.value.toUpperCase() === 'WITH')) {
    for (let i = 1; i < sig.length - 2; i++) {
      if (
        sig[i].kind === 'word' &&
        sig[i].value.toUpperCase() === 'AS' &&
        sig[i + 1]?.kind === 'symbol' &&
        sig[i + 1].value === '('
      ) {
        const cteNameTok = sig[i - 1];
        if (!isIdentToken(cteNameTok)) continue;
        const closeIdx = findClosingParen(sig, i + 1);
        const subSql = sql.slice(sig[i + 1].end, sig[closeIdx].start);
        virtualTables.push({
          id: `cte_tbl_${cteNameTok.value}`,
          name: cteNameTok.value,
          columns: inferSubqueryColumns(subSql, [...actualTables, ...virtualTables]),
          foreignKeys: [],
          indexes: [],
          checks: [],
          position: { x: 0, y: 0 },
        });
      }
    }
  }

  // 2. Parse FROM / JOIN / UPDATE / INTO table & alias bindings
  for (let i = 0; i < sig.length; i++) {
    const upper = sig[i].kind === 'word' ? sig[i].value.toUpperCase() : '';
    if (!['FROM', 'JOIN', 'UPDATE', 'INTO'].includes(upper)) continue;

    let next = i + 1;
    let table: SqlTableDef | undefined;
    let source: SqlAliasBinding['source'] = 'table';

    if (sig[next]?.kind === 'symbol' && sig[next].value === '(') {
      const closeIdx = findClosingParen(sig, next);
      const subSql = sql.slice(sig[next].end, sig[closeIdx].start);
      table = {
        id: `subq_${next}`,
        name: 'subquery',
        columns: inferSubqueryColumns(subSql, [...actualTables, ...virtualTables]),
        foreignKeys: [],
        indexes: [],
        checks: [],
        position: { x: 0, y: 0 },
      };
      source = 'subquery';
      next = closeIdx + 1;
    } else if (isIdentToken(sig[next])) {
      const parts: string[] = [sig[next++].value];
      while (sig[next]?.kind === 'symbol' && sig[next].value === '.' && isIdentToken(sig[next + 1])) {
        parts.push(sig[next + 1].value);
        next += 2;
      }
      const tblName = parts[parts.length - 1];
      const cteMatch = virtualTables.find((v) => v.name.toLowerCase() === tblName.toLowerCase());
      if (cteMatch) {
        table = cteMatch;
        source = 'cte';
      } else {
        table = actualTables.find((t) => t.name.toLowerCase() === tblName.toLowerCase());
      }
    }

    if (!table) continue;

    if (sig[next]?.kind === 'word' && sig[next].value.toUpperCase() === 'AS') {
      next++;
    }
    const aliasTok = isIdentToken(sig[next]) ? sig[next] : undefined;
    const alias = aliasTok?.value ?? (source === 'subquery' ? undefined : table.name);
    if (alias) {
      bindings.push({
        alias,
        table,
        scopeStart: 0,
        scopeEnd: sql.length,
        source,
      });
    }
  }

  return bindings;
}

export function getSqlCompletions(input: {
  sql: string;
  cursorOffset: number;
  dialect: SqlDialect;
  schema?: SqlDesignDocument | null;
}): SqlCompletionItem[] {
  const { sql, dialect, schema } = input;
  const offset = Math.max(0, Math.min(sql.length, input.cursorOffset));
  const allTokens = tokenizeSql(sql);

  // Suppress inside unclosed strings or comments
  const insideCommentOrString = allTokens.some(
    (t) =>
      t.start < offset &&
      t.end >= offset &&
      (t.kind === 'comment' || (t.kind === 'string' && t.closed === false)),
  );
  if (insideCommentOrString) return [];

  const curTok = allTokens.find(
    (t) => t.start < offset && t.end >= offset && (t.kind === 'word' || t.kind === 'identifier'),
  );
  const replacementStart = curTok?.start ?? offset;
  const replacementEnd = curTok?.end ?? offset;
  const prefix = curTok
    ? sql.slice(curTok.start, offset).replace(/^["`[]/, '').toLowerCase()
    : '';

  const beforeTokens = allTokens.filter(
    (t) => t.end <= replacementStart && t.kind !== 'comment' && t.kind !== 'string',
  );
  const lastTok = beforeTokens[beforeTokens.length - 1];
  const prevTok = beforeTokens[beforeTokens.length - 2];
  const hasDotQualifier = lastTok?.kind === 'symbol' && lastTok.value === '.';
  const qualifier = hasDotQualifier ? prevTok?.value : undefined;

  const aliases = parseSqlAliases(sql, schema);
  const tables = schema?.tables ?? [];
  const items: SqlCompletionItem[] = [];

  const pushItem = (
    label: string,
    insertText: string,
    kind: SqlCompletionItem['kind'],
    detail: string,
    documentation: string,
  ) => {
    items.push({
      label,
      insertText,
      kind,
      detail,
      documentation,
      replacementStart,
      replacementEnd,
    });
  };

  // Case 1: `alias.|` or `table.|` -> suggest columns of that alias/table!
  if (qualifier) {
    const bound = [...aliases]
      .reverse()
      .find((b) => b.alias.toLowerCase() === qualifier.toLowerCase());
    const matchedTable =
      bound?.table ??
      tables.find((t) => t.name.toLowerCase() === qualifier.toLowerCase());
    if (matchedTable) {
      for (const col of matchedTable.columns) {
        if (!prefix || col.name.toLowerCase().startsWith(prefix)) {
          pushItem(
            col.name,
            quoteIdentifier(col.name, dialect),
            'column',
            `${col.nativeType}${col.primaryKey ? ' · PK' : ''} (${matchedTable.name})`,
            `Colonna ${col.name} di ${matchedTable.name}`,
          );
        }
      }
      return items;
    }
  }

  // Case 2: Immediately after FROM / JOIN / INTO / UPDATE / TABLE -> prioritize tables & CTEs
  const prevUpper = lastTok?.kind === 'word' ? lastTok.value.toUpperCase() : '';
  const expectsTable = ['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'REFERENCES'].includes(prevUpper);

  for (const tbl of tables) {
    pushItem(
      tbl.name,
      qualifyTableName(dialect, tbl.name, tbl.schema),
      'table',
      `Tabella · ${tbl.columns.length} colonne`,
      tbl.comment ?? `Tabella ${tbl.name}`,
    );
  }
  for (const b of aliases) {
    if (b.source === 'cte') {
      pushItem(
        b.alias,
        quoteIdentifier(b.alias, dialect),
        'table',
        `CTE · ${b.table.columns.length} colonne`,
        `Common Table Expression "${b.alias}"`,
      );
    }
  }

  if (!expectsTable) {
    const visibleSources =
      aliases.length > 0
        ? aliases
        : tables.map((table) => ({ alias: table.name, table, scopeStart: 0, scopeEnd: sql.length, source: 'table' as const }));

    for (const src of visibleSources) {
      if (aliases.length > 0) {
        pushItem(
          `${src.alias}.`,
          `${src.alias}.`,
          'alias',
          `Alias → ${src.table.name}`,
          `Qualifica le colonne di ${src.table.name}`,
        );
      }
      for (const col of src.table.columns) {
        const qualifiedLabel = visibleSources.length > 1 ? `${src.alias}.${col.name}` : col.name;
        const insertExpr =
          visibleSources.length > 1
            ? `${src.alias}.${quoteIdentifier(col.name, dialect)}`
            : quoteIdentifier(col.name, dialect);
        pushItem(
          qualifiedLabel,
          insertExpr,
          'column',
          `${col.nativeType}${col.primaryKey ? ' · PK' : ''}`,
          `Colonna di ${src.table.name}`,
        );
      }
    }

    for (const fn of SQL_BUILTIN_FUNCTIONS) {
      if (!fn.dialects || fn.dialects.includes(dialect)) {
        pushItem(fn.name, `${fn.name}()`, 'function', fn.signature, fn.description);
      }
    }

    for (const dt of DIALECT_TYPE_CHOICES[dialect]) {
      pushItem(dt, dt, 'keyword', `Tipo ${dialect}`, `Tipo nativo ${dt}`);
    }

    for (const [kw, help] of Object.entries(SQL_CLAUSE_HELP_IT)) {
      if (kw === 'TOP' && dialect !== 'sqlserver') continue;
      if (kw === 'LIMIT' && dialect === 'sqlserver') continue;
      pushItem(kw, `${kw} `, 'keyword', help.title, help.description);
    }
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const matches =
      !prefix ||
      item.label.toLowerCase().startsWith(prefix) ||
      item.label.toLowerCase().includes(`.${prefix}`);
    if (!matches) return false;
    const key = `${item.kind}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function explainSqlInItalian(
  sql: string,
  dialect: SqlDialect,
  schema?: SqlDesignDocument | null,
): SqlQueryExplanation {
  const empty: SqlQueryExplanation = {
    summary: 'Scrivi o seleziona una query SQL per leggerne la spiegazione passo-passo in italiano.',
    steps: [],
    warnings: [],
    parameters: [],
    tables: [],
    logicalOrder: [],
  };
  if (!sql.trim()) return empty;

  const sig = tokenizeSql(sql).filter((t) => t.kind !== 'comment' && t.kind !== 'string');
  const steps: SqlQueryExplanationStep[] = [];
  let depth = 0;

  for (let i = 0; i < sig.length; i++) {
    const tok = sig[i];
    if (tok.kind === 'symbol' && tok.value === '(') depth++;
    else if (tok.kind === 'symbol' && tok.value === ')') depth = Math.max(0, depth - 1);
    if (depth !== 0 || tok.kind !== 'word') continue;

    const upper = tok.value.toUpperCase();
    const nextUpper = sig[i + 1]?.kind === 'word' ? sig[i + 1].value.toUpperCase() : '';
    const pair = `${upper} ${nextUpper}`;

    if (SQL_CLAUSE_HELP_IT[pair]) {
      steps.push({
        clause: pair,
        title: SQL_CLAUSE_HELP_IT[pair].title,
        explanation: SQL_CLAUSE_HELP_IT[pair].description,
        start: tok.start,
        end: sql.length,
      });
      i++;
    } else if (SQL_CLAUSE_HELP_IT[upper]) {
      steps.push({
        clause: upper,
        title: SQL_CLAUSE_HELP_IT[upper].title,
        explanation: SQL_CLAUSE_HELP_IT[upper].description,
        start: tok.start,
        end: sql.length,
      });
    }
  }

  steps.forEach((step, idx) => {
    step.end = steps[idx + 1]?.start ?? sql.length;
  });

  const firstClause = steps[0]?.clause ?? sig[0]?.value.toUpperCase() ?? '';
  const modifies = sig.some(
    (t) =>
      t.kind === 'word' &&
      ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(
        t.value.toUpperCase(),
      ),
  );

  const summary =
    (firstClause === 'SELECT' || firstClause === 'WITH') && !modifies
      ? `Query di lettura (${dialect}): seleziona dati e costruisce un ResultSet senza alterare il database.`
      : modifies
        ? `Istruzione di modifica dati o schema (${dialect}): rivedi con attenzione filtri e destinazione prima dell'esecuzione.`
        : `Analisi statica locale dell'istruzione SQL (${dialect}).`;

  const aliases = parseSqlAliases(sql, schema);
  const tables = [...new Set(aliases.filter((a) => a.source !== 'subquery').map((a) => a.table.name))];

  const masked = maskSqlNonCode(sql);
  const parameters = [
    ...new Set(masked.match(/\$\d+|(?<!:):[A-Za-z_]\w*|@[A-Za-z_]\w*|\?/g) ?? []),
  ];

  const warnings: string[] = [];
  for (const st of steps) {
    if ((st.clause === 'UPDATE' || st.clause === 'DELETE') && !steps.some((w) => w.clause === 'WHERE' && w.start > st.start)) {
      warnings.push(
        `Attenzione: ${st.clause} priva di clausola WHERE coinvolgerà TUTTE le righe della tabella!`,
      );
    }
  }
  if (/(?:=|<>|!=)\s*NULL\b/i.test(masked)) {
    warnings.push(
      'Confronto con NULL tramite "=" o "!=": in SQL usa sempre IS NULL oppure IS NOT NULL.',
    );
  }
  if (
    (steps.some((s) => s.clause === 'LIMIT') || steps.some((s) => s.clause === 'TOP')) &&
    !steps.some((s) => s.clause === 'ORDER BY')
  ) {
    warnings.push(
      'Paginazione senza ORDER BY: l\'ordine delle righe restituite non è garantito tra esecuzioni successive.',
    );
  }

  return {
    summary,
    steps,
    warnings,
    parameters,
    tables,
    logicalOrder: [
      'FROM / JOIN',
      'WHERE',
      'GROUP BY',
      'HAVING',
      'SELECT',
      'ORDER BY',
      dialect === 'sqlserver' ? 'TOP / OFFSET-FETCH' : 'LIMIT / OFFSET',
    ],
  };
}

export function explainSqlErrorInItalian(errorMsg: string, dialect: SqlDialect): string[] {
  const lower = errorMsg.toLowerCase();
  if (/foreign key|23503|547/.test(lower)) {
    return [
      'Violazione di chiave esterna (FOREIGN KEY): il valore inserito deve corrispondere a un record esistente nella tabella collegata, oppure esistono righe figlie che bloccano la cancellazione.',
    ];
  }
  if (/no such table|does not exist|42p01|1146|invalid object name/.test(lower)) {
    return [
      'Tabella non trovata: verifica il nome della tabella, lo schema attivo (es. public / dbo) o applica prima la migrazione al database.',
    ];
  }
  if (/no such column|unknown column|42703|1054|invalid column name/.test(lower)) {
    return [
      'Colonna inesistente: controlla l\'ortografia del campo e gli alias definiti in FROM / JOIN.',
    ];
  }
  if (/unique|duplicate|23505|2627|2601/.test(lower)) {
    return [
      'Valore duplicato su chiave primaria o vincolo UNIQUE: esiste già un record con la stessa chiave.',
    ];
  }
  if (/syntax|42601|1064|near/.test(lower)) {
    return [
      `Errore di sintassi SQL (${dialect}): controlla parentesi, virgole, apici e parole riservate del dialetto selezionato.`,
    ];
  }
  return [
    'Verifica nomi di tabelle/colonne, tipi dei parametri e permessi della connessione attiva.',
  ];
}
