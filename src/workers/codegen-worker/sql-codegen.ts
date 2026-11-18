/**
 * Multi-Language SQL & Database Layer Codegen (`src/workers/codegen-worker/sql-codegen.ts`).
 *
 * Generates complete, idiomatic database schemas, typed repositories, and API/IPC layers from `SqlDesignDocument`:
 *   1. `js-node`: `db/schema.sql` + `db/connection.js` (`node:sqlite` / `pg` / `mysql2` / `mssql`) + `db/repository.js` + Express/Node CRUD routes
 *   2. `ts-drizzle`: Drizzle ORM `src/db/schema.ts` + `src/db/client.ts` + `src/db/queries.ts` + `drizzle.config.ts`
 *   3. `ts-prisma`: `prisma/schema.prisma` + `src/lib/prisma.ts` + `src/db/repository.ts`
 *      `ts-kysely`: typed database schema, native dialected client and query-builder repositories.
 *   4. `ts-nextjs`: Drizzle schema + Next.js App Router Route Handlers (`src/app/api/<table>/route.ts`) + `'use server'` Server Actions (`src/app/actions/db-actions.ts`)
 *   5. `python-fastapi`: `db/models.py` (`SQLAlchemy 2.0`) + `db/crud.py` (`sqlite3` + `SQLAlchemy` + `Pydantic v2`) + `routers/db_router.py` (`FastAPI` CRUD)
 *   6. `rust-tauri`: `src-tauri/src/db.rs` (`rusqlite` / `sqlx` + `#[tauri::command]` CRUD functions inside `@studio-tauri-commands` region markers) + `src/lib/tauri-db-client.ts`
 *
 * Pure TypeScript, zero Node imports (compiles cleanly in both `tsconfig.node.json` and `tsconfig.web.json`).
 */

import {
  compileSchemaDdl,
  formatParameterPlaceholder,
  normalizeDefaultValueForDialect,
  qualifyTableName,
  quoteIdentifier,
  remapDocumentToDialect,
  resolveEffectiveSchema,
  sortTablesTopologically,
} from '@shared/sql-dialects';
import type {
  GenerateSqlCodeRequest,
  SqlCanonicalType,
  SqlColumnDef,
  SqlDesignDocument,
  SqlDialect,
  SqlTableDef,
} from '@shared/sql-ir';
import type { CodeDiagnostic, CodegenTargetId, EmittedCodeFile, TargetArtifactBundle } from '@shared/ui-ir';
import { describeKyselySetup, emitKyselyBundle, firstUnsupportedKyselyIdentifier } from './kysely-codegen';
import { RUST_TAURI_SQL_PATHS } from '@shared/rust-tauri-sql-install';

function toSnake(name: string): string {
  return (
    name
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'item'
  );
}

function toCamel(name: string): string {
  const parts = toSnake(name).split('_').filter(Boolean);
  return parts
    .map((p, idx) => (idx === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

function toPascal(name: string): string {
  const camel = toCamel(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function makeFile(
  relativePath: string,
  language: string,
  code: string,
  isEntry = false,
): EmittedCodeFile {
  return {
    relativePath,
    language,
    code,
    isEntry,
    sourceMap: [],
    diagnostics: [],
  };
}

function tsTypeForCanonical(cType: SqlCanonicalType, nullable: boolean): string {
  let base: string;
  switch (cType) {
    case 'integer':
    case 'bigint':
    case 'float':
      base = 'number';
      break;
    case 'boolean':
      base = 'boolean';
      break;
    case 'json':
      base = 'Record<string, unknown>';
      break;
    default:
      base = 'string';
      break;
  }
  return nullable ? `${base} | null` : base;
}

function pyTypeForCanonical(cType: SqlCanonicalType, nullable: boolean): string {
  let base: string;
  switch (cType) {
    case 'integer':
    case 'bigint':
      base = 'int';
      break;
    case 'decimal':
      base = 'Decimal';
      break;
    case 'float':
      base = 'float';
      break;
    case 'date':
      base = 'date';
      break;
    case 'datetime':
      base = 'datetime';
      break;
    case 'blob':
      base = 'bytes';
      break;
    case 'boolean':
      base = 'bool';
      break;
    default:
      base = 'str';
      break;
  }
  return nullable ? `${base} | None` : base;
}

function rustTypeForCanonical(cType: SqlCanonicalType, nullable: boolean): string {
  let base: string;
  switch (cType) {
    case 'integer':
    case 'bigint':
      base = 'i64';
      break;
    case 'decimal':
    case 'float':
      base = 'f64';
      break;
    case 'boolean':
      base = 'bool';
      break;
    case 'blob':
      base = 'Vec<u8>';
      break;
    default:
      base = 'String';
      break;
  }
  return nullable ? `Option<${base}>` : base;
}

// ============================================================================
// 1. JAVASCRIPT (`js-node` — `node:sqlite` / `pg` / `mysql2` / `mssql` + Express)
// ============================================================================

function emitJavaScriptNodeBundle(
  doc: SqlDesignDocument,
  dialect: SqlDialect,
  includeRestRoutes: boolean,
  includeSeedScript: boolean,
): EmittedCodeFile[] {
  const schemaSql = compileSchemaDdl(doc, {
    dialect,
    ifNotExists: true,
    includeSeeds: includeSeedScript,
  });

  let connectionJs = '';
  if (dialect === 'sqlite') {
    const dbRel = doc.databaseFileRelPath || 'data/app.sqlite';
    connectionJs = `// Connessione SQLite Nativa Zero-Dep (Node 22.5+ / 24 \`node:sqlite\`)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = process.env.SQLITE_PATH || resolve(process.cwd(), ${JSON.stringify(dbRel)});
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

export function initDatabaseSchema() {
  const ddl = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db.exec(ddl);
}

function sqliteBindings(params) {
  return params.map((value) => typeof value === 'boolean' ? Number(value) : value);
}

export async function queryRows(sql, params = []) {
  return db.prepare(sql).all(...sqliteBindings(params));
}

export async function executeRun(sql, params = []) {
  const res = db.prepare(sql).run(...sqliteBindings(params));
  return { affectedRows: Number(res.changes ?? 0), lastInsertId: Number(res.lastInsertRowid ?? 0) };
}
`;
  } else if (dialect === 'postgresql') {
    connectionJs = `// Connessione PostgreSQL con Pool \`pg\`
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
});

export async function queryRows(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function executeRun(sql, params = []) {
  const res = await pool.query(sql, params);
  return { affectedRows: res.rowCount ?? 0, rows: res.rows };
}
`;
  } else if (dialect === 'mysql' || dialect === 'mariadb') {
    connectionJs = `// Connessione ${dialect === 'mariadb' ? 'MariaDB' : 'MySQL'} con \`mysql2/promise\`
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL || 'mysql://root:password@127.0.0.1:3306/app_db',
  waitForConnections: true,
  connectionLimit: 10,
  supportBigNumbers: true,
  bigNumberStrings: true,
});

export async function queryRows(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
}

export async function executeRun(sql, params = []) {
  const [res] = await pool.execute(sql, params);
  return { affectedRows: res.affectedRows ?? 0, lastInsertId: res.insertId ?? null };
}
`;
  } else {
    connectionJs = `// Connessione SQL Server (T-SQL) con \`mssql\`
import sql from 'mssql';

const config = process.env.DATABASE_URL || {
  server: process.env.MSSQL_HOST || '127.0.0.1',
  port: Number(process.env.MSSQL_PORT || 1433),
  database: process.env.MSSQL_DATABASE || 'AppDb',
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || '',
  options: { encrypt: false, trustServerCertificate: true },
};

let poolPromise = null;
function getPool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(config).connect();
  return poolPromise;
}

export async function queryRows(queryText, params = []) {
  const pool = await getPool();
  const req = pool.request();
  bindInputs(req, params);
  const res = await req.query(queryText);
  return res.recordset ?? [];
}

export async function executeRun(queryText, params = []) {
  const pool = await getPool();
  const req = pool.request();
  bindInputs(req, params);
  const res = await req.query(queryText);
  return { affectedRows: (res.rowsAffected ?? [])[0] ?? 0, rows: res.recordset ?? [] };
}

function bindInputs(request, params) {
  const entries = Array.isArray(params)
    ? params.map((value, index) => [\`p\${index + 1}\`, value])
    : Object.entries(params);
  entries.forEach(([key, value]) => request.input(key.replace(/^@/, ''), value));
}
`;
  }

  const orderedTables = sortTablesTopologically(dialect, doc.tables);
  const repoBlocks: string[] = [
    `// Repository CRUD Parametrizzato (${doc.name} · ${dialect})`,
    `import { queryRows, executeRun } from './connection.js';`,
    '',
  ];

  const q = (id: string) => quoteIdentifier(id, dialect);

  for (const tbl of orderedTables) {
    const pascal = toPascal(tbl.name);
    const qualified = qualifyTableName(dialect, tbl.name, tbl.schema);
    const primaryKeys = tbl.columns.filter((c) => c.primaryKey);
    const pkCol = primaryKeys.length === 1 ? primaryKeys[0] : undefined;
    const allInsertable = tbl.columns.filter((c) => !c.autoIncrement);
    const allUpdatable = allInsertable.filter((c) => !c.primaryKey);
    const expressionColumns = (columns: SqlColumnDef[]) => JSON.stringify(columns.map((c) => [c.name, q(c.name)]));
    const emptyInsert = dialect === 'mysql' || dialect === 'mariadb' ? '() VALUES ()' : 'DEFAULT VALUES';
    const colsList = tbl.columns.map((c) => q(c.name)).join(', ');
    const listSql = `SELECT ${colsList} FROM ${qualified}${pkCol ? ` ORDER BY ${q(pkCol.name)} DESC` : ''}`;
    const pkPh1 = formatParameterPlaceholder(dialect, 1, 'p1');
    const placeholder = dialect === 'postgresql' ? "'$' + index" : dialect === 'sqlserver' ? "'@p' + index" : "'?'";

    repoBlocks.push(`// === Tabella: ${tbl.name} ===
export async function list${pascal}() {
  return queryRows(${JSON.stringify(listSql)});
}

export async function create${pascal}(payload) {
  const columns = ${expressionColumns(allInsertable)}.filter(([key]) => payload[key] !== undefined);
  const param = (index) => ${placeholder};
  const valuesSql = columns.length
    ? '(' + columns.map(([, col]) => col).join(', ') + ') VALUES (' + columns.map((_, i) => param(i + 1)).join(', ') + ')'
    : ${JSON.stringify(emptyInsert)};
  return executeRun(${JSON.stringify(`INSERT INTO ${qualified} `)} + valuesSql, columns.map(([key]) => payload[key]));
}
`);

    if (!pkCol) continue;
    repoBlocks.push(`
export async function get${pascal}ById(id) {
  const rows = await queryRows(${JSON.stringify(`SELECT ${colsList} FROM ${qualified} WHERE ${q(pkCol.name)} = ${pkPh1}`)}, [id]);
  return rows[0] ?? null;
}

export async function update${pascal}(id, payload) {
  const columns = ${expressionColumns(allUpdatable)}.filter(([key]) => payload[key] !== undefined);
  if (columns.length === 0) return { affectedRows: 0 };
  const param = (index) => ${placeholder};
  const setClause = columns.map(([, col], i) => col + ' = ' + param(i + 1)).join(', ');
  const sql = ${JSON.stringify(`UPDATE ${qualified} SET `)} + setClause + ${JSON.stringify(` WHERE ${q(pkCol.name)} = `)} + param(columns.length + 1);
  return executeRun(sql, [...columns.map(([key]) => payload[key]), id]);
}

export async function delete${pascal}(id) {
  return executeRun(${JSON.stringify(`DELETE FROM ${qualified} WHERE ${q(pkCol.name)} = ${pkPh1}`)}, [id]);
}
`);
  }

  for (const nq of doc.namedQueries) {
    const fnName = toCamel(nq.name);
    const sqlText = nq.sqlByDialect?.[dialect] ?? nq.canonicalSql;
    const paramNames = nq.parameters.map((p) => p.name);
    const sigArgs = paramNames.length > 0 ? 'params = {}' : '';
    const bindArr = paramNames.length === 0
      ? '[]'
      : dialect === 'sqlserver'
        ? 'params'
        : `${JSON.stringify(paramNames)}.map((key) => params[key])`;
    const helper = nq.kind === 'select' ? 'queryRows' : 'executeRun';
    repoBlocks.push(`// Named Query: ${nq.name}
export async function ${fnName}(${sigArgs}) {
  return ${helper}(${JSON.stringify(sqlText)}, ${bindArr});
}
`);
  }

  const files: EmittedCodeFile[] = [
    makeFile('db/repository.js', 'javascript', repoBlocks.join('\n'), true),
    makeFile('db/connection.js', 'javascript', connectionJs),
    makeFile('db/schema.sql', 'sql', schemaSql),
  ];

  if (includeRestRoutes) {
    const routeBlocks: string[] = [
      `// Router Express CRUD generato per ${doc.name} (${dialect})`,
      `import express from 'express';`,
      `import * as repo from '../db/repository.js';`,
      '',
      `export const dbCrudRouter = express.Router();`,
      `dbCrudRouter.use(express.json());`,
      '',
    ];

    for (const tbl of orderedTables) {
      const slug = toSnake(tbl.name).replace(/_/g, '-');
      const pascal = toPascal(tbl.name);
      routeBlocks.push(`dbCrudRouter.get('/${slug}', async (_req, res, next) => {
  try { res.json(await repo.list${pascal}()); } catch (err) { next(err); }
});
dbCrudRouter.post('/${slug}', async (req, res, next) => {
  try { res.status(201).json(await repo.create${pascal}(req.body)); } catch (err) { next(err); }
});
`);
      if (tbl.columns.filter((c) => c.primaryKey).length !== 1) continue;
      routeBlocks.push(`
dbCrudRouter.get('/${slug}/:id', async (req, res, next) => {
  try {
    const row = await repo.get${pascal}ById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Record non trovato' });
    res.json(row);
  } catch (err) { next(err); }
});
dbCrudRouter.put('/${slug}/:id', async (req, res, next) => {
  try { res.json(await repo.update${pascal}(req.params.id, req.body)); } catch (err) { next(err); }
});
dbCrudRouter.delete('/${slug}/:id', async (req, res, next) => {
  try { res.json(await repo.delete${pascal}(req.params.id)); } catch (err) { next(err); }
});
`);
    }
    files.push(makeFile('routes/db-crud.routes.js', 'javascript', routeBlocks.join('\n')));
  }

  return files;
}

// ============================================================================
// 2. TYPESCRIPT — DRIZZLE ORM (`ts-drizzle`) & NEXT.JS (`ts-nextjs`)
// ============================================================================

function emitDrizzleColumnExpr(col: SqlColumnDef, dialect: SqlDialect): string {
  const cName = JSON.stringify(col.name);
  let builder: string;

  if (dialect === 'sqlite') {
    switch (col.canonicalType) {
      case 'integer':
      case 'bigint':
        builder = col.autoIncrement
          ? `integer(${cName}, { mode: 'number' }).primaryKey({ autoIncrement: true })`
          : `integer(${cName})`;
        break;
      case 'boolean':
        builder = `integer(${cName}, { mode: 'boolean' })`;
        break;
      case 'float':
      case 'decimal':
        builder = `real(${cName})`;
        break;
      case 'blob':
        builder = `blob(${cName}, { mode: 'buffer' })`;
        break;
      default:
        builder = `text(${cName})`;
        break;
    }
    if (col.primaryKey && !col.autoIncrement) builder += '.primaryKey()';
    const defaultValue = normalizeDefaultValueForDialect(col.defaultValue, col.canonicalType, dialect);
    if (!col.autoIncrement && defaultValue !== undefined) builder += `.default(sql.raw(${JSON.stringify(defaultValue)}))`;
  } else if (dialect === 'mysql' || dialect === 'mariadb') {
    switch (col.canonicalType) {
      case 'integer':
      case 'bigint':
        builder = col.autoIncrement ? `serial(${cName}).primaryKey()` : `int(${cName})`;
        break;
      case 'boolean':
        builder = `boolean(${cName})`;
        break;
      case 'decimal':
        builder = `decimal(${cName}, { precision: ${col.precision ?? 12}, scale: ${col.scale ?? 2} })`;
        break;
      case 'datetime':
        builder = `datetime(${cName})`;
        break;
      case 'text':
        builder = `text(${cName})`;
        break;
      default:
        builder = `varchar(${cName}, { length: ${col.length ?? 255} })`;
        break;
    }
    if (col.primaryKey && !col.autoIncrement) builder += '.primaryKey()';
  } else {
    // PostgreSQL (and typed PG-style core for full-stack TS)
    switch (col.canonicalType) {
      case 'integer':
      case 'bigint':
        builder = col.autoIncrement ? `serial(${cName}).primaryKey()` : `integer(${cName})`;
        break;
      case 'boolean':
        builder = `boolean(${cName})`;
        break;
      case 'decimal':
        builder = `numeric(${cName}, { precision: ${col.precision ?? 12}, scale: ${col.scale ?? 2} })`;
        break;
      case 'datetime':
        builder = `timestamp(${cName}, { withTimezone: true })`;
        break;
      case 'uuid':
        builder = `uuid(${cName})`;
        break;
      case 'text':
      case 'json':
        builder = `text(${cName})`;
        break;
      default:
        builder = `varchar(${cName}, { length: ${col.length ?? 255} })`;
        break;
    }
    if (col.primaryKey && !col.autoIncrement) builder += '.primaryKey()';
  }

  if (!col.nullable && !col.primaryKey) builder += '.notNull()';
  if (col.unique && !col.primaryKey) builder += '.unique()';
  return builder;
}

function buildDrizzleSchemaTs(doc: SqlDesignDocument, dialect: SqlDialect): string {
  const ordered = sortTablesTopologically(dialect, doc.tables);
  const coreImport =
    dialect === 'sqlite'
      ? `import { sql } from 'drizzle-orm';\nimport { sqliteTable, integer, text, real, blob } from 'drizzle-orm/sqlite-core';`
      : dialect === 'mysql' || dialect === 'mariadb'
        ? `import { mysqlTable, serial, int, varchar, text, decimal, boolean, datetime } from 'drizzle-orm/mysql-core';`
        : `import { pgTable, serial, integer, varchar, text, numeric, boolean, timestamp, uuid } from 'drizzle-orm/pg-core';`;

  const tableFn =
    dialect === 'sqlite'
      ? 'sqliteTable'
      : dialect === 'mysql' || dialect === 'mariadb'
        ? 'mysqlTable'
        : 'pgTable';

  const blocks: string[] = [
    `// Drizzle ORM Schema (${doc.name.replace(/\s+/g, ' ')} · Dialetto: ${dialect})`,
    coreImport,
    '',
  ];

  for (const tbl of ordered) {
    const camel = toCamel(tbl.name);
    const pascal = toPascal(tbl.name);
    const colLines = tbl.columns.map((col) => {
      let expr = emitDrizzleColumnExpr(col, dialect);
      const fk = tbl.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === col.name);
      if (fk && fk.referencedTable !== tbl.name) {
        const refCamel = toCamel(fk.referencedTable);
        const refColCamel = toCamel(fk.referencedColumns[0] || 'id');
        const cascadeOpt = fk.onDelete === 'CASCADE' ? `, { onDelete: 'cascade' }` : '';
        expr += `.references(() => ${refCamel}.${refColCamel}${cascadeOpt})`;
      }
      return `  ${toCamel(col.name)}: ${expr},`;
    });

    blocks.push(`export const ${camel} = ${tableFn}(${JSON.stringify(tbl.name)}, {
${colLines.join('\n')}
});

export type ${pascal}Row = typeof ${camel}.$inferSelect;
export type New${pascal}Row = typeof ${camel}.$inferInsert;
`);
  }

  return blocks.join('\n');
}

function emitDrizzleBundle(
  doc: SqlDesignDocument,
  dialect: SqlDialect,
  includeSeedScript: boolean,
): EmittedCodeFile[] {
  const schemaTs = buildDrizzleSchemaTs(doc, dialect);
  const ordered = sortTablesTopologically(dialect, doc.tables);

  const clientTs =
    dialect === 'sqlite'
      ? `// Node.js con node:sqlite e drizzle-orm@rc (driver node-sqlite).
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import * as schema from './schema';

const sqlitePath = process.env.SQLITE_PATH || ${JSON.stringify(`./${doc.databaseFileRelPath || 'data/app.sqlite'}`)};
if (sqlitePath !== ':memory:') mkdirSync(dirname(resolve(sqlitePath)), { recursive: true });
export const sqliteConnection = new DatabaseSync(sqlitePath);
sqliteConnection.exec('PRAGMA foreign_keys = ON;');
export const db = drizzle({ client: sqliteConnection });
export type StudioDatabase = typeof db;

// Esegui su un database nuovo per applicare DDL ed eventuali dati iniziali.
export function initDatabaseSchema() {
  sqliteConnection.exec(readFileSync(resolve('db/schema.sql'), 'utf8'));
}
export { schema };
`
      : `import * as schema from './schema';

export const DATABASE_URL = process.env.DATABASE_URL || '';
export { schema };
`;

  const queryBlocks: string[] = [
    `// Query tipizzate Drizzle ORM (${doc.name.replace(/\s+/g, ' ')})`,
    `import { eq, desc } from 'drizzle-orm';`,
    `import * as schema from './schema';`,
  ];
  if (dialect === 'sqlite') queryBlocks.push(`import type { StudioDatabase } from './client';`);
  queryBlocks.push('');

  for (const tbl of ordered) {
    const camel = toCamel(tbl.name);
    const pascal = toPascal(tbl.name);
    const pkCol = tbl.columns.find((c) => c.primaryKey) ?? tbl.columns[0];
    const pkCamel = toCamel(pkCol?.name ?? 'id');

    if (dialect === 'sqlite') {
      const primaryKeys = tbl.columns.filter((column) => column.primaryKey);
      const order = pkCol ? `.orderBy(desc(schema.${camel}.${pkCamel}))` : '';
      queryBlocks.push(`export async function list${pascal}(db: StudioDatabase): Promise<schema.${pascal}Row[]> {
  return db.select().from(schema.${camel})${order};
}

export async function insert${pascal}(db: StudioDatabase, data: schema.New${pascal}Row) {
  return db.insert(schema.${camel}).values(data).returning();
}
`);
      if (primaryKeys.length === 1) {
        const keyType = `schema.${pascal}Row[${JSON.stringify(pkCamel)}]`;
        queryBlocks.push(`export async function update${pascal}ById(db: StudioDatabase, id: ${keyType}, data: Partial<Omit<schema.New${pascal}Row, ${JSON.stringify(pkCamel)}>>) {
  return db.update(schema.${camel}).set(data).where(eq(schema.${camel}.${pkCamel}, id)).returning();
}

export async function delete${pascal}ById(db: StudioDatabase, id: ${keyType}) {
  return db.delete(schema.${camel}).where(eq(schema.${camel}.${pkCamel}, id)).returning();
}
`);
      }
      continue;
    }

    queryBlocks.push(`export async function list${pascal}(db: any): Promise<schema.${pascal}Row[]> {
  return db.select().from(schema.${camel}).orderBy(desc(schema.${camel}.${pkCamel}));
}

export async function insert${pascal}(db: any, data: schema.New${pascal}Row) {
  return db.insert(schema.${camel}).values(data);
}

export async function delete${pascal}ById(db: any, id: number | string) {
  return db.delete(schema.${camel}).where(eq(schema.${camel}.${pkCamel}, id as any));
}
`);
  }

  const drizzleConfigTs = `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: '${dialect === 'mariadb' ? 'mysql' : dialect === 'sqlserver' ? 'mssql' : dialect}',
});
`;

  return [
    makeFile('src/db/schema.ts', 'typescript', schemaTs, true),
    makeFile('src/db/queries.ts', 'typescript', queryBlocks.join('\n')),
    makeFile('src/db/client.ts', 'typescript', clientTs),
    makeFile('drizzle.config.ts', 'typescript', drizzleConfigTs),
    makeFile('db/schema.sql', 'sql', compileSchemaDdl(doc, { dialect, ifNotExists: true, includeSeeds: includeSeedScript })),
  ];
}

function emitNextJsSqlBundle(
  doc: SqlDesignDocument,
  dialect: SqlDialect,
  includeSeedScript: boolean,
): EmittedCodeFile[] {
  const schemaTs = buildDrizzleSchemaTs(doc, dialect);
  const ordered = sortTablesTopologically(dialect, doc.tables);

  const actionsLines: string[] = [
    `'use server';`,
    `// Next.js Server Actions CRUD generate da Visual UI Studio (${dialect})`,
    `import { revalidatePath } from 'next/cache';`,
    '',
  ];

  const files: EmittedCodeFile[] = [
    makeFile('src/db/schema.ts', 'typescript', schemaTs, true),
  ];

  for (const tbl of ordered) {
    const pascal = toPascal(tbl.name);
    const slug = toSnake(tbl.name).replace(/_/g, '-');
    const editableCols = tbl.columns.filter((c) => !c.autoIncrement);

    const formExtractLines = editableCols.map((c) => {
      if (c.canonicalType === 'boolean') {
        return `    ${c.name}: formData.get('${c.name}') === 'true' || formData.get('${c.name}') === 'on',`;
      }
      if (c.canonicalType === 'integer' || c.canonicalType === 'bigint' || c.canonicalType === 'float') {
        return `    ${c.name}: Number(formData.get('${c.name}') ?? 0),`;
      }
      return `    ${c.name}: String(formData.get('${c.name}') ?? ''),`;
    });

    actionsLines.push(`export async function create${pascal}Action(formData: FormData) {
  const payload = {
${formExtractLines.join('\n')}
  };
  revalidatePath('/');
  return { ok: true, table: '${tbl.name}', payload };
}

export async function delete${pascal}Action(id: string | number) {
  revalidatePath('/');
  return { ok: true, table: '${tbl.name}', deletedId: id };
}
`);

    const routeTs = `// Next.js App Router CRUD Route Handler: /api/${slug}
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true, table: '${tbl.name}', rows: [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ ok: true, table: '${tbl.name}', created: body }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  return NextResponse.json({ ok: true, table: '${tbl.name}', deletedId: id });
}
`;
    files.push(makeFile(`src/app/api/${slug}/route.ts`, 'typescript', routeTs));
  }

  files.splice(1, 0, makeFile('src/app/actions/db-actions.ts', 'typescript', actionsLines.join('\n')));
  files.push(
    makeFile(
      'db/schema.sql',
      'sql',
      compileSchemaDdl(doc, { dialect, ifNotExists: true, includeSeeds: includeSeedScript }),
    ),
  );
  return files;
}

// ============================================================================
// 3. TYPESCRIPT — PRISMA (`ts-prisma`)
// ============================================================================

function prismaScalarForColumn(col: SqlColumnDef): string {
  let scalar: string;
  switch (col.canonicalType) {
    case 'integer':
      scalar = 'Int';
      break;
    case 'bigint':
      scalar = 'BigInt';
      break;
    case 'decimal':
      scalar = 'Decimal';
      break;
    case 'float':
      scalar = 'Float';
      break;
    case 'boolean':
      scalar = 'Boolean';
      break;
    case 'date':
    case 'datetime':
      scalar = 'DateTime';
      break;
    case 'json':
      scalar = 'Json';
      break;
    case 'blob':
      scalar = 'Bytes';
      break;
    default:
      scalar = 'String';
      break;
  }
  return col.nullable && !col.primaryKey ? `${scalar}?` : scalar;
}

function prismaSqliteDefault(col: SqlColumnDef): string | undefined {
  const value = normalizeDefaultValueForDialect(col.defaultValue, col.canonicalType, 'sqlite');
  if (value === undefined || /^null$/i.test(value)) return undefined;
  if (col.canonicalType === 'boolean' && /^[01]$/.test(value)) return value === '1' ? 'true' : 'false';
  if (['integer', 'bigint', 'decimal', 'float'].includes(col.canonicalType) && /^-?\d+(\.\d+)?$/.test(value)) return value;
  if (col.canonicalType === 'datetime' && value === 'CURRENT_TIMESTAMP') return 'now()';
  if (['text', 'varchar', 'uuid', 'json'].includes(col.canonicalType) && /^'(?:[^']|'')*'$/.test(value)) {
    return JSON.stringify(value.slice(1, -1).replace(/''/g, "'"));
  }
  return `dbgenerated(${JSON.stringify(value)})`;
}

function emitPrismaBundle(doc: SqlDesignDocument, dialect: SqlDialect): EmittedCodeFile[] {
  const provider =
    dialect === 'postgresql'
      ? 'postgresql'
      : dialect === 'mysql' || dialect === 'mariadb'
        ? 'mysql'
        : dialect === 'sqlserver'
          ? 'sqlserver'
          : 'sqlite';

  const urlDefault = provider === 'sqlite'
    ? JSON.stringify(`file:../${doc.databaseFileRelPath || 'data/app.sqlite'}`)
    : 'env("DATABASE_URL")';

  const modelBlocks: string[] = [
    `// Schema Prisma ORM 6 (${doc.name.replace(/\s+/g, ' ')})`,
    `generator client {`,
    `  provider = "prisma-client-js"`,
    `}`,
    '',
    `datasource db {`,
    `  provider = "${provider}"`,
    `  url      = ${urlDefault}`,
    `}`,
    '',
  ];

  const ordered = sortTablesTopologically(dialect, doc.tables);
  const prismaReferentialActions = { 'NO ACTION': 'NoAction', RESTRICT: 'Restrict', CASCADE: 'Cascade', 'SET NULL': 'SetNull', 'SET DEFAULT': 'SetDefault' } as const;
  for (const tbl of ordered) {
    const pascal = toPascal(tbl.name);
    const fieldLines: string[] = [];

    for (const col of tbl.columns) {
      const attrs: string[] = [];
      if (col.primaryKey) attrs.push('@id');
      if (col.autoIncrement) attrs.push('@default(autoincrement())');
      else if (provider === 'sqlite') {
        const defaultValue = prismaSqliteDefault(col);
        if (defaultValue !== undefined) attrs.push(`@default(${defaultValue})`);
      } else if (col.canonicalType === 'datetime' && col.defaultValue && /CURRENT_TIMESTAMP|NOW|SYSUTCDATETIME/i.test(col.defaultValue)) {
        attrs.push('@default(now())');
      } else if (col.canonicalType === 'uuid' && col.defaultValue) {
        attrs.push('@default(uuid())');
      }
      if (col.unique && !col.primaryKey) attrs.push('@unique');
      const camelField = toCamel(col.name);
      if (camelField !== col.name) attrs.push(`@map(${JSON.stringify(col.name)})`);
      fieldLines.push(
        `  ${camelField} ${prismaScalarForColumn(col)}${attrs.length ? ' ' + attrs.join(' ') : ''}`,
      );
    }

    for (const fk of tbl.foreignKeys) {
      if (fk.columns.length === 1) {
        const refPascal = toPascal(fk.referencedTable);
        const relField = toCamel(fk.referencedTable);
        const srcField = toCamel(fk.columns[0]);
        const dstField = toCamel(fk.referencedColumns[0] || 'id');
        const nullable = tbl.columns.find((column) => column.name === fk.columns[0])?.nullable;
        const referentialActions = provider === 'sqlite' ? [
          fk.onDelete && `, onDelete: ${prismaReferentialActions[fk.onDelete]}`,
          fk.onUpdate && `, onUpdate: ${prismaReferentialActions[fk.onUpdate]}`,
        ].filter(Boolean).join('') : '';
        fieldLines.push(
          `  ${relField} ${refPascal}${nullable ? '?' : ''} @relation(fields: [${srcField}], references: [${dstField}]${referentialActions})`,
        );
      }
    }

    // Add reverse relation arrays for child tables referencing `tbl`
    for (const other of ordered) {
      for (const fk of other.foreignKeys) {
        if (fk.referencedTable === tbl.name && fk.columns.length === 1) {
          fieldLines.push(`  ${toCamel(other.name)}List ${toPascal(other.name)}[]`);
        }
      }
    }

    fieldLines.push(`  @@map(${JSON.stringify(tbl.name)})`);
    modelBlocks.push(`model ${pascal} {\n${fieldLines.join('\n')}\n}\n`);
  }

  const prismaClientTs = `import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
`;

  const repoLines: string[] = [
    `import { prisma } from '../lib/prisma';`,
    '',
  ];
  for (const tbl of ordered) {
    const pascal = toPascal(tbl.name);
    const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
    const pkCol = tbl.columns.find((c) => c.primaryKey) ?? tbl.columns[0];
    const pkCamel = toCamel(pkCol?.name ?? 'id');
    repoLines.push(`export const ${camel}Repository = {
  list: () => prisma.${camel}.findMany({ orderBy: { ${pkCamel}: 'desc' } }),
  getById: (id: any) => prisma.${camel}.findUnique({ where: { ${pkCamel}: id } }),
  create: (data: any) => prisma.${camel}.create({ data }),
  update: (id: any, data: any) => prisma.${camel}.update({ where: { ${pkCamel}: id }, data }),
  remove: (id: any) => prisma.${camel}.delete({ where: { ${pkCamel}: id } }),
};
`);
  }

  return [
    makeFile('prisma/schema.prisma', 'prisma', modelBlocks.join('\n'), true),
    makeFile('src/lib/prisma.ts', 'typescript', prismaClientTs),
    makeFile('src/db/repository.ts', 'typescript', repoLines.join('\n')),
  ];
}

// ============================================================================
// 4. PYTHON (`python-fastapi` — `sqlite3` + `SQLAlchemy 2.0` + `FastAPI` + `Pydantic v2`)
// ============================================================================

function sqlalchemyTypeExpr(col: SqlColumnDef): string {
  switch (col.canonicalType) {
    case 'integer':
      return 'Integer';
    case 'bigint':
      return 'BigInteger';
    case 'decimal':
      return `Numeric(${col.precision ?? 12}, ${col.scale ?? 2})`;
    case 'float':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'Date';
    case 'datetime':
      return 'DateTime(timezone=True)';
    case 'text':
    case 'json':
      return 'Text';
    case 'blob':
      return 'LargeBinary';
    default:
      return `String(${col.length ?? 255})`;
  }
}

function emitPythonFastApiBundle(
  doc: SqlDesignDocument,
  dialect: SqlDialect,
  includeSeedScript: boolean,
): EmittedCodeFile[] {
  // SQLAlchemy ORM requires a primary key, even for read-only mappings.
  const ordered = sortTablesTopologically(dialect, doc.tables).filter((table) => table.columns.some((column) => column.primaryKey));
  const dbFile = doc.databaseFileRelPath || 'data/app.sqlite';
  const dbUrlDefault =
    dialect === 'postgresql'
      ? 'postgresql+psycopg://postgres:postgres@127.0.0.1:5432/app_db'
      : dialect === 'mysql' || dialect === 'mariadb'
        ? 'mysql+pymysql://root:password@127.0.0.1:3306/app_db'
        : dialect === 'sqlserver'
          ? 'mssql+pyodbc://sa:Password@127.0.0.1:1433/AppDb?driver=ODBC+Driver+18+for+SQL+Server'
          : `sqlite:///./${dbFile}`;

  const modelsPyLines: string[] = [
    `"""SQLAlchemy 2.0 ORM models."""`,
    `from __future__ import annotations`,
    `import os`,
    `from datetime import date, datetime`,
    `from decimal import Decimal`,
    `from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKeyConstraint, Integer, LargeBinary, Numeric, String, Text, create_engine, event, text`,
    `from sqlalchemy.engine import URL, make_url`,
    `from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker`,
    `from sqlalchemy.pool import StaticPool`,
    '',
    `url_override = os.getenv("DATABASE_URL")`,
    `DATABASE_URL = make_url(url_override) if url_override else ${dialect === 'sqlite' ? `URL.create("sqlite", database=${JSON.stringify(dbFile)})` : `make_url(${JSON.stringify(dbUrlDefault)})`}`,
    `is_sqlite = DATABASE_URL.get_backend_name() == "sqlite"`,
    `is_memory = is_sqlite and DATABASE_URL.database in (None, "", ":memory:")`,
    `engine = create_engine(DATABASE_URL, **({"poolclass": StaticPool, "connect_args": {"check_same_thread": False}} if is_memory else {}))`,
    `if is_sqlite:`,
    `    @event.listens_for(engine, "connect")`,
    `    def _enable_foreign_keys(connection, _record):`,
    `        connection.execute("PRAGMA foreign_keys = ON")`,
    '',
    `SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)`,
    '',
    `class Base(DeclarativeBase):`,
    `    pass`,
    '',
  ];

  for (const tbl of ordered) {
    const pascal = toPascal(tbl.name);
    modelsPyLines.push(`class ${pascal}Model(Base):`);
    modelsPyLines.push(`    __tablename__ = ${JSON.stringify(tbl.name)}`);
    const modelSchema = resolveEffectiveSchema(dialect, tbl.schema);
    const tableArgs: string[] = [];
    const definedChecks = new Set<string>();
    for (const check of tbl.checks) {
      definedChecks.add(check.expression);
      tableArgs.push(`CheckConstraint(${JSON.stringify(check.expression)}${check.name ? `, name=${JSON.stringify(check.name)}` : ''})`);
    }
    for (const col of tbl.columns) {
      if (col.checkExpr && !definedChecks.has(col.checkExpr)) {
        definedChecks.add(col.checkExpr);
        tableArgs.push(`CheckConstraint(${JSON.stringify(col.checkExpr)})`);
      }
    }
    for (const fk of tbl.foreignKeys) {
      const refSchema = resolveEffectiveSchema(dialect, fk.referencedSchema ?? tbl.schema);
      const ref = `${refSchema ? `${refSchema}.` : ''}${fk.referencedTable}`;
      if (!ordered.some((other) => other.name === fk.referencedTable && resolveEffectiveSchema(dialect, other.schema) === refSchema)) continue;
      const options = [fk.name ? `name=${JSON.stringify(fk.name)}` : '', fk.onDelete ? `ondelete=${JSON.stringify(fk.onDelete)}` : '', fk.onUpdate ? `onupdate=${JSON.stringify(fk.onUpdate)}` : ''].filter(Boolean);
      tableArgs.push(`ForeignKeyConstraint(${JSON.stringify(fk.columns)}, ${JSON.stringify(fk.referencedColumns.map((col) => `${ref}.${col}`))}${options.length ? `, ${options.join(', ')}` : ''})`);
    }
    if (modelSchema) tableArgs.push(`{"schema": ${JSON.stringify(modelSchema)}}`);
    if (tableArgs.length > 0) {
      modelsPyLines.push(`    __table_args__ = (`, ...tableArgs.map((arg) => `        ${arg},`), '    )');
    }

    for (const col of tbl.columns) {
      const pyType = pyTypeForCanonical(col.canonicalType, col.nullable && !col.primaryKey);
      const sqliteIdentity = dialect === 'sqlite' && col.autoIncrement;
      const colArgs: string[] = [sqliteIdentity ? 'Integer' : sqlalchemyTypeExpr(col)];
      if (col.primaryKey) colArgs.push('primary_key=True');
      if (col.autoIncrement) colArgs.push('autoincrement=True');
      if (!col.nullable && !col.primaryKey) colArgs.push('nullable=False');
      if (col.unique && !col.primaryKey) colArgs.push('unique=True');
      const defaultValue = normalizeDefaultValueForDialect(col.defaultValue, col.canonicalType, dialect);
      if (defaultValue !== undefined) colArgs.push(`server_default=text(${JSON.stringify(defaultValue)})`);
      modelsPyLines.push(`    ${col.name}: Mapped[${pyType}] = mapped_column(${colArgs.join(', ')})`);
    }
    modelsPyLines.push('');
  }

  const crudPyLines: string[] = [
    `"""Repository CRUD (SQLAlchemy 2.0 + sqlite3 helper) & Schemi Pydantic v2."""`,
    `from __future__ import annotations`,
    `import sqlite3`,
    `from datetime import date, datetime`,
    `from decimal import Decimal`,
    `from pathlib import Path`,
    `from pydantic import BaseModel, ConfigDict, field_validator`,
    `from sqlalchemy import select`,
    `from sqlalchemy.orm import Session`,
    `from .models import ${['Base', 'DATABASE_URL', 'engine', 'is_memory', 'is_sqlite', ...ordered.map((t) => `${toPascal(t.name)}Model`)].join(', ')}`,
    '',
    `def init_db() -> None:`,
    `    if is_sqlite and not is_memory and DATABASE_URL.database:`,
    `        Path(DATABASE_URL.database).parent.mkdir(parents=True, exist_ok=True)`,
    `    Base.metadata.create_all(bind=engine)`,
    '',
    `def get_sqlite_connection(db_path: str = ${JSON.stringify(dbFile)}) -> sqlite3.Connection:`,
    `    Path(db_path).parent.mkdir(parents=True, exist_ok=True)`,
    `    conn = sqlite3.connect(db_path)`,
    `    conn.row_factory = sqlite3.Row`,
    `    conn.execute("PRAGMA foreign_keys = ON;")`,
    `    return conn`,
    '',
  ];

  const routerLines: string[] = [
    `"""FastAPI CRUD routes."""`,
    `from __future__ import annotations`,
    `from contextlib import contextmanager`,
    `from datetime import date, datetime`,
    `from decimal import Decimal`,
    `from typing import Generator`,
    `from fastapi import APIRouter, Depends, HTTPException, status`,
    `from sqlalchemy.exc import IntegrityError`,
    `from sqlalchemy.orm import Session`,
    `from db.models import SessionLocal`,
    `from db import crud`,
    '',
    `router = APIRouter(prefix="/api", tags=["Database CRUD"])`,
    '',
    `def get_db() -> Generator[Session, None, None]:`,
    `    db = SessionLocal()`,
    `    try:`,
    `        yield db`,
    `    finally:`,
    `        db.close()`,
    '',
    `@contextmanager`,
    `def database_write(db: Session):`,
    `    try:`,
    `        yield`,
    `    except IntegrityError as error:`,
    `        db.rollback()`,
    `        raise HTTPException(status_code=409, detail="Database constraint violated") from error`,
    '',
  ];

  for (const tbl of ordered) {
    const pascal = toPascal(tbl.name);
    const snake = toSnake(tbl.name);
    const slug = snake.replace(/_/g, '-');
    const keys = tbl.columns.filter((c) => c.primaryKey);
    const pkCol = keys.length === 1 ? keys[0] : undefined;
    const editableCols = tbl.columns.filter((c) => !c.autoIncrement);
    const updatableCols = editableCols.filter((c) => !c.primaryKey);
    const listOrder = keys.map((key) => `${pascal}Model.${key.name}.desc()`).join(', ');
    const pkType = pkCol ? pyTypeForCanonical(pkCol.canonicalType, false) : undefined;
    const nullableValidator = (columns: SqlColumnDef[]) => columns.length === 0 ? [] : [
      '',
      `    @field_validator(${columns.map((column) => JSON.stringify(column.name)).join(', ')})`,
      `    @classmethod`,
      `    def reject_null(cls, value):`,
      `        if value is None:`,
      `            raise ValueError("This field cannot be null")`,
      `        return value`,
    ];

    crudPyLines.push(`class ${pascal}Create(BaseModel):`);
    if (editableCols.length === 0) {
      crudPyLines.push(`    pass`);
    } else {
      for (const c of editableCols) {
        const optional = c.nullable || normalizeDefaultValueForDialect(c.defaultValue, c.canonicalType, dialect) !== undefined;
        const tStr = pyTypeForCanonical(c.canonicalType, optional);
        crudPyLines.push(`    ${c.name}: ${tStr}${optional ? ' = None' : ''}`);
      }
      crudPyLines.push(...nullableValidator(editableCols.filter((c) => !c.nullable && normalizeDefaultValueForDialect(c.defaultValue, c.canonicalType, dialect) !== undefined)));
    }
    crudPyLines.push('');

    crudPyLines.push(`class ${pascal}Read(BaseModel):`);
    crudPyLines.push(`    model_config = ConfigDict(from_attributes=True)`);
    for (const c of tbl.columns) {
      crudPyLines.push(`    ${c.name}: ${pyTypeForCanonical(c.canonicalType, c.nullable && !c.primaryKey)}`);
    }
    crudPyLines.push('');

    if (pkCol && updatableCols.length > 0) {
      crudPyLines.push(`class ${pascal}Update(BaseModel):`);
      for (const column of updatableCols) {
        crudPyLines.push(`    ${column.name}: ${pyTypeForCanonical(column.canonicalType, true)} = None`);
      }
      crudPyLines.push(...nullableValidator(updatableCols.filter((column) => !column.nullable)), '');
    }

    crudPyLines.push(`def list_${snake}(db: Session, limit: int = 100) -> list[${pascal}Model]:
    stmt = select(${pascal}Model).order_by(${listOrder}).limit(limit)
    return list(db.scalars(stmt).all())

def create_${snake}(db: Session, payload: ${pascal}Create) -> ${pascal}Model:
    obj = ${pascal}Model(**payload.model_dump(exclude_unset=True))
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj
`);

    if (pkCol) {
      crudPyLines.push(`def get_${snake}(db: Session, item_id: ${pkType}) -> ${pascal}Model | None:
    return db.get(${pascal}Model, item_id)

def delete_${snake}(db: Session, item_id: ${pkType}) -> bool:
    obj = db.get(${pascal}Model, item_id)
    if obj is None:
        return False
    db.delete(obj)
    db.commit()
    return True
`);
    }

    if (pkCol && updatableCols.length > 0) {
      crudPyLines.push(`def update_${snake}(db: Session, item_id: ${pkType}, payload: ${pascal}Update) -> ${pascal}Model | None:
    obj = db.get(${pascal}Model, item_id)
    if obj is None:
        return None
    for name, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, name, value)
    db.commit()
    db.refresh(obj)
    return obj
`);
    }

    routerLines.push(`@router.get("/${slug}", response_model=list[crud.${pascal}Read])
def api_list_${snake}(limit: int = 100, db: Session = Depends(get_db)):
    return crud.list_${snake}(db, limit=limit)

@router.post("/${slug}", response_model=crud.${pascal}Read, status_code=status.HTTP_201_CREATED)
def api_create_${snake}(payload: crud.${pascal}Create, db: Session = Depends(get_db)):
    with database_write(db):
        return crud.create_${snake}(db, payload)
`);

    if (pkCol) {
      routerLines.push(`@router.get("/${slug}/{item_id}", response_model=crud.${pascal}Read)
def api_get_${snake}(item_id: ${pkType}, db: Session = Depends(get_db)):
    obj = crud.get_${snake}(db, item_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return obj

@router.delete("/${slug}/{item_id}")
def api_delete_${snake}(item_id: ${pkType}, db: Session = Depends(get_db)):
    with database_write(db):
        if not crud.delete_${snake}(db, item_id):
            raise HTTPException(status_code=404, detail="Record not found")
    return {"ok": True, "deleted_id": item_id}
`);
    }

    if (pkCol && updatableCols.length > 0) {
      routerLines.push(`@router.patch("/${slug}/{item_id}", response_model=crud.${pascal}Read)
def api_update_${snake}(item_id: ${pkType}, payload: crud.${pascal}Update, db: Session = Depends(get_db)):
    with database_write(db):
        obj = crud.update_${snake}(db, item_id, payload)
        if obj is None:
            raise HTTPException(status_code=404, detail="Record not found")
        return obj
`);
    }
  }

  const reqTxt = [
    'fastapi>=0.115.0',
    'uvicorn[standard]>=0.34.0',
    'sqlalchemy>=2.0.38',
    'pydantic>=2.10.0',
    ...(dialect === 'postgresql'
      ? ['psycopg[binary]>=3.2.0']
      : dialect === 'mysql' || dialect === 'mariadb'
        ? ['PyMySQL>=1.1.1']
        : dialect === 'sqlserver'
          ? ['pyodbc>=5.2.0']
          : []),
  ].join('\n') + '\n';

  return [
    makeFile('db/models.py', 'python', modelsPyLines.join('\n'), true),
    makeFile('db/crud.py', 'python', crudPyLines.join('\n')),
    makeFile('routers/db_router.py', 'python', routerLines.join('\n')),
    makeFile(
      'db/schema.sql',
      'sql',
      compileSchemaDdl(doc, { dialect, ifNotExists: true, includeSeeds: includeSeedScript }),
    ),
    makeFile('requirements-db.txt', 'plaintext', reqTxt),
  ];
}

// ============================================================================
// 5. RUST + TAURI v2 (`rust-tauri` — SQLite + `#[tauri::command]`)
// ============================================================================

function rustRawString(value: string): string {
  let hashes = '#';
  while (value.includes(`"${hashes}`)) hashes += '#';
  return `r${hashes}"${value}"${hashes}`;
}

const RUST_KEYWORDS = new Set('as async await break const continue dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return static struct trait true type unsafe use where while abstract become box do final gen macro override priv try typeof unsized virtual yield'.split(' '));

function rustFieldName(name: string): string {
  const normalized = toSnake(name);
  return RUST_KEYWORDS.has(normalized) ? `r#${normalized}` : normalized;
}

function emitRustTauriBundle(
  doc: SqlDesignDocument,
  includeSeedScript: boolean,
  installed = false,
): EmittedCodeFile[] {
  const sqliteDoc = remapDocumentToDialect({ ...doc, name: doc.name.replace(/\s+/g, ' ') }, 'sqlite');
  const ordered = sortTablesTopologically('sqlite', sqliteDoc.tables);
  const schemaSql = compileSchemaDdl(sqliteDoc, {
    dialect: 'sqlite',
    ifNotExists: true,
    includeSeeds: includeSeedScript,
  });
  const prefix = installed ? 'studio_sql_' : '';
  const invokeType = (type: SqlCanonicalType, nullable: boolean): string => {
    const rust = rustTypeForCanonical(type, false);
    const ts = rust === 'Vec<u8>' ? 'number[]' : rust === 'String' ? 'string' : rust === 'bool' ? 'boolean' : 'number';
    return nullable ? `${ts} | null` : ts;
  };

  const rsLines: string[] = [
    `//! Modulo SQLite per Rust e Tauri v2 (${doc.name.replace(/\s+/g, ' ')}).`,
    `use serde::{Deserialize, Serialize};`,
    `use std::sync::Mutex;`,
    `use rusqlite::{params_from_iter, Connection, ToSql};`,
    '',
    `pub struct AppDbState {`,
    `    pub conn: Mutex<Connection>,`,
    `}`,
    '',
    `pub const INIT_SCHEMA_SQL: &str = ${rustRawString(schemaSql.trim())};`,
    '',
    `impl AppDbState {`,
    `    pub fn open_and_migrate(db_path: impl AsRef<std::path::Path>) -> Result<Self, String> {`,
    `        let db_path = db_path.as_ref();`,
    `        if let Some(parent) = db_path.parent().filter(|path| !path.as_os_str().is_empty()) {`,
    `            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;`,
    `        }`,
    `        let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;`,
    `        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")`,
    `            .map_err(|e| e.to_string())?;`,
    `        let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))`,
    `            .map_err(|e| e.to_string())?;`,
    `        if version == 0 {`,
    `            let tx = conn.transaction().map_err(|e| e.to_string())?;`,
    `            tx.execute_batch(INIT_SCHEMA_SQL).map_err(|e| e.to_string())?;`,
    `            tx.pragma_update(None, "user_version", 1).map_err(|e| e.to_string())?;`,
    `            tx.commit().map_err(|e| e.to_string())?;`,
    `        }`,
    `        Ok(Self { conn: Mutex::new(conn) })`,
    `    }`,
    `}`,
    '',
  ];

  const tauriCmdNames: string[] = [];
  const tsClientLines: string[] = [
    `// Wrapper TypeScript tipizzato per i comandi #[tauri::command] SQL (${doc.name.replace(/\s+/g, ' ')})`,
    `import { invoke } from '@tauri-apps/api/core';`,
    '',
  ];

  rsLines.push(`// @studio-tauri-commands:start`);

  for (const tbl of ordered) {
    const pascal = toPascal(tbl.name);
    const snake = toSnake(tbl.name);
    const keys = tbl.columns.filter((c) => c.primaryKey);
    const pkCol = keys.length === 1 ? keys[0] : undefined;
    const pkRustType = rustTypeForCanonical(pkCol?.canonicalType ?? 'integer', false);
    const editableCols = tbl.columns.filter((c) => !c.autoIncrement);
    const updateCols = pkCol ? editableCols.filter((c) => c.id !== pkCol.id) : [];

    // Rust structs
    rsLines.push(`#[derive(Debug, Clone, Serialize, Deserialize)]`);
    rsLines.push(`pub struct ${pascal}Record {`);
    for (const col of tbl.columns) {
      rsLines.push(`    pub ${rustFieldName(col.name)}: ${rustTypeForCanonical(col.canonicalType, col.nullable)},`);
    }
    rsLines.push(`}\n`);
    if (updateCols.length) {
      rsLines.push(`#[derive(Debug, Clone, Serialize, Deserialize)]`);
      rsLines.push(`pub struct Update${pascal}Input {`);
      for (const col of updateCols) {
        rsLines.push(`    pub ${rustFieldName(col.name)}: ${rustTypeForCanonical(col.canonicalType, col.nullable)},`);
      }
      rsLines.push(`}\n`);
    }

    rsLines.push(`#[derive(Debug, Clone, Serialize, Deserialize)]`);
    rsLines.push(`pub struct Create${pascal}Input {`);
    for (const col of editableCols) {
      const optional = col.nullable || col.defaultValue !== undefined;
      rsLines.push(`    pub ${rustFieldName(col.name)}: ${rustTypeForCanonical(col.canonicalType, optional)},`);
    }
    rsLines.push(`}\n`);

    // TS Interfaces
    tsClientLines.push(`export interface ${pascal}Record {`);
    for (const col of tbl.columns) {
      tsClientLines.push(`  ${toSnake(col.name)}: ${invokeType(col.canonicalType, col.nullable)};`);
    }
    tsClientLines.push(`}\n`);

    tsClientLines.push(`export interface Create${pascal}Input {`);
    for (const col of editableCols) {
      const opt = col.nullable || col.defaultValue !== undefined;
      tsClientLines.push(`  ${toSnake(col.name)}${opt ? '?' : ''}: ${invokeType(col.canonicalType, opt)};`);
    }
    tsClientLines.push(`}\n`);
    if (updateCols.length) {
      tsClientLines.push(`export interface Update${pascal}Input {`);
      for (const col of updateCols) tsClientLines.push(`  ${toSnake(col.name)}: ${invokeType(col.canonicalType, col.nullable)};`);
      tsClientLines.push('}\n');
    }

    const qualified = quoteIdentifier(tbl.name, 'sqlite');
    const selectColsSql = tbl.columns.map((c) => quoteIdentifier(c.name, 'sqlite')).join(', ');
    const selectSql = `SELECT ${selectColsSql} FROM ${qualified}${pkCol ? ` ORDER BY ${quoteIdentifier(pkCol.name, 'sqlite')} DESC` : ''}`;
    const rowFieldMappings = tbl.columns
      .map((c, idx) => `            ${rustFieldName(c.name)}: row.get(${idx})?,`)
      .join('\n');

    const insertFields = editableCols.map((column) => {
      const field = `input.${rustFieldName(column.name)}`;
      const quoted = rustRawString(quoteIdentifier(column.name, 'sqlite'));
      return column.defaultValue === undefined
        ? `    columns.push(${quoted});\n    bindings.push(&${field});`
        : `    if let Some(value) = &${field} {\n        columns.push(${quoted});\n        bindings.push(value);\n    }`;
    }).join('\n');

    const listCmd = `${prefix}list_${snake}`;
    const createCmd = `${prefix}create_${snake}`;
    const updateCmd = `${prefix}update_${snake}`;
    const deleteCmd = `${prefix}delete_${snake}`;
    tauriCmdNames.push(listCmd, createCmd);
    if (updateCols.length) tauriCmdNames.push(updateCmd);
    if (pkCol) tauriCmdNames.push(deleteCmd);

    rsLines.push(`#[tauri::command]
pub fn ${listCmd}(state: tauri::State<'_, AppDbState>) -> Result<Vec<${pascal}Record>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(${rustRawString(selectSql)})
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(${pascal}Record {
${rowFieldMappings}
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ${createCmd}(
    state: tauri::State<'_, AppDbState>,
    input: Create${pascal}Input,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut columns: Vec<&str> = Vec::new();
    let mut bindings: Vec<&dyn ToSql> = Vec::new();
${insertFields}
    let sql = if columns.is_empty() {
        ${rustRawString(`INSERT INTO ${qualified} DEFAULT VALUES`)}.to_string()
    } else {
        let placeholders = vec!["?"; columns.len()].join(", ");
        format!(${rustRawString(`INSERT INTO ${qualified.replaceAll('{', '{{').replaceAll('}', '}}')} ({}) VALUES ({})`)}, columns.join(", "), placeholders)
    };
    conn.execute(&sql, params_from_iter(bindings)).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
`);

    if (pkCol && updateCols.length) {
      const setters = updateCols.map((column) => `${quoteIdentifier(column.name, 'sqlite')} = ?`).join(', ');
      const updateSql = `UPDATE ${qualified} SET ${setters} WHERE ${quoteIdentifier(pkCol.name, 'sqlite')} = ?`;
      const values = updateCols.map((column) => `&input.${rustFieldName(column.name)}`).concat('&id');
      rsLines.push(`#[tauri::command]
pub fn ${updateCmd}(
    state: tauri::State<'_, AppDbState>,
    id: ${pkRustType},
    input: Update${pascal}Input,
) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let fields: [&dyn ToSql; ${values.length}] = [${values.join(', ')}];
    conn.execute(${rustRawString(updateSql)}, params_from_iter(fields)).map_err(|e| e.to_string())
}
`);
    }

    if (pkCol) rsLines.push(`#[tauri::command]
pub fn ${deleteCmd}(
    state: tauri::State<'_, AppDbState>,
    id: ${pkRustType},
) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        ${rustRawString(`DELETE FROM ${qualified} WHERE ${quoteIdentifier(pkCol.name, 'sqlite')} = ?1`)},
        [id],
    )
    .map_err(|e| e.to_string())
}
`);

    tsClientLines.push(`export const ${toCamel(tbl.name)}TauriDb = {
  list: () => invoke<${pascal}Record[]>('${listCmd}'),
  create: (input: Create${pascal}Input) => invoke<number>('${createCmd}', { input }),
${pkCol && updateCols.length ? `  update: (id: ${invokeType(pkCol.canonicalType, false)}, input: Update${pascal}Input) => invoke<number>('${updateCmd}', { id, input }),\n` : ''}${pkCol ? `  remove: (id: ${invokeType(pkCol.canonicalType, false)}) => invoke<number>('${deleteCmd}', { id }),\n` : ''}
};
`);
  }

  rsLines.push(`// @studio-tauri-commands:end`);
  if (installed) {
    return [
      makeFile(RUST_TAURI_SQL_PATHS.rustModule, 'rust', rsLines.join('\n'), true),
      makeFile(RUST_TAURI_SQL_PATHS.client, 'typescript', tsClientLines.join('\n')),
      makeFile(RUST_TAURI_SQL_PATHS.schema, 'sql', schemaSql),
    ];
  }
  rsLines.push(`
// Registra questi handler in \`src-tauri/src/lib.rs\`:
// // @studio-tauri-handlers:start
// tauri::generate_handler![${tauriCmdNames.map((n) => `db::${n}`).join(', ')}]
// // @studio-tauri-handlers:end
`);

  const cargoSnippet = `# Dipendenze Cargo da unire in src-tauri/Cargo.toml:
[dependencies]
rusqlite = { version = "0.33", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
`;

  return [
    makeFile('src-tauri/src/db.rs', 'rust', rsLines.join('\n'), true),
    makeFile('src/lib/tauri-db-client.ts', 'typescript', tsClientLines.join('\n')),
    makeFile('src-tauri/src/db/schema.sql', 'sql', schemaSql),
    makeFile('src-tauri/Cargo.db.toml', 'toml', cargoSnippet),
  ];
}

export function generateRustTauriSqlInstallBundle(req: GenerateSqlCodeRequest): TargetArtifactBundle {
  const diagnostics: CodeDiagnostic[] = [];
  if (!req.schema.tables.length) diagnostics.push({ severity: 'error', message: 'Lo schema deve contenere almeno una tabella.' });
  if (req.schema.tables.some((table) => table.columns.length === 0)) {
    diagnostics.push({ severity: 'error', message: 'Le tabelle del modulo Rust devono contenere almeno una colonna.' });
  }
  if (req.schema.tables.some((table) => table.columns.filter((column) => column.primaryKey).length > 1)) {
    diagnostics.push({ severity: 'error', message: 'Il modulo CRUD automatico richiede chiavi primarie semplici.' });
  }
  const isAmbiguous = (names: string[]) => {
    const keys = names.map(toSnake);
    return new Set(keys).size !== keys.length || keys.some((name) => !/^[a-z_][a-z0-9_]*$/.test(name));
  };
  if (isAmbiguous(req.schema.tables.map((table) => table.name)) || req.schema.tables.some((table) =>
    isAmbiguous(table.columns.map((column) => column.name)) || table.columns.some((column) => ['self', 'super', 'crate'].includes(toSnake(column.name))))) {
    diagnostics.push({ severity: 'error', message: 'Usa nomi di tabelle e colonne univoci, che possano essere convertiti in identificatori Rust.' });
  }
  let files: EmittedCodeFile[] = [];
  if (!diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    try {
      files = emitRustTauriBundle(req.schema, Boolean(req.includeSeedScript), true);
    } catch (error) {
      diagnostics.push({ severity: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    targetId: 'tauri-v2', dialect: 'vanilla-css', mode: 'bundle',
    entryFilePath: RUST_TAURI_SQL_PATHS.rustModule, files, diagnostics, generatedAt: Date.now(),
  };
}

// ============================================================================
// PUBLIC ENTRYPOINT (`generateSqlCodeBundle`)
// ============================================================================

export function generateSqlCodeBundle(req: GenerateSqlCodeRequest): TargetArtifactBundle {
  const dialect: SqlDialect = req.dialect ?? req.schema.dialect;
  const includeRestRoutes = req.includeRestRoutes !== false;
  const includeSeedScript = Boolean(req.includeSeedScript);

  let files: EmittedCodeFile[];
  let targetId: CodegenTargetId = 'html-vanilla';
  const diagnostics: CodeDiagnostic[] = [];

  switch (req.targetKind) {
    case 'js-node':
      files = emitJavaScriptNodeBundle(req.schema, dialect, includeRestRoutes, includeSeedScript);
      targetId = 'html-vanilla';
      break;
    case 'ts-drizzle':
      files = emitDrizzleBundle(req.schema, dialect, includeSeedScript);
      targetId = 'react-tsx';
      break;
    case 'ts-prisma':
      files = emitPrismaBundle(req.schema, dialect);
      targetId = 'react-tsx';
      break;
    case 'ts-kysely': {
      const incompatibleName = firstUnsupportedKyselyIdentifier(req.schema, dialect);
      if (incompatibleName) {
        const sql = compileSchemaDdl(req.schema, { dialect, ifNotExists: true, includeSeeds: includeSeedScript });
        files = [makeFile('db/schema.sql', 'sql', sql, true)];
        diagnostics.push({ severity: 'error', message: `Per generare il client Kysely, rinomina l'identificatore «${incompatibleName}». I nomi di schema, tabella e colonna devono essere privi di punti e della sequenza « as ».` });
      } else {
        files = emitKyselyBundle(req.schema, dialect, includeSeedScript);
        diagnostics.push({ severity: 'info', message: describeKyselySetup(dialect) });
      }
      break;
    }
    case 'ts-nextjs':
      files = emitNextJsSqlBundle(req.schema, dialect, includeSeedScript);
      targetId = 'nextjs-app';
      break;
    case 'python-fastapi': {
      files = emitPythonFastApiBundle(req.schema, dialect, includeSeedScript);
      targetId = 'htmx';
      diagnostics.push({ severity: 'info', message: 'Installa requirements-db.txt, chiama db.crud.init_db() all’avvio e registra routers.db_router.router nell’app FastAPI.' });
      const onlyDdl = req.schema.tables.filter((table) => !table.columns.some((column) => column.primaryKey));
      if (onlyDdl.length > 0) diagnostics.push({ severity: 'warn', message: `SQLAlchemy richiede una chiave primaria. Queste tabelle sono incluse nel DDL: ${onlyDdl.map((table) => table.name).join(', ')}.` });
      const composite = req.schema.tables.filter((table) => table.columns.filter((column) => column.primaryKey).length > 1);
      if (composite.length > 0) diagnostics.push({ severity: 'info', message: `Per le chiavi primarie composte vengono generate le route elenco e creazione: ${composite.map((table) => table.name).join(', ')}.` });
      break;
    }
    case 'rust-tauri':
      files = emitRustTauriBundle(req.schema, includeSeedScript);
      targetId = 'tauri-v2';
      if (dialect !== 'sqlite') diagnostics.push({ severity: 'warn', message: 'Il modulo Rust/Tauri usa SQLite. Lo schema è stato convertito per questo motore.' });
      diagnostics.push({ severity: 'info', message: 'Integra le dipendenze Cargo e registra AppDbState e i comandi in src-tauri/src/lib.rs.' });
      break;
    default:
      files = emitJavaScriptNodeBundle(req.schema, dialect, includeRestRoutes, includeSeedScript);
      break;
  }

  return {
    targetId,
    dialect: 'vanilla-css',
    mode: 'bundle',
    entryFilePath: files[0].relativePath,
    files,
    diagnostics,
    generatedAt: Date.now(),
  };
}
