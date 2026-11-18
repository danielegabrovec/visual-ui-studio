/**
 * Multi-Dialect SQL Compiler, Identifier Quoter, Type Mapper, FK Topological Sorter,
 * and Parameterized DDL/DML Emitter across all 5 relational SQL engines:
 *   - `sqlite` (SQLite 3 / `node:sqlite`)
 *   - `postgresql` (PostgreSQL 17)
 *   - `mysql` (MySQL 8 / 9)
 *   - `mariadb` (MariaDB 11)
 *   - `sqlserver` (SQL Server T-SQL)
 *
 * Ported & adapted from `Database Manager/src/designer/schemaProject.ts` + `readOperation.ts`.
 * Pure TypeScript, zero Node imports.
 */

import type {
  SqlCanonicalType,
  SqlCellValue,
  SqlColumnDef,
  SqlDataChange,
  SqlDataRow,
  SqlDesignDocument,
  SqlDialect,
  SqlForeignKeyDef,
  SqlIndexDef,
  SqlTableDef,
} from './sql-ir';

export const DIALECT_TYPE_CHOICES: Record<SqlDialect, string[]> = {
  sqlite: [
    'INTEGER',
    'TEXT',
    'REAL',
    'NUMERIC',
    'BLOB',
    'BOOLEAN',
    'DATE',
    'DATETIME',
    'JSON',
  ],
  postgresql: [
    'INTEGER',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'NUMERIC(12,2)',
    'DOUBLE PRECISION',
    'BOOLEAN',
    'UUID',
    'DATE',
    'TIMESTAMPTZ',
    'JSONB',
    'BYTEA',
  ],
  mysql: [
    'INT',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'DECIMAL(12,2)',
    'DOUBLE',
    'TINYINT(1)',
    'CHAR(36)',
    'DATE',
    'DATETIME',
    'JSON',
    'LONGBLOB',
  ],
  mariadb: [
    'INT',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'DECIMAL(12,2)',
    'DOUBLE',
    'BOOLEAN',
    'UUID',
    'DATE',
    'DATETIME',
    'JSON',
    'LONGBLOB',
  ],
  sqlserver: [
    'INT',
    'BIGINT',
    'NVARCHAR(255)',
    'NVARCHAR(MAX)',
    'DECIMAL(12,2)',
    'FLOAT',
    'BIT',
    'UNIQUEIDENTIFIER',
    'DATE',
    'DATETIME2',
    'VARBINARY(MAX)',
  ],
};

export function defaultSchemaForDialect(dialect: SqlDialect): string | undefined {
  if (dialect === 'postgresql') return 'public';
  if (dialect === 'sqlserver') return 'dbo';
  return undefined;
}

export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  const clean = name.trim();
  if (!clean) {
    throw new Error('Identificatore SQL vuoto non valido.');
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    return '`' + clean.replace(/`/g, '``') + '`';
  }
  if (dialect === 'sqlserver') {
    return '[' + clean.replace(/\]/g, ']]') + ']';
  }
  return '"' + clean.replace(/"/g, '""') + '"';
}

export function identifierKey(dialect: SqlDialect, name: string): string {
  if (
    dialect === 'sqlite' ||
    dialect === 'mysql' ||
    dialect === 'mariadb' ||
    dialect === 'sqlserver'
  ) {
    return name.trim().toLowerCase();
  }
  return name.trim();
}

export function equalSqlIdentifiers(dialect: SqlDialect, a: string, b: string): boolean {
  return identifierKey(dialect, a) === identifierKey(dialect, b);
}

export function resolveEffectiveSchema(dialect: SqlDialect, rawSchema?: string): string | undefined {
  if (dialect === 'sqlite' || dialect === 'mysql' || dialect === 'mariadb') {
    return undefined;
  }
  const trimmed = rawSchema?.trim();
  if (dialect === 'postgresql') {
    if (!trimmed || trimmed.toLowerCase() === 'dbo' || trimmed.toLowerCase() === 'main') {
      return 'public';
    }
    return trimmed;
  }
  if (dialect === 'sqlserver') {
    if (!trimmed || trimmed.toLowerCase() === 'public' || trimmed.toLowerCase() === 'main') {
      return 'dbo';
    }
    return trimmed;
  }
  return trimmed;
}

export function qualifyTableName(
  dialect: SqlDialect,
  tableName: string,
  rawSchema?: string,
): string {
  const effectiveSchema = resolveEffectiveSchema(dialect, rawSchema);
  if (effectiveSchema) {
    return `${quoteIdentifier(effectiveSchema, dialect)}.${quoteIdentifier(tableName, dialect)}`;
  }
  return quoteIdentifier(tableName, dialect);
}

export function tableObjectKey(
  dialect: SqlDialect,
  table: { name: string; schema?: string },
): string {
  const schema = resolveEffectiveSchema(dialect, table.schema) ?? '';
  return `${identifierKey(dialect, schema)}.${identifierKey(dialect, table.name)}`;
}

export function formatParameterPlaceholder(
  dialect: SqlDialect,
  index1Based: number,
  paramName?: string,
): string {
  if (dialect === 'postgresql') {
    return `$${index1Based}`;
  }
  if (dialect === 'sqlserver') {
    const safe = paramName ? paramName.replace(/[^a-zA-Z0-9_]/g, '') : '';
    return `@${safe || `p${index1Based}`}`;
  }
  return '?';
}

export function formatPaginationClause(
  dialect: SqlDialect,
  limit?: number,
  offset?: number,
  hasOrderBy = false,
): { selectPrefix: string; tailClause: string } {
  if (limit === undefined && offset === undefined) {
    return { selectPrefix: '', tailClause: '' };
  }
  const safeLimit = limit !== undefined ? Math.max(0, Math.min(100_000, Math.floor(limit))) : undefined;
  const safeOffset = offset !== undefined ? Math.max(0, Math.floor(offset)) : 0;

  if (dialect === 'sqlserver') {
    if (safeOffset === 0 && !hasOrderBy && safeLimit !== undefined) {
      return { selectPrefix: `TOP (${safeLimit}) `, tailClause: '' };
    }
    const orderFallback = hasOrderBy ? '' : '\nORDER BY (SELECT NULL)';
    if (safeLimit !== undefined) {
      return {
        selectPrefix: '',
        tailClause: `${orderFallback}\nOFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`,
      };
    }
    return {
      selectPrefix: '',
      tailClause: `${orderFallback}\nOFFSET ${safeOffset} ROWS`,
    };
  }

  if (safeLimit !== undefined && safeOffset > 0) {
    return { selectPrefix: '', tailClause: `\nLIMIT ${safeLimit} OFFSET ${safeOffset}` };
  }
  if (safeLimit !== undefined) {
    return { selectPrefix: '', tailClause: `\nLIMIT ${safeLimit}` };
  }
  if (safeOffset > 0) {
    return {
      selectPrefix: '',
      tailClause: dialect === 'mysql' || dialect === 'mariadb'
        ? `\nLIMIT 18446744073709551615 OFFSET ${safeOffset}`
        : `\nOFFSET ${safeOffset}`,
    };
  }
  return { selectPrefix: '', tailClause: '' };
}

export function inferCanonicalType(nativeType: string): SqlCanonicalType {
  const upper = nativeType.trim().toUpperCase();
  if (!upper) return 'varchar';
  if (/\b(BIGINT|INT8|BIGSERIAL)\b/.test(upper)) return 'bigint';
  if (/\bTINYINT\s*\(\s*1\s*\)/.test(upper) || /\b(BOOLEAN|BOOL|BIT)\b/.test(upper)) return 'boolean';
  if (/\b(INT|INTEGER|SMALLINT|TINYINT|MEDIUMINT|SERIAL|SMALLSERIAL|INT4|INT2)\b/.test(upper)) {
    return 'integer';
  }
  if (/\b(DECIMAL|NUMERIC|MONEY|SMALLMONEY)\b/.test(upper)) return 'decimal';
  if (/\b(REAL|FLOAT|DOUBLE|FLOAT4|FLOAT8)\b/.test(upper)) return 'float';
  if (/\bCHAR\s*\(\s*36\s*\)/.test(upper) || /\b(UUID|UNIQUEIDENTIFIER|GUID)\b/.test(upper)) return 'uuid';
  if (/\b(JSON|JSONB)\b/.test(upper)) return 'json';
  if (/\b(BLOB|BYTEA|BINARY|VARBINARY|LONGBLOB|MEDIUMBLOB|IMAGE)\b/.test(upper)) return 'blob';
  if (/\b(TIMESTAMPTZ|TIMESTAMP|DATETIME2|DATETIME|SMALLDATETIME|DATETIMEOFFSET)\b/.test(upper)) {
    return 'datetime';
  }
  if (/\bDATE\b/.test(upper)) return 'date';
  if (/\b(TEXT|CLOB|LONGTEXT|MEDIUMTEXT|NTEXT)\b/.test(upper) || /NVARCHAR\s*\(\s*MAX\s*\)/.test(upper)) {
    return 'text';
  }
  return 'varchar';
}

export function parseTypeDimensions(nativeType: string): {
  length?: number;
  precision?: number;
  scale?: number;
} {
  const m = nativeType.match(/\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/);
  if (!m) return {};
  const first = Number(m[1]);
  const second = m[2] !== undefined ? Number(m[2]) : undefined;
  const canonical = inferCanonicalType(nativeType);
  if (canonical === 'decimal') {
    return { precision: first, scale: second ?? 0 };
  }
  if (canonical === 'varchar') {
    return { length: first };
  }
  return {};
}

export function mapCanonicalToNativeType(
  canonicalType: SqlCanonicalType,
  dialect: SqlDialect,
  opts?: { length?: number; precision?: number; scale?: number; autoIncrement?: boolean },
): string {
  const len = opts?.length && opts.length > 0 ? opts.length : 255;
  const prec = opts?.precision && opts.precision > 0 ? opts.precision : 12;
  const scale = opts?.scale !== undefined && opts.scale >= 0 ? opts.scale : 2;

  switch (canonicalType) {
    case 'integer':
      if (dialect === 'sqlite') return 'INTEGER';
      if (dialect === 'postgresql') return 'INTEGER';
      return 'INT';
    case 'bigint':
      if (dialect === 'sqlite' && opts?.autoIncrement) return 'INTEGER';
      return 'BIGINT';
    case 'decimal':
      if (dialect === 'postgresql') return `NUMERIC(${prec},${scale})`;
      return `DECIMAL(${prec},${scale})`;
    case 'float':
      if (dialect === 'sqlite') return 'REAL';
      if (dialect === 'postgresql') return 'DOUBLE PRECISION';
      if (dialect === 'sqlserver') return 'FLOAT';
      return 'DOUBLE';
    case 'boolean':
      if (dialect === 'sqlite') return 'INTEGER';
      if (dialect === 'postgresql' || dialect === 'mariadb') return 'BOOLEAN';
      if (dialect === 'mysql') return 'TINYINT(1)';
      return 'BIT';
    case 'varchar':
      if (dialect === 'sqlite') return `VARCHAR(${len})`;
      if (dialect === 'sqlserver') return `NVARCHAR(${len})`;
      return `VARCHAR(${len})`;
    case 'text':
      if (dialect === 'sqlserver') return 'NVARCHAR(MAX)';
      return 'TEXT';
    case 'uuid':
      if (dialect === 'postgresql' || dialect === 'mariadb') return 'UUID';
      if (dialect === 'sqlserver') return 'UNIQUEIDENTIFIER';
      if (dialect === 'mysql') return 'CHAR(36)';
      return 'TEXT';
    case 'date':
      return 'DATE';
    case 'datetime':
      if (dialect === 'postgresql') return 'TIMESTAMPTZ';
      if (dialect === 'sqlserver') return 'DATETIME2';
      return 'DATETIME';
    case 'json':
      if (dialect === 'postgresql') return 'JSONB';
      if (dialect === 'mysql' || dialect === 'mariadb') return 'JSON';
      if (dialect === 'sqlserver') return 'NVARCHAR(MAX)';
      return 'TEXT';
    case 'blob':
      if (dialect === 'postgresql') return 'BYTEA';
      if (dialect === 'mysql' || dialect === 'mariadb') return 'LONGBLOB';
      if (dialect === 'sqlserver') return 'VARBINARY(MAX)';
      return 'BLOB';
    default:
      return dialect === 'sqlserver' ? 'NVARCHAR(255)' : 'VARCHAR(255)';
  }
}

export function normalizeDefaultValueForDialect(
  defaultValue: string | undefined,
  canonicalType: SqlCanonicalType,
  dialect: SqlDialect,
): string | undefined {
  if (defaultValue === undefined || defaultValue === '') return undefined;
  const trimmed = defaultValue.trim();
  if (!trimmed) return undefined;

  if (canonicalType === 'boolean') {
    const lower = trimmed.toLowerCase();
    const isTruthy = lower === 'true' || lower === '1' || lower === '((1))';
    const isFalsy = lower === 'false' || lower === '0' || lower === '((0))';
    if (isTruthy || isFalsy) {
      if (dialect === 'postgresql') return isTruthy ? 'TRUE' : 'FALSE';
      return isTruthy ? '1' : '0';
    }
  }

  if (canonicalType === 'datetime') {
    if (/^(CURRENT_TIMESTAMP|NOW\(\)|SYSUTCDATETIME\(\)|GETDATE\(\)|GETUTCDATE\(\))$/i.test(trimmed)) {
      if (dialect === 'sqlserver') return 'SYSUTCDATETIME()';
      return 'CURRENT_TIMESTAMP';
    }
  }

  if (canonicalType === 'uuid') {
    if (/^(gen_random_uuid\(\)|NEWID\(\)|UUID\(\))$/i.test(trimmed)) {
      if (dialect === 'postgresql') return 'gen_random_uuid()';
      if (dialect === 'sqlserver') return 'NEWID()';
      if (dialect === 'mysql' || dialect === 'mariadb') return '(UUID())';
      return undefined;
    }
  }

  return trimmed;
}

export function remapTableToDialect(table: SqlTableDef, targetDialect: SqlDialect): SqlTableDef {
  const nextSchema = resolveEffectiveSchema(targetDialect, table.schema);
  return {
    ...table,
    schema: nextSchema,
    columns: table.columns.map((col) => ({
      ...col,
      nativeType: mapCanonicalToNativeType(col.canonicalType, targetDialect, {
        length: col.length,
        precision: col.precision,
        scale: col.scale,
        autoIncrement: col.autoIncrement,
      }),
      defaultValue: normalizeDefaultValueForDialect(col.defaultValue, col.canonicalType, targetDialect),
    })),
    foreignKeys: table.foreignKeys.map((fk) => ({
      ...fk,
      referencedSchema: resolveEffectiveSchema(targetDialect, fk.referencedSchema),
    })),
  };
}

export function remapDocumentToDialect(
  doc: SqlDesignDocument,
  targetDialect: SqlDialect,
): SqlDesignDocument {
  return {
    ...doc,
    dialect: targetDialect,
    tables: doc.tables.map((t) => remapTableToDialect(t, targetDialect)),
    updatedAt: Date.now(),
  };
}

export function validateIdentifierName(name: string, label = 'Identificatore'): void {
  if (!name || !name.trim() || name.length > 128 || /[\u0000-\u001f]/.test(name)) {
    throw new Error(`${label}: inserisci un nome valido (massimo 128 caratteri).`);
  }
}

export function checkForeignKeyTarget(
  dialect: SqlDialect,
  targetTable: SqlTableDef,
  referencedColumns: string[],
): void {
  if (referencedColumns.length === 0) {
    throw new Error(`La relazione verso ${targetTable.name} deve specificare almeno una colonna.`);
  }
  for (const colName of referencedColumns) {
    const found = targetTable.columns.find((c) => equalSqlIdentifiers(dialect, c.name, colName));
    if (!found) {
      throw new Error(`Campo destinazione inesistente: ${targetTable.name}.${colName}`);
    }
  }

  const pkCols = targetTable.columns.filter((c) => c.primaryKey).map((c) => c.name);
  const matchesFullPk =
    pkCols.length === referencedColumns.length &&
    referencedColumns.every((rc) => pkCols.some((pk) => equalSqlIdentifiers(dialect, pk, rc)));

  const matchesSingleUnique =
    referencedColumns.length === 1 &&
    Boolean(
      targetTable.columns.find(
        (c) => equalSqlIdentifiers(dialect, c.name, referencedColumns[0]) && c.unique,
      ),
    );

  const matchesUniqueIndex = targetTable.indexes.some(
    (idx) =>
      idx.unique &&
      !idx.whereClause &&
      idx.columns.length === referencedColumns.length &&
      referencedColumns.every((rc, pos) =>
        equalSqlIdentifiers(dialect, idx.columns[pos] ?? '', rc),
      ),
  );

  if (!matchesFullPk && !matchesSingleUnique && !matchesUniqueIndex) {
    throw new Error(
      `La relazione verso ${targetTable.name}(${referencedColumns.join(', ')}) richiede una chiave primaria o un vincolo UNIQUE completo corrispondente.`,
    );
  }
}

export function validateTableDefinition(dialect: SqlDialect, table: SqlTableDef): string[] {
  const issues: string[] = [];
  try {
    validateIdentifierName(table.name, 'Tabella');
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }

  if (table.columns.length === 0) {
    issues.push(`Tabella "${table.name}": aggiungi almeno una colonna.`);
  }

  const colNames = new Set<string>();
  const autoCols: SqlColumnDef[] = [];
  const pkCols = table.columns.filter((c) => c.primaryKey);

  for (const col of table.columns) {
    try {
      validateIdentifierName(col.name, `Colonna (${table.name})`);
    } catch (e) {
      issues.push(e instanceof Error ? e.message : String(e));
    }
    const key = identifierKey(dialect, col.name);
    if (colNames.has(key)) {
      issues.push(`Tabella "${table.name}": colonna duplicata "${col.name}".`);
    }
    colNames.add(key);

    if (col.autoIncrement) {
      autoCols.push(col);
      if (col.canonicalType !== 'integer' && col.canonicalType !== 'bigint') {
        issues.push(
          `Colonna "${table.name}.${col.name}": l'identità automatica richiede un tipo intero (integer/bigint).`,
        );
      }
      if (!col.primaryKey) {
        issues.push(
          `Colonna "${table.name}.${col.name}": l'identità automatica richiede una chiave primaria.`,
        );
      }
    }
  }

  if (autoCols.length > 1) {
    issues.push(`Tabella "${table.name}": è ammessa una sola colonna con identità automatica.`);
  }
  if (dialect === 'sqlite' && autoCols.length === 1 && pkCols.length !== 1) {
    issues.push(
      `Tabella "${table.name}": SQLite AUTOINCREMENT richiede una singola chiave primaria INTEGER.`,
    );
  }

  for (const fk of table.foreignKeys) {
    if (fk.columns.length === 0 || fk.columns.length !== fk.referencedColumns.length) {
      issues.push(`Tabella "${table.name}": chiave esterna incompleta verso "${fk.referencedTable}".`);
      continue;
    }
    for (const cName of fk.columns) {
      if (!table.columns.some((c) => equalSqlIdentifiers(dialect, c.name, cName))) {
        issues.push(`Tabella "${table.name}": colonna FK inesistente "${cName}".`);
      }
    }
  }

  for (const idx of table.indexes) {
    if (!idx.name.trim() || idx.columns.length === 0) {
      issues.push(`Tabella "${table.name}": specifica nome e colonne per ogni indice.`);
      continue;
    }
    for (const cName of idx.columns) {
      if (!table.columns.some((c) => equalSqlIdentifiers(dialect, c.name, cName))) {
        issues.push(`Indice "${idx.name}": colonna inesistente "${cName}" in "${table.name}".`);
      }
    }
  }

  return issues;
}

export function sortTablesTopologically(dialect: SqlDialect, tables: SqlTableDef[]): SqlTableDef[] {
  const pending = [...tables];
  const ordered: SqlTableDef[] = [];

  while (pending.length > 0) {
    const readyIdx = pending.findIndex((candidate) =>
      candidate.foreignKeys.every((fk) => {
        const refKey = tableObjectKey(dialect, {
          name: fk.referencedTable,
          schema: fk.referencedSchema ?? candidate.schema,
        });
        return !pending.some(
          (other) => other.id !== candidate.id && tableObjectKey(dialect, other) === refKey,
        );
      }),
    );

    if (readyIdx < 0) {
      // Cycle fallback: preserve deterministic remaining order
      ordered.push(...pending);
      break;
    }
    ordered.push(...pending.splice(readyIdx, 1));
  }

  return ordered;
}

export function compileColumnDefinitionSql(
  dialect: SqlDialect,
  col: SqlColumnDef,
  options?: { inlineSinglePk?: boolean; includeCheckInline?: boolean },
): string {
  const q = (id: string) => quoteIdentifier(id, dialect);
  const inlinePk = Boolean(options?.inlineSinglePk && col.primaryKey);
  const includeCheck = options?.includeCheckInline !== false;

  const resolvedType =
    col.nativeType?.trim() ||
    mapCanonicalToNativeType(col.canonicalType, dialect, {
      length: col.length,
      precision: col.precision,
      scale: col.scale,
      autoIncrement: col.autoIncrement,
    });

  if (dialect === 'sqlite' && col.autoIncrement && inlinePk) {
    let sql = `${q(col.name)} INTEGER PRIMARY KEY AUTOINCREMENT`;
    if (col.checkExpr && includeCheck) {
      sql += ` CHECK (${col.checkExpr})`;
    }
    return sql;
  }

  let parts: string[] = [q(col.name), resolvedType];

  if (col.autoIncrement) {
    if (dialect === 'postgresql') {
      parts.push('GENERATED BY DEFAULT AS IDENTITY');
    } else if (dialect === 'sqlserver') {
      parts.push('IDENTITY(1,1)');
    }
  }

  if (!col.nullable || col.primaryKey) {
    parts.push('NOT NULL');
  }

  if (col.autoIncrement && (dialect === 'mysql' || dialect === 'mariadb')) {
    parts.push('AUTO_INCREMENT');
  }

  if (inlinePk && dialect !== 'mysql' && dialect !== 'mariadb') {
    parts.push('PRIMARY KEY');
  }

  if (col.unique && !col.primaryKey) {
    parts.push('UNIQUE');
  }

  const normDefault = normalizeDefaultValueForDialect(col.defaultValue, col.canonicalType, dialect);
  if (normDefault !== undefined && !col.autoIncrement) {
    parts.push(`DEFAULT ${normDefault}`);
  }

  if (col.checkExpr && includeCheck) {
    parts.push(`CHECK (${col.checkExpr})`);
  }

  return parts.join(' ');
}

export function compileForeignKeyConstraintSql(
  dialect: SqlDialect,
  ownerTable: SqlTableDef,
  fk: SqlForeignKeyDef,
): string {
  const q = (id: string) => quoteIdentifier(id, dialect);
  const fkName = fk.name?.trim() || `fk_${ownerTable.name}_${fk.columns.join('_')}`;
  const srcCols = fk.columns.map(q).join(', ');
  const dstCols = fk.referencedColumns.map(q).join(', ');
  const dstTable = qualifyTableName(
    dialect,
    fk.referencedTable,
    fk.referencedSchema ?? ownerTable.schema,
  );
  let clause = `CONSTRAINT ${q(fkName)} FOREIGN KEY (${srcCols}) REFERENCES ${dstTable} (${dstCols})`;
  if (fk.onDelete && fk.onDelete !== 'NO ACTION') {
    clause += ` ON DELETE ${fk.onDelete}`;
  }
  if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') {
    clause += ` ON UPDATE ${fk.onUpdate}`;
  }
  return clause;
}

export function compileIndexDdl(
  dialect: SqlDialect,
  table: SqlTableDef,
  idx: SqlIndexDef,
  ifNotExists = false,
): string {
  const q = (id: string) => quoteIdentifier(id, dialect);
  const qualifiedTbl = qualifyTableName(dialect, table.name, table.schema);
  const cols = idx.columns.map(q).join(', ');
  const uniqueKw = idx.unique ? 'UNIQUE ' : '';
  const ineKw =
    ifNotExists && (dialect === 'sqlite' || dialect === 'postgresql') ? 'IF NOT EXISTS ' : '';
  const whereTail =
    idx.whereClause &&
    (dialect === 'sqlite' || dialect === 'postgresql' || dialect === 'sqlserver')
      ? ` WHERE ${idx.whereClause}`
      : '';
  return `CREATE ${uniqueKw}INDEX ${ineKw}${q(idx.name)} ON ${qualifiedTbl} (${cols})${whereTail};`;
}

export interface CompileTableDdlOptions {
  ifNotExists?: boolean;
  includeForeignKeysInline?: boolean;
  includeIndexes?: boolean;
}

export function compileTableDdl(
  dialect: SqlDialect,
  table: SqlTableDef,
  options: CompileTableDdlOptions = {},
): string {
  const issues = validateTableDefinition(dialect, table);
  if (issues.length > 0) {
    throw new Error(issues[0]);
  }

  const q = (id: string) => quoteIdentifier(id, dialect);
  const qualifiedTbl = qualifyTableName(dialect, table.name, table.schema);
  const pkCols = table.columns.filter((c) => c.primaryKey);
  const isSqliteSingleAutoPk =
    dialect === 'sqlite' && pkCols.length === 1 && Boolean(pkCols[0].autoIncrement);

  const lines: string[] = table.columns.map((col) =>
    compileColumnDefinitionSql(dialect, col, {
      inlineSinglePk: isSqliteSingleAutoPk,
      includeCheckInline: table.checks.length === 0,
    }),
  );

  if (pkCols.length > 0 && !isSqliteSingleAutoPk) {
    const pkName = `pk_${table.name}`;
    if (dialect === 'sqlserver' || dialect === 'postgresql') {
      lines.push(`CONSTRAINT ${q(pkName)} PRIMARY KEY (${pkCols.map((c) => q(c.name)).join(', ')})`);
    } else {
      lines.push(`PRIMARY KEY (${pkCols.map((c) => q(c.name)).join(', ')})`);
    }
  }

  // Emit table-level CHECK constraints (deduped against column checkExpr if already present)
  const emittedChecks = new Set<string>();
  if (table.checks.length > 0) {
    for (const chk of table.checks) {
      if (!chk.expression.trim() || emittedChecks.has(chk.expression.trim())) continue;
      emittedChecks.add(chk.expression.trim());
      if (chk.name?.trim()) {
        lines.push(`CONSTRAINT ${q(chk.name.trim())} CHECK (${chk.expression.trim()})`);
      } else {
        lines.push(`CHECK (${chk.expression.trim()})`);
      }
    }
    for (const col of table.columns) {
      if (col.checkExpr?.trim() && !emittedChecks.has(col.checkExpr.trim())) {
        emittedChecks.add(col.checkExpr.trim());
        lines.push(`CHECK (${col.checkExpr.trim()})`);
      }
    }
  }

  const includeFksInline = options.includeForeignKeysInline !== false;
  if (includeFksInline) {
    for (const fk of table.foreignKeys) {
      lines.push(compileForeignKeyConstraintSql(dialect, table, fk));
    }
  }

  let createStmt: string;
  if (dialect === 'sqlserver' && options.ifNotExists) {
    const schemaName = resolveEffectiveSchema(dialect, table.schema) ?? 'dbo';
    const objRef = `${schemaName}.${table.name}`.replace(/'/g, "''");
    createStmt = `IF OBJECT_ID(N'${objRef}', N'U') IS NULL\nBEGIN\nCREATE TABLE ${qualifiedTbl} (\n  ${lines.join(',\n  ')}\n);\nEND;`;
  } else {
    const ine = options.ifNotExists && dialect !== 'sqlserver' ? 'IF NOT EXISTS ' : '';
    const tail =
      dialect === 'mysql' || dialect === 'mariadb'
        ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;'
        : ';';
    createStmt = `CREATE TABLE ${ine}${qualifiedTbl} (\n  ${lines.join(',\n  ')}\n)${tail}`;
  }

  if (options.includeIndexes === false || table.indexes.length === 0) {
    return createStmt;
  }

  // Filter out single-column unique indexes already covered by column UNIQUE or PK
  const extraIndexes = table.indexes.filter((idx) => {
    if (
      idx.unique &&
      !idx.whereClause &&
      idx.columns.length === 1 &&
      table.columns.some(
        (c) => equalSqlIdentifiers(dialect, c.name, idx.columns[0]) && (c.primaryKey || c.unique),
      )
    ) {
      return false;
    }
    return true;
  });

  if (extraIndexes.length === 0) {
    return createStmt;
  }

  const idxBlock = extraIndexes
    .map((idx) => compileIndexDdl(dialect, table, idx, Boolean(options.ifNotExists)))
    .join('\n');
  return `${createStmt}\n${idxBlock}`;
}

export function formatSqlLiteral(value: SqlCellValue, dialect: SqlDialect, canonicalType?: SqlCanonicalType): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') {
    if (dialect === 'postgresql') return value ? 'TRUE' : 'FALSE';
    return value ? '1' : '0';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  const str = String(value);
  if (
    (canonicalType === 'integer' || canonicalType === 'bigint' || canonicalType === 'decimal' || canonicalType === 'float') &&
    /^[+-]?\d+(?:\.\d+)?$/.test(str)
  ) {
    return str;
  }
  const escaped = str.replace(/'/g, "''");
  if (dialect === 'sqlserver' && (canonicalType === 'varchar' || canonicalType === 'text')) {
    return `N'${escaped}'`;
  }
  return `'${escaped}'`;
}

export function compileSeedInsertStatements(
  doc: SqlDesignDocument,
  overrideDialect?: SqlDialect,
): string[] {
  const dialect = overrideDialect ?? doc.dialect;
  const q = (id: string) => quoteIdentifier(id, dialect);
  const ordered = sortTablesTopologically(dialect, doc.tables);
  const statements: string[] = [];

  for (const table of ordered) {
    const seed = doc.seedRows.find((s) => equalSqlIdentifiers(dialect, s.tableName, table.name));
    if (!seed || seed.rows.length === 0) continue;

    const qualified = qualifyTableName(dialect, table.name, table.schema);
    const hasExplicitAutoId = table.columns.some(
      (c) => c.autoIncrement && seed.rows.some((r) => r[c.name] !== undefined && r[c.name] !== null),
    );

    if (dialect === 'sqlserver' && hasExplicitAutoId) {
      statements.push(`SET IDENTITY_INSERT ${qualified} ON;`);
    }

    for (const row of seed.rows) {
      const presentCols = table.columns.filter((c) => row[c.name] !== undefined);
      if (presentCols.length === 0) continue;
      const colList = presentCols.map((c) => q(c.name)).join(', ');
      const valList = presentCols
        .map((c) => formatSqlLiteral(row[c.name] ?? null, dialect, c.canonicalType))
        .join(', ');
      statements.push(`INSERT INTO ${qualified} (${colList}) VALUES (${valList});`);
    }

    if (dialect === 'sqlserver' && hasExplicitAutoId) {
      statements.push(`SET IDENTITY_INSERT ${qualified} OFF;`);
    }
  }

  return statements;
}

export interface CompileSchemaDdlOptions {
  dialect?: SqlDialect;
  ifNotExists?: boolean;
  includeSeeds?: boolean;
}

export function compileSchemaDdl(
  doc: SqlDesignDocument,
  options: CompileSchemaDdlOptions = {},
): string {
  const dialect = options.dialect ?? doc.dialect;
  const remappedTables =
    dialect === doc.dialect
      ? doc.tables
      : doc.tables.map((t) => remapTableToDialect(t, dialect));

  const seenKeys = new Set<string>();
  for (const tbl of remappedTables) {
    const key = tableObjectKey(dialect, tbl);
    if (seenKeys.has(key)) {
      throw new Error(`Tabella duplicata nello schema: ${tbl.name}`);
    }
    seenKeys.add(key);
  }

  // Validate cross-table FK targets
  for (const tbl of remappedTables) {
    for (const fk of tbl.foreignKeys) {
      const refTarget = remappedTables.find(
        (other) =>
          tableObjectKey(dialect, other) ===
          tableObjectKey(dialect, {
            name: fk.referencedTable,
            schema: fk.referencedSchema ?? tbl.schema,
          }),
      );
      if (refTarget) {
        checkForeignKeyTarget(dialect, refTarget, fk.referencedColumns);
      }
    }
  }

  const ordered = sortTablesTopologically(dialect, remappedTables);
  const chunks: string[] = [
    `-- Schema SQL: ${doc.name} (${dialect})`,
    `-- Generato da Visual UI Studio v3.0 · Multi-Dialect SQL Engine`,
  ];

  // Emit custom schema creation if needed on PostgreSQL / SQL Server
  if (dialect === 'postgresql') {
    const customSchemas = [
      ...new Set(
        ordered
          .map((t) => resolveEffectiveSchema(dialect, t.schema))
          .filter((s): s is string => Boolean(s && s !== 'public')),
      ),
    ];
    for (const sc of customSchemas) {
      chunks.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(sc, dialect)};`);
    }
  } else if (dialect === 'sqlserver') {
    const customSchemas = [
      ...new Set(
        ordered
          .map((t) => resolveEffectiveSchema(dialect, t.schema))
          .filter((s): s is string => Boolean(s && s !== 'dbo')),
      ),
    ];
    for (const sc of customSchemas) {
      const escaped = sc.replace(/'/g, "''");
      chunks.push(
        `IF SCHEMA_ID(N'${escaped}') IS NULL EXEC(N'CREATE SCHEMA ${quoteIdentifier(sc, dialect)}');`,
      );
    }
  }

  // Check if there are cyclic FK dependencies; if none, inline FKs work cleanly in topological order
  const placedKeys = new Set<string>();
  const deferredFks: Array<{ owner: SqlTableDef; fk: SqlForeignKeyDef }> = [];

  for (const tbl of ordered) {
    const inlineFks: SqlForeignKeyDef[] = [];
    for (const fk of tbl.foreignKeys) {
      const refKey = tableObjectKey(dialect, {
        name: fk.referencedTable,
        schema: fk.referencedSchema ?? tbl.schema,
      });
      const selfKey = tableObjectKey(dialect, tbl);
      if (dialect === 'sqlite' || refKey === selfKey || placedKeys.has(refKey)) {
        inlineFks.push(fk);
      } else {
        deferredFks.push({ owner: tbl, fk });
      }
    }
    chunks.push(
      compileTableDdl(
        dialect,
        { ...tbl, foreignKeys: inlineFks },
        {
          ifNotExists: options.ifNotExists,
          includeForeignKeysInline: true,
          includeIndexes: true,
        },
      ),
    );
    placedKeys.add(tableObjectKey(dialect, tbl));
  }

  if (deferredFks.length > 0 && dialect !== 'sqlite') {
    const alterLines = deferredFks.map(({ owner, fk }) => {
      const qualifiedOwner = qualifyTableName(dialect, owner.name, owner.schema);
      return `ALTER TABLE ${qualifiedOwner} ADD ${compileForeignKeyConstraintSql(dialect, owner, fk)};`;
    });
    chunks.push(alterLines.join('\n'));
  }

  if (options.includeSeeds) {
    const seeds = compileSeedInsertStatements(doc, dialect);
    if (seeds.length > 0) {
      chunks.push(`-- Seed Rows\n${seeds.join('\n')}`);
    }
  }

  return chunks.join('\n\n') + '\n';
}

/**
 * Compiles ANY dialect's `SqlDesignDocument` into local `node:sqlite`-executable statements
 * (DDL + Seed inserts) so `:memory:` Query Rapide sandbox works seamlessly across all 5 dialects!
 */
export function compileSqliteSandboxStatements(doc: SqlDesignDocument): string[] {
  const sqliteDoc = remapDocumentToDialect(doc, 'sqlite');
  const ordered = sortTablesTopologically('sqlite', sqliteDoc.tables);
  const statements: string[] = ['PRAGMA foreign_keys = ON;'];

  for (const tbl of ordered) {
    const ddlBlock = compileTableDdl('sqlite', tbl, {
      ifNotExists: true,
      includeForeignKeysInline: true,
      includeIndexes: true,
    });
    statements.push(ddlBlock);
  }

  const seedStmts = compileSeedInsertStatements(sqliteDoc, 'sqlite');
  statements.push(...seedStmts);
  return statements;
}

export interface CompiledDmlStatement {
  kind: 'insert' | 'update' | 'delete';
  sql: string;
  params: SqlCellValue[];
  previewSql: string;
}

/**
 * Compiles staged `SqlDataChange[]` from the Excel-like Data Grid into parameterized DML
 * statements + readable SQL preview across all 5 SQL dialects.
 */
export function compileDmlStatements(
  dialect: SqlDialect,
  tableName: string,
  changes: SqlDataChange[],
  options?: {
    schema?: string;
    tableDef?: SqlTableDef;
    optimisticConcurrency?: boolean;
  },
): CompiledDmlStatement[] {
  const q = (id: string) => quoteIdentifier(id, dialect);
  const qualifiedTbl = qualifyTableName(dialect, tableName, options?.schema ?? options?.tableDef?.schema);
  const colTypeMap = new Map<string, SqlCanonicalType>();
  for (const col of options?.tableDef?.columns ?? []) {
    colTypeMap.set(identifierKey(dialect, col.name), col.canonicalType);
  }

  const lookupType = (colName: string): SqlCanonicalType | undefined =>
    colTypeMap.get(identifierKey(dialect, colName));

  const results: CompiledDmlStatement[] = [];

  for (const change of changes) {
    if (change.kind === 'insert') {
      const entries = Object.entries(change.values ?? {}).filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        const defaultSql =
          dialect === 'mysql' || dialect === 'mariadb'
            ? `INSERT INTO ${qualifiedTbl} () VALUES ();`
            : `INSERT INTO ${qualifiedTbl} DEFAULT VALUES;`;
        results.push({
          kind: 'insert',
          sql: defaultSql,
          params: [],
          previewSql: defaultSql,
        });
        continue;
      }
      const colsSql = entries.map(([col]) => q(col)).join(', ');
      const params: SqlCellValue[] = [];
      const placeholders = entries
        .map(([col, val], idx) => {
          params.push(val);
          return formatParameterPlaceholder(dialect, idx + 1, `p${idx + 1}`);
          void col;
        })
        .join(', ');
      const previewVals = entries
        .map(([col, val]) => formatSqlLiteral(val, dialect, lookupType(col)))
        .join(', ');
      results.push({
        kind: 'insert',
        sql: `INSERT INTO ${qualifiedTbl} (${colsSql}) VALUES (${placeholders});`,
        params,
        previewSql: `INSERT INTO ${qualifiedTbl} (${colsSql}) VALUES (${previewVals});`,
      });
    } else if (change.kind === 'update') {
      const setEntries = Object.entries(change.values ?? {}).filter(([, v]) => v !== undefined);
      if (setEntries.length === 0) continue;

      const pkEntries = Object.entries(change.primaryKey ?? {});
      const whereEntries =
        pkEntries.length > 0
          ? pkEntries
          : Object.entries(change.originalRow ?? {});
      if (whereEntries.length === 0) {
        throw new Error(
          `Impossibile aggiornare una riga in "${tableName}" senza chiave primaria né valori originali.`,
        );
      }

      const params: SqlCellValue[] = [];
      const setClauses: string[] = [];
      const setPreview: string[] = [];

      for (const [col, val] of setEntries) {
        params.push(val);
        const ph = formatParameterPlaceholder(dialect, params.length, `p${params.length}`);
        setClauses.push(`${q(col)} = ${ph}`);
        setPreview.push(`${q(col)} = ${formatSqlLiteral(val, dialect, lookupType(col))}`);
      }

      const whereClauses: string[] = [];
      const wherePreview: string[] = [];
      for (const [col, val] of whereEntries) {
        if (val === null) {
          whereClauses.push(`${q(col)} IS NULL`);
          wherePreview.push(`${q(col)} IS NULL`);
        } else {
          params.push(val);
          const ph = formatParameterPlaceholder(dialect, params.length, `p${params.length}`);
          whereClauses.push(`${q(col)} = ${ph}`);
          wherePreview.push(`${q(col)} = ${formatSqlLiteral(val, dialect, lookupType(col))}`);
        }
      }

      results.push({
        kind: 'update',
        sql: `UPDATE ${qualifiedTbl} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')};`,
        params,
        previewSql: `UPDATE ${qualifiedTbl} SET ${setPreview.join(', ')} WHERE ${wherePreview.join(' AND ')};`,
      });
    } else if (change.kind === 'delete') {
      const pkEntries = Object.entries(change.primaryKey ?? {});
      const whereEntries =
        pkEntries.length > 0
          ? pkEntries
          : Object.entries(change.originalRow ?? {});
      if (whereEntries.length === 0) {
        throw new Error(
          `Impossibile eliminare una riga in "${tableName}" senza chiave primaria né valori originali.`,
        );
      }

      const params: SqlCellValue[] = [];
      const whereClauses: string[] = [];
      const wherePreview: string[] = [];
      for (const [col, val] of whereEntries) {
        if (val === null) {
          whereClauses.push(`${q(col)} IS NULL`);
          wherePreview.push(`${q(col)} IS NULL`);
        } else {
          params.push(val);
          const ph = formatParameterPlaceholder(dialect, params.length, `p${params.length}`);
          whereClauses.push(`${q(col)} = ${ph}`);
          wherePreview.push(`${q(col)} = ${formatSqlLiteral(val, dialect, lookupType(col))}`);
        }
      }

      results.push({
        kind: 'delete',
        sql: `DELETE FROM ${qualifiedTbl} WHERE ${whereClauses.join(' AND ')};`,
        params,
        previewSql: `DELETE FROM ${qualifiedTbl} WHERE ${wherePreview.join(' AND ')};`,
      });
    }
  }

  return results;
}

/**
 * Transpiles query parameter placeholders (`$1`, `@p1`, `:name`) to SQLite `?` + ordered bindings
 * so parameterized queries from ANY dialect can run against the local `:memory:` SQLite sandbox!
 */
export function adaptParameterizedSqlForSqlite(
  rawSql: string,
  parameters?: SqlCellValue[] | Record<string, SqlCellValue>,
  sourceDialect: SqlDialect = 'sqlite',
  maskNonCode: (sql: string) => string = (sql) => sql,
): { sql: string; bindings: Array<string | number | null> } {
  const coerceVal = (v: SqlCellValue | undefined): string | number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  };

  let sql = rawSql;

  // Convert basic T-SQL TOP (N) -> LIMIT N for SQLite sandbox compatibility
  if (sourceDialect === 'sqlserver' && /^\s*SELECT\s+TOP\s*\(\s*(\d+)\s*\)/i.test(sql) && !/\bLIMIT\s+\d+/i.test(sql)) {
    const topMatch = sql.match(/^\s*SELECT\s+TOP\s*\(\s*(\d+)\s*\)\s*/i);
    if (topMatch) {
      const n = topMatch[1];
      sql = sql.replace(/^\s*SELECT\s+TOP\s*\(\s*\d+\s*\)\s*/i, 'SELECT ').replace(/;\s*$/, '') + ` LIMIT ${n};`;
    }
  }

  // Convert T-SQL OFFSET m ROWS FETCH NEXT n ROWS ONLY -> LIMIT n OFFSET m & strip [dbo]. schema prefix for SQLite sandbox
  if (sourceDialect === 'sqlserver') {
    sql = sql.replace(
      /\bOFFSET\s+(\d+)\s+ROWS\s+FETCH\s+(?:NEXT|FIRST)\s+(\d+)\s+ROWS\s+ONLY\b/gi,
      'LIMIT $2 OFFSET $1',
    );
    sql = sql.replace(/(?:\[dbo\]|"dbo"|\bdbo)\s*\.\s*(?=\[|"|[a-zA-Z_])/gi, '');
    sql = sql.replace(/\[([^\]]+)\]/g, (_m, inner: string) => `"${inner.replace(/"/g, '""')}"`);
  }

  // Strip PostgreSQL "public". schema prefix for SQLite sandbox
  if (sourceDialect === 'postgresql') {
    sql = sql.replace(/(?:"public"|\bpublic)\s*\.\s*(?="|[a-zA-Z_])/gi, '');
  }

  if (sourceDialect === 'mysql' || sourceDialect === 'mariadb') {
    sql = sql.replace(/`([^`]+)`/g, (_m, inner: string) => `"${inner.replace(/"/g, '""')}"`);
  }

  if (!parameters) {
    return { sql, bindings: [] };
  }

  const bindTokens = (pattern: RegExp, resolveBinding: (match: RegExpMatchArray) => SqlCellValue | undefined) => {
    let offset = 0;
    const parts: string[] = [];
    const bindings: Array<string | number | null> = [];
    for (const match of maskNonCode(sql).matchAll(pattern)) {
      parts.push(sql.slice(offset, match.index), '?');
      offset = match.index + match[0].length;
      bindings.push(coerceVal(resolveBinding(match)));
    }
    parts.push(sql.slice(offset));
    return { sql: parts.join(''), bindings };
  };

  if (Array.isArray(parameters)) {
    if (/(\$\d+|@p\d+)/i.test(maskNonCode(sql))) {
      let positional = 0;
      return bindTokens(/\$(\d+)|@p(\d+)|\?/gi, ([, pgIdx, msIdx]) =>
        parameters[pgIdx || msIdx ? Number(pgIdx ?? msIdx) - 1 : positional++],
      );
    }
    return { sql, bindings: parameters.map(coerceVal) };
  }

  // Named record parameters
  let positionalCounter = 0;
  return bindTokens(
    /\$(\d+)|(?<!:):([a-zA-Z_]\w*)|@([a-zA-Z_]\w*)|\?(\d+)?/g,
    ([token, pgNum, colonName, atName, sqliteNum]) => {
      if (token === '?') {
        positionalCounter++;
        const key = [String(positionalCounter), `p${positionalCounter}`].find((name) => Object.hasOwn(parameters, name));
        return key ? parameters[key] : Object.values(parameters)[positionalCounter - 1];
      }
      const parameter = pgNum ?? colonName ?? atName ?? sqliteNum ?? '';
      const key = [parameter, token, `p${parameter}`].find((name) => Object.hasOwn(parameters, name));
      return key ? parameters[key] : undefined;
    },
  );
}
