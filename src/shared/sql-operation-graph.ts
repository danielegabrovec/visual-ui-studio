/**
 * Bidirectional Visual Query Composer (*Query Rapide* Operation Graph) <-> Parameterized SQL.
 * Ported & adapted from `Database Manager/src/designer/operationGraph.ts`,
 * `operationGraphImport.ts`, and `readOperation.ts`.
 *
 * Pipeline stages:
 *   `Source -> Join -> Filter -> Group/Aggregate -> Order -> Limit -> Read/Write`
 *
 * Supports all 5 SQL dialects (`sqlite`, `postgresql`, `mysql`, `mariadb`, `sqlserver` T-SQL).
 * Pure TypeScript, zero Node imports.
 */

import {
  equalSqlIdentifiers,
  formatPaginationClause,
  formatParameterPlaceholder,
  formatSqlLiteral,
  qualifyTableName,
  quoteIdentifier,
} from './sql-dialects';
import type {
  SqlCanonicalType,
  SqlCellValue,
  SqlDesignDocument,
  SqlDialect,
  SqlNamedQueryDef,
  SqlOperationAggregateSpec,
  SqlOperationFilterSpec,
  SqlOperationGraphDraft,
  SqlOperationJoinSpec,
  SqlOperationOrderSpec,
  SqlTableDef,
} from './sql-ir';

export type VisualQueryStageId =
  | 'source'
  | 'join'
  | 'filter'
  | 'group_aggregate'
  | 'order'
  | 'limit'
  | 'terminal';

export interface VisualQueryStageCard {
  id: VisualQueryStageId;
  title: string;
  subtitle: string;
  badge: string;
  active: boolean;
  x: number;
  y: number;
}

export interface CompiledOperationGraphResult {
  sql: string;
  previewSqlWithSamples: string;
  parameters: Array<{
    name: string;
    placeholder: string;
    type: SqlCanonicalType;
    required: boolean;
    sampleValue: SqlCellValue;
  }>;
  lessonIt: string;
}

export function createDefaultOperationGraph(table?: SqlTableDef): SqlOperationGraphDraft {
  return {
    kind: 'select',
    sourceTable: table?.name ?? 'customers',
    selectedColumns: table ? table.columns.map((c) => c.name) : [],
    distinct: false,
    joins: [],
    filters: [],
    filterCombinator: 'AND',
    groupBy: [],
    aggregates: [],
    orderBy: table?.columns[0] ? [{ column: table.columns[0].name, direction: 'DESC' }] : [],
    limit: 100,
    offset: 0,
    writeValues: [],
  };
}

export function buildVisualQueryStageCards(graph: SqlOperationGraphDraft): VisualQueryStageCard[] {
  const isRead = graph.kind === 'select';
  const cards: VisualQueryStageCard[] = [
    {
      id: 'source',
      title: '1. Sorgente',
      subtitle: graph.sourceTable
        ? `${graph.sourceTable}${graph.sourceAlias ? ` AS ${graph.sourceAlias}` : ''}`
        : 'Scegli tabella',
      badge: 'FROM',
      active: Boolean(graph.sourceTable),
      x: 24,
      y: 36,
    },
  ];

  if (isRead) {
    cards.push(
      {
        id: 'join',
        title: '2. Relazioni JOIN',
        subtitle:
          graph.joins.length > 0
            ? `${graph.joins.length} JOIN (${graph.joins.map((j) => j.table).join(', ')})`
            : 'Nessun JOIN attivo',
        badge: 'JOIN',
        active: graph.joins.length > 0,
        x: 234,
        y: 36,
      },
      {
        id: 'filter',
        title: '3. Filtro Righe',
        subtitle:
          graph.filters.length > 0
            ? `${graph.filters.length} condizioni (${graph.filterCombinator ?? 'AND'})`
            : 'Tutte le righe',
        badge: 'WHERE',
        active: graph.filters.length > 0,
        x: 444,
        y: 36,
      },
      {
        id: 'group_aggregate',
        title: '4. Gruppi & Calcoli',
        subtitle:
          graph.aggregates.length > 0 || graph.groupBy.length > 0
            ? `${graph.groupBy.length} gruppi · ${graph.aggregates.length} funzioni`
            : `${graph.selectedColumns.length || '*'} colonne`,
        badge: graph.aggregates.length > 0 ? 'GROUP BY' : 'SELECT',
        active: graph.aggregates.length > 0 || graph.groupBy.length > 0 || graph.selectedColumns.length > 0,
        x: 654,
        y: 36,
      },
      {
        id: 'order',
        title: '5. Ordinamento',
        subtitle:
          graph.orderBy.length > 0
            ? graph.orderBy.map((o) => `${o.column} ${o.direction}`).join(', ')
            : 'Ordine naturale',
        badge: 'ORDER BY',
        active: graph.orderBy.length > 0,
        x: 864,
        y: 36,
      },
      {
        id: 'limit',
        title: '6. Paginazione',
        subtitle: graph.limit ? `LIMIT ${graph.limit}${graph.offset ? ` OFFSET ${graph.offset}` : ''}` : 'Senza limite',
        badge: 'LIMIT',
        active: graph.limit !== undefined,
        x: 1074,
        y: 36,
      },
      {
        id: 'terminal',
        title: '7. Uscita Lettura',
        subtitle: 'ResultSet tipizzato',
        badge: 'READ',
        active: true,
        x: 1284,
        y: 36,
      },
    );
  } else {
    cards.push(
      {
        id: 'group_aggregate',
        title: '2. Valori Campi',
        subtitle:
          graph.kind === 'delete'
            ? 'Nessun valore richiesto'
            : `${graph.writeValues?.length ?? 0} colonne assegnate`,
        badge: graph.kind === 'insert' ? 'VALUES' : 'SET',
        active: (graph.writeValues?.length ?? 0) > 0,
        x: 264,
        y: 36,
      },
      {
        id: 'filter',
        title: '3. Filtro Sicurezza',
        subtitle:
          graph.kind === 'insert'
            ? 'Non applicabile su INSERT'
            : `${graph.filters.length} condizioni WHERE`,
        badge: 'WHERE',
        active: graph.filters.length > 0,
        x: 504,
        y: 36,
      },
      {
        id: 'terminal',
        title: `4. Scrittura (${graph.kind.toUpperCase()})`,
        subtitle: 'Mutazione parametrizzata',
        badge: 'WRITE',
        active: true,
        x: 744,
        y: 36,
      },
    );
  }

  return cards;
}

function formatQualifiedColumnRef(rawCol: string, dialect: SqlDialect, defaultAlias?: string): string {
  const trimmed = rawCol.trim();
  if (trimmed === '*') return '*';
  if (trimmed.includes('.')) {
    const [prefix, col] = trimmed.split('.', 2);
    return `${quoteIdentifier(prefix.trim(), dialect)}.${col.trim() === '*' ? '*' : quoteIdentifier(col.trim(), dialect)}`;
  }
  if (defaultAlias) {
    return `${quoteIdentifier(defaultAlias, dialect)}.${quoteIdentifier(trimmed, dialect)}`;
  }
  return quoteIdentifier(trimmed, dialect);
}

function coerceSampleCellValue(raw: string | undefined, canonicalType: SqlCanonicalType): SqlCellValue {
  if (raw === undefined) {
    switch (canonicalType) {
      case 'integer':
      case 'bigint':
        return 1;
      case 'decimal':
      case 'float':
        return 10.5;
      case 'boolean':
        return true;
      default:
        return 'esempio';
    }
  }
  const trimmed = raw.trim();
  if (trimmed.toUpperCase() === 'NULL') return null;
  if (canonicalType === 'integer' || canonicalType === 'bigint') {
    const n = Number(trimmed);
    return Number.isSafeInteger(n) ? n : trimmed;
  }
  if (canonicalType === 'float' || canonicalType === 'decimal') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (canonicalType === 'boolean') {
    return trimmed.toLowerCase() === 'true' || trimmed === '1';
  }
  return trimmed.replace(/^'(.*)'$/, '$1');
}

export function compileOperationGraphToSql(
  graph: SqlOperationGraphDraft,
  schema?: SqlDesignDocument | null,
  explicitDialect?: SqlDialect,
): CompiledOperationGraphResult {
  const dialect: SqlDialect = explicitDialect ?? schema?.dialect ?? 'sqlite';
  const q = (id: string) => quoteIdentifier(id, dialect);

  if (!graph.sourceTable?.trim()) {
    throw new Error('Scegli una tabella sorgente nel grafo operazioni.');
  }

  const tableDef = schema?.tables.find((t) =>
    equalSqlIdentifiers(dialect, t.name, graph.sourceTable),
  );
  const qualifiedSource = qualifyTableName(dialect, graph.sourceTable, tableDef?.schema);

  const parameters: CompiledOperationGraphResult['parameters'] = [];
  const registerParam = (
    preferredName: string | undefined,
    colRef: string,
    rawSample?: string,
  ): { placeholder: string; literalPreview: string } => {
    const cleanCol = colRef.includes('.') ? colRef.split('.').pop()! : colRef;
    const colMeta = tableDef?.columns.find((c) => equalSqlIdentifiers(dialect, c.name, cleanCol));
    const cType: SqlCanonicalType = colMeta?.canonicalType ?? 'varchar';
    const idx = parameters.length + 1;
    const cleanParamName =
      (preferredName?.trim().replace(/^[:@$]/, '').replace(/[^a-zA-Z0-9_]/g, '') ||
        `${cleanCol}_${idx}`);
    const placeholder = formatParameterPlaceholder(dialect, idx, cleanParamName);
    const sampleValue = coerceSampleCellValue(rawSample, cType);
    parameters.push({
      name: cleanParamName,
      placeholder,
      type: cType,
      required: true,
      sampleValue,
    });
    return {
      placeholder,
      literalPreview: formatSqlLiteral(sampleValue, dialect, cType),
    };
  };

  const hasJoins = graph.kind === 'select' && graph.joins.length > 0;
  const srcAlias = graph.sourceAlias?.trim() || (hasJoins ? 't' : undefined);

  const compileFilters = (): { sqlWhere: string; previewWhere: string } => {
    if (!graph.filters || graph.filters.length === 0) {
      return { sqlWhere: '', previewWhere: '' };
    }
    const comb = graph.filterCombinator === 'OR' ? ' OR ' : ' AND ';
    const sqlParts: string[] = [];
    const prevParts: string[] = [];

    for (const f of graph.filters) {
      if (!f.column?.trim()) continue;
      const colExpr = formatQualifiedColumnRef(f.column, dialect, hasJoins ? srcAlias : undefined);

      if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') {
        sqlParts.push(`${colExpr} ${f.operator}`);
        prevParts.push(`${colExpr} ${f.operator}`);
        continue;
      }

      if (f.operator === 'ILIKE' && dialect !== 'postgresql') {
        const bound = registerParam(f.parameterName, f.column, f.value ?? '%test%');
        sqlParts.push(`LOWER(${colExpr}) LIKE LOWER(${bound.placeholder})`);
        prevParts.push(`LOWER(${colExpr}) LIKE LOWER(${bound.literalPreview})`);
        continue;
      }

      if (f.operator === 'IN') {
        const items = (f.value ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const listItems = items.length > 0 ? items : ['val1'];
        const phs: string[] = [];
        const lits: string[] = [];
        for (const item of listItems) {
          const bound = registerParam(undefined, f.column, item);
          phs.push(bound.placeholder);
          lits.push(bound.literalPreview);
        }
        sqlParts.push(`${colExpr} IN (${phs.join(', ')})`);
        prevParts.push(`${colExpr} IN (${lits.join(', ')})`);
        continue;
      }

      const bound = registerParam(f.parameterName, f.column, f.value);
      sqlParts.push(`${colExpr} ${f.operator} ${bound.placeholder}`);
      prevParts.push(`${colExpr} ${f.operator} ${bound.literalPreview}`);
    }

    if (sqlParts.length === 0) return { sqlWhere: '', previewWhere: '' };
    return {
      sqlWhere: `\nWHERE ${sqlParts.join(comb)}`,
      previewWhere: `\nWHERE ${prevParts.join(comb)}`,
    };
  };

  if (graph.kind === 'insert') {
    const writes =
      graph.writeValues && graph.writeValues.length > 0
        ? graph.writeValues.filter((w) => w.column.trim())
        : (tableDef?.columns ?? [])
            .filter((c) => !c.autoIncrement)
            .map((c) => ({ column: c.name, valueExpr: '', isParam: true }));

    if (writes.length === 0) {
      const sql = `INSERT INTO ${qualifiedSource} DEFAULT VALUES;`;
      return {
        sql,
        previewSqlWithSamples: sql,
        parameters: [],
        lessonIt: 'Inserimento con i valori predefiniti definiti nello schema della tabella.',
      };
    }

    const colSql = writes.map((w) => q(w.column.trim())).join(', ');
    const valSqlParts: string[] = [];
    const valPrevParts: string[] = [];

    for (const w of writes) {
      if (w.isParam !== false) {
        const bound = registerParam(w.column, w.column, w.valueExpr || undefined);
        valSqlParts.push(bound.placeholder);
        valPrevParts.push(bound.literalPreview);
      } else {
        const expr = w.valueExpr?.trim() || 'NULL';
        valSqlParts.push(expr);
        valPrevParts.push(expr);
      }
    }

    return {
      sql: `INSERT INTO ${qualifiedSource} (${colSql})\nVALUES (${valSqlParts.join(', ')});`,
      previewSqlWithSamples: `INSERT INTO ${qualifiedSource} (${colSql})\nVALUES (${valPrevParts.join(', ')});`,
      parameters,
      lessonIt:
        'INSERT elenca esplicitamente le colonne e invia i valori tramite parametri preparati, prevenendo SQL injection.',
    };
  }

  if (graph.kind === 'update') {
    const writes = (graph.writeValues ?? []).filter((w) => w.column.trim());
    if (writes.length === 0) {
      throw new Error('Aggiungi almeno un campo da aggiornare (SET) per generare una query UPDATE.');
    }
    if (!graph.filters || graph.filters.length === 0) {
      throw new Error('Per sicurezza, una query UPDATE visuale richiede almeno un filtro WHERE.');
    }

    const setSql: string[] = [];
    const setPrev: string[] = [];
    for (const w of writes) {
      if (w.isParam !== false) {
        const bound = registerParam(w.column, w.column, w.valueExpr || undefined);
        setSql.push(`${q(w.column.trim())} = ${bound.placeholder}`);
        setPrev.push(`${q(w.column.trim())} = ${bound.literalPreview}`);
      } else {
        const expr = w.valueExpr?.trim() || 'NULL';
        setSql.push(`${q(w.column.trim())} = ${expr}`);
        setPrev.push(`${q(w.column.trim())} = ${expr}`);
      }
    }

    const { sqlWhere, previewWhere } = compileFilters();
    return {
      sql: `UPDATE ${qualifiedSource}\nSET ${setSql.join(', ')}${sqlWhere};`,
      previewSqlWithSamples: `UPDATE ${qualifiedSource}\nSET ${setPrev.join(', ')}${previewWhere};`,
      parameters,
      lessonIt:
        'UPDATE modifica esclusivamente i record individuati dal filtro WHERE usando parametri tipizzati.',
    };
  }

  if (graph.kind === 'delete') {
    if (!graph.filters || graph.filters.length === 0) {
      throw new Error('Per sicurezza, una query DELETE visuale richiede almeno un filtro WHERE.');
    }
    const { sqlWhere, previewWhere } = compileFilters();
    return {
      sql: `DELETE FROM ${qualifiedSource}${sqlWhere};`,
      previewSqlWithSamples: `DELETE FROM ${qualifiedSource}${previewWhere};`,
      parameters,
      lessonIt:
        'DELETE elimina le righe corrispondenti al filtro WHERE. Verifica sempre prima con una SELECT equivalente.',
    };
  }

  // SELECT pipeline: Source -> Join -> Filter -> Group/Aggregate -> Order -> Limit -> Read
  const projectionParts: string[] = [];

  if (graph.aggregates.length > 0) {
    for (const gCol of graph.groupBy) {
      projectionParts.push(formatQualifiedColumnRef(gCol, dialect, hasJoins ? srcAlias : undefined));
    }
    for (const agg of graph.aggregates) {
      const colTarget =
        agg.column.trim() === '*'
          ? '*'
          : formatQualifiedColumnRef(agg.column, dialect, hasJoins ? srcAlias : undefined);
      const aliasName = agg.alias?.trim() || `${agg.fn.toLowerCase()}_${agg.column.replace(/\W+/g, '') || 'rows'}`;
      projectionParts.push(`${agg.fn}(${colTarget}) AS ${q(aliasName)}`);
    }
  } else if (graph.selectedColumns.length > 0) {
    for (const col of graph.selectedColumns) {
      projectionParts.push(formatQualifiedColumnRef(col, dialect, hasJoins ? srcAlias : undefined));
    }
  } else {
    projectionParts.push(hasJoins && srcAlias ? `${q(srcAlias)}.*` : '*');
  }

  const distinctKw = graph.distinct ? 'DISTINCT ' : '';
  const hasOrderBy = graph.orderBy.length > 0;
  const pagination = formatPaginationClause(dialect, graph.limit, graph.offset, hasOrderBy);

  let fromClause = srcAlias ? `${qualifiedSource} AS ${q(srcAlias)}` : qualifiedSource;

  for (let idx = 0; idx < graph.joins.length; idx++) {
    const j = graph.joins[idx];
    if (!j.table.trim() || !j.leftColumn.trim() || !j.rightColumn.trim()) continue;
    const joinTableDef = schema?.tables.find((t) => equalSqlIdentifiers(dialect, t.name, j.table));
    const qualifiedJoin = qualifyTableName(dialect, j.table, joinTableDef?.schema);
    const jAlias = j.alias?.trim() || `j${idx + 1}`;
    const leftRef = formatQualifiedColumnRef(j.leftColumn, dialect, srcAlias);
    const rightRef = j.rightColumn.includes('.')
      ? formatQualifiedColumnRef(j.rightColumn, dialect)
      : `${q(jAlias)}.${q(j.rightColumn.trim())}`;
    fromClause += `\n${j.joinType} JOIN ${qualifiedJoin} AS ${q(jAlias)} ON ${leftRef} = ${rightRef}`;
  }

  const { sqlWhere, previewWhere } = compileFilters();

  const groupClause =
    graph.groupBy.length > 0
      ? `\nGROUP BY ${graph.groupBy
          .map((g) => formatQualifiedColumnRef(g, dialect, hasJoins ? srcAlias : undefined))
          .join(', ')}`
      : '';

  const orderClause = hasOrderBy
    ? `\nORDER BY ${graph.orderBy
        .map((o) => {
          const isAggAlias = graph.aggregates.some((a) => a.alias === o.column);
          const colRef = isAggAlias
            ? q(o.column)
            : formatQualifiedColumnRef(o.column, dialect, hasJoins ? srcAlias : undefined);
          return `${colRef} ${o.direction}`;
        })
        .join(', ')}`
    : '';

  const buildFullSelect = (wherePart: string) =>
    `SELECT ${distinctKw}${pagination.selectPrefix}${projectionParts.join(', ')}\nFROM ${fromClause}${wherePart}${groupClause}${orderClause}${pagination.tailClause};`;

  const lessonIt = hasJoins
    ? 'JOIN collega le tabelle tramite chiavi relazionali qualificando gli alias ed evitando ambiguità tra colonne omonime.'
    : graph.aggregates.length > 0
      ? 'GROUP BY raggruppa le righe e calcola funzioni aggregate (COUNT, SUM, AVG, MIN, MAX) per ciascun gruppo.'
      : 'SELECT legge soltanto le colonne richieste con filtri parametrizzati e paginazione nativa del dialetto attivo.';

  return {
    sql: buildFullSelect(sqlWhere),
    previewSqlWithSamples: buildFullSelect(previewWhere),
    parameters,
    lessonIt,
  };
}

export function buildNamedQueryFromOperationGraph(
  name: string,
  graph: SqlOperationGraphDraft,
  schema: SqlDesignDocument,
  description?: string,
): SqlNamedQueryDef {
  const compiled = compileOperationGraphToSql(graph, schema, schema.dialect);
  const dialects: SqlDialect[] = ['sqlite', 'postgresql', 'mysql', 'mariadb', 'sqlserver'];
  const sqlByDialect: Partial<Record<SqlDialect, string>> = {};
  for (const d of dialects) {
    try {
      sqlByDialect[d] = compileOperationGraphToSql(graph, schema, d).sql;
    } catch {
      // skip if dialect-specific constraint fails
    }
  }

  return {
    id: `qry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().replace(/[^a-zA-Z0-9_]/g, '') || 'customQuery',
    description: description ?? compiled.lessonIt,
    kind: graph.kind,
    targetTable: graph.sourceTable,
    canonicalSql: compiled.sql,
    sql: compiled.sql,
    sqlByDialect,
    operationGraph: structuredClone(graph),
    parameters: compiled.parameters.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required,
      sampleValue: p.sampleValue,
    })),
  };
}

// ============================================================================
// REVERSE SQL -> VISUAL OPERATION GRAPH PARSER (`parseSqlToOperationGraph`)
// ============================================================================

function unquoteSqlIdent(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1).replace(/""|``/g, (m) => m[0]);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).replace(/\]\]/g, ']');
  }
  return trimmed;
}

function cleanTableToken(raw: string): string {
  const parts = raw
    .trim()
    .split('.')
    .map((p) => unquoteSqlIdent(p));
  return parts[parts.length - 1] || '';
}

function splitTopLevelCommas(expr: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inSingle = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'" && expr[i - 1] !== '\\') {
      inSingle = !inSingle;
      cur += ch;
      continue;
    }
    if (!inSingle) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseWhereConditions(whereBody: string): {
  combinator: 'AND' | 'OR';
  filters: SqlOperationFilterSpec[];
} {
  const hasOr = /\s+OR\s+/i.test(whereBody) && !/\s+AND\s+/i.test(whereBody);
  const combinator: 'AND' | 'OR' = hasOr ? 'OR' : 'AND';
  const rawParts = whereBody.split(hasOr ? /\s+OR\s+/i : /\s+AND\s+/i);
  const filters: SqlOperationFilterSpec[] = [];

  rawParts.forEach((raw, idx) => {
    const cond = raw.trim();
    if (!cond) return;

    const nullMatch = cond.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
    if (nullMatch) {
      const col = unquoteSqlIdent(nullMatch[1].replace(/^[a-zA-Z0-9_"`[\]]+\./, ''));
      filters.push({
        id: `flt_${idx + 1}`,
        column: col,
        operator: nullMatch[2] ? 'IS NOT NULL' : 'IS NULL',
      });
      return;
    }

    const inMatch = cond.match(/^(.+?)\s+IN\s*\((.+)\)$/i);
    if (inMatch) {
      const col = unquoteSqlIdent(inMatch[1].replace(/^[a-zA-Z0-9_"`[\]]+\./, ''));
      const vals = splitTopLevelCommas(inMatch[2])
        .map((v) => v.replace(/^N?'|'?$/g, ''))
        .join(', ');
      filters.push({
        id: `flt_${idx + 1}`,
        column: col,
        operator: 'IN',
        value: vals,
      });
      return;
    }

    const opMatch = cond.match(/^(.+?)\s*(!=|<>|>=|<=|=|>|<|\bILIKE\b|\bLIKE\b)\s*(.+)$/i);
    if (opMatch) {
      const col = unquoteSqlIdent(opMatch[1].replace(/^[a-zA-Z0-9_"`[\]]+\./, ''));
      const rawOp = opMatch[2].toUpperCase();
      const operator = (rawOp === '<>' ? '!=' : rawOp) as SqlOperationFilterSpec['operator'];
      const rhs = opMatch[3].trim();
      const isPlaceholder = /^(\$\d+|[:@][a-zA-Z_]\w*|\?)$/.test(rhs);
      filters.push({
        id: `flt_${idx + 1}`,
        column: col,
        operator,
        value: isPlaceholder ? undefined : rhs.replace(/^N?'(.*)'$/, '$1'),
        parameterName: isPlaceholder && rhs !== '?' ? rhs.slice(1) : undefined,
      });
    }
  });

  return { combinator, filters };
}

export function parseSqlToOperationGraph(
  sqlText: string,
  _schema?: SqlDesignDocument | null,
  _dialect?: SqlDialect,
): { graph: SqlOperationGraphDraft | null; error?: string } {
  const cleaned = sqlText
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .replace(/;\s*$/, '')
    .trim();

  if (!cleaned) {
    return { graph: null, error: 'Inserisci un\'istruzione SQL da convertire nel grafo visuale.' };
  }

  // 1. INSERT INTO <table> (<cols>) VALUES (<vals>)
  const insertMatch = cleaned.match(
    /^INSERT\s+INTO\s+([^\s(]+)\s*(?:\(([^)]*)\)\s*VALUES\s*\(([\s\S]+)\)|DEFAULT\s+VALUES)$/i,
  );
  if (insertMatch) {
    const sourceTable = cleanTableToken(insertMatch[1]);
    const cols = insertMatch[2] ? splitTopLevelCommas(insertMatch[2]).map(unquoteSqlIdent) : [];
    const vals = insertMatch[3] ? splitTopLevelCommas(insertMatch[3]) : [];
    const writeValues = cols.map((col, idx) => {
      const rawVal = vals[idx] ?? '';
      const isParam = /^(\$\d+|[:@][a-zA-Z_]\w*|\?)$/.test(rawVal);
      return {
        column: col,
        valueExpr: isParam ? '' : rawVal.replace(/^N?'(.*)'$/, '$1'),
        isParam: true,
      };
    });
    return {
      graph: {
        kind: 'insert',
        sourceTable,
        selectedColumns: [],
        joins: [],
        filters: [],
        groupBy: [],
        aggregates: [],
        orderBy: [],
        writeValues,
      },
    };
  }

  // 2. UPDATE <table> SET <assignments> [WHERE <conds>]
  const updateMatch = cleaned.match(
    /^UPDATE\s+([^\s]+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i,
  );
  if (updateMatch) {
    const sourceTable = cleanTableToken(updateMatch[1]);
    const assignments = splitTopLevelCommas(updateMatch[2]);
    const writeValues = assignments.map((item) => {
      const eqIdx = item.indexOf('=');
      const col = unquoteSqlIdent(item.slice(0, eqIdx));
      const rhs = item.slice(eqIdx + 1).trim();
      const isParam = /^(\$\d+|[:@][a-zA-Z_]\w*|\?)$/.test(rhs);
      return {
        column: col,
        valueExpr: isParam ? '' : rhs.replace(/^N?'(.*)'$/, '$1'),
        isParam: true,
      };
    });
    const parsedWhere = updateMatch[3]
      ? parseWhereConditions(updateMatch[3])
      : { combinator: 'AND' as const, filters: [] };
    return {
      graph: {
        kind: 'update',
        sourceTable,
        selectedColumns: [],
        joins: [],
        filters: parsedWhere.filters,
        filterCombinator: parsedWhere.combinator,
        groupBy: [],
        aggregates: [],
        orderBy: [],
        writeValues,
      },
    };
  }

  // 3. DELETE FROM <table> [WHERE <conds>]
  const deleteMatch = cleaned.match(/^DELETE\s+FROM\s+([^\s]+)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (deleteMatch) {
    const sourceTable = cleanTableToken(deleteMatch[1]);
    const parsedWhere = deleteMatch[2]
      ? parseWhereConditions(deleteMatch[2])
      : { combinator: 'AND' as const, filters: [] };
    return {
      graph: {
        kind: 'delete',
        sourceTable,
        selectedColumns: [],
        joins: [],
        filters: parsedWhere.filters,
        filterCombinator: parsedWhere.combinator,
        groupBy: [],
        aggregates: [],
        orderBy: [],
      },
    };
  }

  // 4. SELECT [DISTINCT] [TOP (N)] <projection> FROM <table> ...
  if (!/^SELECT\b/i.test(cleaned)) {
    return {
      graph: null,
      error: 'Il grafo visuale supporta istruzioni SELECT, INSERT, UPDATE e DELETE.',
    };
  }

  let rest = cleaned.replace(/^SELECT\s+/i, '');
  let distinct = false;
  if (/^DISTINCT\s+/i.test(rest)) {
    distinct = true;
    rest = rest.replace(/^DISTINCT\s+/i, '');
  }

  let limit: number | undefined;
  let offset: number | undefined;
  const topMatch = rest.match(/^TOP\s*\(?\s*(\d+)\s*\)?\s+/i);
  if (topMatch) {
    limit = Number(topMatch[1]);
    rest = rest.slice(topMatch[0].length);
  }

  // Split projection vs FROM at top-level depth 0
  let fromPos = -1;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '(') depth++;
    else if (rest[i] === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^\s+FROM\s+/i.test(rest.slice(i))) {
      fromPos = i;
      break;
    }
  }
  if (fromPos < 0) {
    return { graph: null, error: 'Clausola FROM mancante nella query SELECT.' };
  }

  const projectionRaw = rest.slice(0, fromPos).trim();
  let afterFrom = rest.slice(fromPos).replace(/^\s+FROM\s+/i, '').trim();

  // Extract T-SQL OFFSET ... FETCH NEXT or standard LIMIT / OFFSET at the end
  const tsqlPageMatch = afterFrom.match(
    /\s+OFFSET\s+(\d+)\s+ROWS(?:\s+FETCH\s+(?:NEXT|FIRST)\s+(\d+)\s+ROWS\s+ONLY)?\s*$/i,
  );
  if (tsqlPageMatch) {
    offset = Number(tsqlPageMatch[1]);
    if (tsqlPageMatch[2]) limit = Number(tsqlPageMatch[2]);
    afterFrom = afterFrom.slice(0, tsqlPageMatch.index).trim();
  }

  const limitOffsetMatch = afterFrom.match(/\s+LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?\s*$/i);
  if (limitOffsetMatch) {
    limit = Number(limitOffsetMatch[1]);
    if (limitOffsetMatch[2]) offset = Number(limitOffsetMatch[2]);
    afterFrom = afterFrom.slice(0, limitOffsetMatch.index).trim();
  }

  // Extract ORDER BY
  const orderBy: SqlOperationOrderSpec[] = [];
  const orderMatch = afterFrom.match(/\s+ORDER\s+BY\s+([\s\S]+)$/i);
  if (orderMatch) {
    const orderBody = orderMatch[1].trim();
    if (!/^\(\s*SELECT\s+NULL\s*\)$/i.test(orderBody)) {
      for (const part of splitTopLevelCommas(orderBody)) {
        const m = part.trim().match(/^(.+?)(?:\s+(ASC|DESC))?$/i);
        if (m) {
          const rawCol = m[1].replace(/^[a-zA-Z0-9_"`[\]]+\./, '');
          orderBy.push({
            column: unquoteSqlIdent(rawCol),
            direction: m[2]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
          });
        }
      }
    }
    afterFrom = afterFrom.slice(0, orderMatch.index).trim();
  }

  // Extract GROUP BY
  let groupBy: string[] = [];
  const groupMatch = afterFrom.match(/\s+GROUP\s+BY\s+([\s\S]+)$/i);
  if (groupMatch) {
    const grpBody = groupMatch[1].replace(/\s+HAVING\s+[\s\S]+$/i, '');
    groupBy = splitTopLevelCommas(grpBody).map((g) =>
      unquoteSqlIdent(g.replace(/^[a-zA-Z0-9_"`[\]]+\./, '')),
    );
    afterFrom = afterFrom.slice(0, groupMatch.index).trim();
  }

  // Extract WHERE
  let filterCombinator: 'AND' | 'OR' = 'AND';
  let filters: SqlOperationFilterSpec[] = [];
  const whereMatch = afterFrom.match(/\s+WHERE\s+([\s\S]+)$/i);
  if (whereMatch) {
    const parsed = parseWhereConditions(whereMatch[1]);
    filterCombinator = parsed.combinator;
    filters = parsed.filters;
    afterFrom = afterFrom.slice(0, whereMatch.index).trim();
  }

  // Parse source table + optional JOINs from `afterFrom`
  const joinSplitRe = /\s+(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+)?JOIN\s+/gi;
  const joinTokens: Array<{ type: SqlOperationJoinSpec['joinType']; start: number; bodyStart: number }> = [];
  let jm: RegExpExecArray | null;
  while ((jm = joinSplitRe.exec(afterFrom)) !== null) {
    joinTokens.push({
      type: ((jm[1] || 'INNER').toUpperCase() as SqlOperationJoinSpec['joinType']),
      start: jm.index,
      bodyStart: jm.index + jm[0].length,
    });
  }

  const fromSegment = (joinTokens.length > 0 ? afterFrom.slice(0, joinTokens[0].start) : afterFrom).trim();
  const fromParts = fromSegment.split(/\s+(?:AS\s+)?/i);
  const sourceTable = cleanTableToken(fromParts[0]);
  const sourceAlias = fromParts[1] ? unquoteSqlIdent(fromParts[1]) : undefined;

  const joins: SqlOperationJoinSpec[] = [];
  joinTokens.forEach((jt, idx) => {
    const end = joinTokens[idx + 1]?.start ?? afterFrom.length;
    const seg = afterFrom.slice(jt.bodyStart, end).trim();
    const onMatch = seg.match(/^([^\s]+)(?:\s+(?:AS\s+)?([^\s]+))?\s+ON\s+(.+?)\s*=\s*(.+)$/i);
    if (onMatch) {
      const joinTable = cleanTableToken(onMatch[1]);
      const alias = onMatch[2] ? unquoteSqlIdent(onMatch[2]) : undefined;
      const lhs = unquoteSqlIdent(onMatch[3].trim().replace(/^[a-zA-Z0-9_"`[\]]+\./, ''));
      const rhs = unquoteSqlIdent(onMatch[4].trim().replace(/^[a-zA-Z0-9_"`[\]]+\./, ''));
      joins.push({
        id: `join_${idx + 1}`,
        joinType: jt.type,
        table: joinTable,
        alias,
        leftColumn: lhs,
        rightColumn: rhs,
      });
    }
  });

  // Parse projection columns & aggregates
  const selectedColumns: string[] = [];
  const aggregates: SqlOperationAggregateSpec[] = [];

  for (const item of splitTopLevelCommas(projectionRaw)) {
    const aggMatch = item.match(
      /^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*([^)]+)\s*\)(?:\s+AS\s+(.+))?$/i,
    );
    if (aggMatch) {
      const fn = aggMatch[1].toUpperCase() as SqlOperationAggregateSpec['fn'];
      const rawArg = aggMatch[2].trim();
      const col = rawArg === '*' ? '*' : unquoteSqlIdent(rawArg.replace(/^[a-zA-Z0-9_"`[\]]+\./, ''));
      const alias = aggMatch[3] ? unquoteSqlIdent(aggMatch[3]) : `${fn.toLowerCase()}_${col === '*' ? 'all' : col}`;
      aggregates.push({
        id: `agg_${aggregates.length + 1}`,
        fn,
        column: col,
        alias,
      });
    } else if (item !== '*' && !/\.\*$/.test(item)) {
      const withoutAs = item.split(/\s+AS\s+/i)[0].trim();
      const cleanCol = unquoteSqlIdent(withoutAs.replace(/^[a-zA-Z0-9_"`[\]]+\./, ''));
      if (cleanCol && !groupBy.includes(cleanCol)) {
        selectedColumns.push(cleanCol);
      }
    }
  }

  return {
    graph: {
      kind: 'select',
      sourceTable,
      sourceAlias,
      selectedColumns,
      distinct,
      joins,
      filters,
      filterCombinator,
      groupBy,
      aggregates,
      orderBy,
      limit,
      offset,
    },
  };
}
