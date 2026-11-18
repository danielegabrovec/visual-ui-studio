/**
 * Multi-Dialect SQL Execution, Introspection, Sandbox & Migration Engine (`db-worker`).
 *
 * Execution Tiers:
 *   1. `:memory:` *Query Rapide* Sandbox (`node:sqlite` `DatabaseSync`) — transpiles ANY of the 5 dialects
 *      into an isolated in-memory SQLite database seeded with `SqlDesignDocument` tables & `seedRows`.
 *   2. Project-local `.sqlite` / `.db` files (`node:sqlite` `DatabaseSync` with WAL + `foreign_keys = ON`
 *      + 16-byte SQLite header check + full schema/view/trigger introspection).
 *   3. Live Remote SQL Servers via pure-JS drivers:
 *        - PostgreSQL (`pg`)
 *        - MySQL / MariaDB (`mysql2/promise`)
 *        - SQL Server T-SQL (`mssql`)
 */

import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  adaptParameterizedSqlForSqlite,
  compileDmlStatements,
  compileSqliteSandboxStatements,
  defaultSchemaForDialect,
  equalSqlIdentifiers,
  formatSqlLiteral,
  inferCanonicalType,
  parseTypeDimensions,
  resolveEffectiveSchema,
} from '../../shared/sql-dialects';
import type {
  SqlCanonicalType,
  SqlCellType,
  SqlCellValue,
  SqlCheckConstraintDef,
  SqlColumnDef,
  SqlConnectionProfile,
  SqlDataChange,
  SqlDataRow,
  SqlDesignDocument,
  SqlDialect,
  SqlForeignKeyDef,
  SqlIndexDef,
  SqlMigrationPlan,
  SqlQueryRequest,
  SqlQueryResult,
  SqlResultColumnMeta,
  SqlTableDef,
  SqlTableSnapshot,
} from '../../shared/sql-ir';
import { explainSqlErrorInItalian, explainSqlInItalian, maskSqlNonCode, splitSqlStatements, tokenizeSql } from '../../shared/sql-language';
import { buildSqlMigrationPlan, createBaselineSnapshotFromTable } from '../../shared/sql-migration';

const SQLITE_MAGIC_HEADER = 'SQLite format 3\0';
const DEFAULT_MAX_ROWS = 5_000;

function normalizeMysqlColumnDefault(
  raw: unknown,
  canonicalType: SqlCanonicalType,
  extra: string,
  noBackslashEscapes: boolean,
): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = String(raw);
  if (canonicalType === 'datetime' && /^current_timestamp(?:\(\d*\))?$/i.test(value)) {
    return /^current_timestamp\(\)$/i.test(value) ? 'CURRENT_TIMESTAMP' : value.toUpperCase();
  }
  if (/\bDEFAULT_GENERATED\b/i.test(extra)) {
    return value.startsWith('(') && value.endsWith(')') ? value : `(${value})`;
  }
  if (['integer', 'bigint', 'decimal', 'float', 'boolean'].includes(canonicalType)) return value;
  return formatSqlLiteral(noBackslashEscapes ? value : value.replace(/\\/g, '\\\\'), 'mysql', canonicalType);
}

function isMissingConnection(connectionId?: string | null, profile?: SqlConnectionProfile | null): boolean {
  return Boolean(connectionId && connectionId !== '__memory_sandbox__' && connectionId !== '__local_sqlite__' && !profile);
}

function checkedGridRowCount(kind: SqlDataChange['kind'], count: number): number {
  if (kind !== 'insert' && count > 1) {
    throw new Error('La chiave ha identificato più righe. Le modifiche della griglia sono state annullate.');
  }
  return count;
}

function sqliteSchemaFingerprint(db?: DatabaseSync): string {
  const definitions = db?.prepare(`
    SELECT type, name, tbl_name, sql FROM main.sqlite_schema
    WHERE name NOT GLOB 'sqlite_*'
    ORDER BY type, name
  `).all() ?? [];
  return createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
}

function getSqlCommand(tokens: ReturnType<typeof tokenizeSql>): string | undefined {
  const command = tokens[0]?.value.toUpperCase();
  if (command !== 'WITH') return command;
  let depth = 0;
  for (const token of tokens.slice(1)) {
    if (token.kind === 'symbol' && token.value === '(') depth++;
    if (token.kind === 'symbol' && token.value === ')') depth--;
    const word = token.value.toUpperCase();
    if (depth === 0 && token.kind === 'word' && ['SELECT', 'VALUES', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(word)) {
      return word;
    }
  }
  return command;
}

interface SandboxSession {
  db: DatabaseSync;
  schemaSignature: string;
}

function inferCellTypeFromValue(val: unknown): SqlCellType {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'bigint') return 'integer';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? 'integer' : 'float';
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) return 'binary';
  if (val instanceof Date) return 'datetime';
  return 'text';
}

function normalizeDriverCellValue(val: unknown): SqlCellValue {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'bigint') {
    const asNum = Number(val);
    return Number.isSafeInteger(asNum) ? asNum : val.toString();
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : String(val);
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return `<BLOB ${val.byteLength}B: 0x${Buffer.from(val.slice(0, 16)).toString('hex')}>`;
  }
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function verifySqliteFileHeaderIfExisting(filePath: string): void {
  if (!existsSync(filePath)) return;
  const st = statSync(filePath);
  if (st.size === 0) return;
  if (st.size < 16) {
    throw new Error(`Il file "${filePath}" non è un database SQLite 3 valido (dimensione < 16 byte).`);
  }
  const buf = Buffer.alloc(16);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buf, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  if (buf.toString('latin1') !== SQLITE_MAGIC_HEADER) {
    throw new Error(`Il file "${filePath}" non presenta l'intestazione binaria SQLite 3.`);
  }
}

export class SqlStudioEngine {
  private readonly sandboxes = new Map<string, SandboxSession>();

  public closeAll(): void {
    for (const session of this.sandboxes.values()) {
      try {
        session.db.close();
      } catch {
        // ignore
      }
    }
    this.sandboxes.clear();
  }

  private computeSandboxSignature(doc: SqlDesignDocument): string {
    return JSON.stringify({
      tables: doc.tables.map((t) => ({
        name: t.name,
        columns: t.columns,
        foreignKeys: t.foreignKeys,
        indexes: t.indexes,
        checks: t.checks,
      })),
    });
  }

  public ensureSandboxDb(projectId: string, schemaDoc: SqlDesignDocument, forceReset = false): DatabaseSync {
    const sig = this.computeSandboxSignature(schemaDoc);
    const existing = this.sandboxes.get(projectId);
    if (existing && !forceReset && existing.schemaSignature === sig) {
      return existing.db;
    }

    if (existing) {
      try {
        existing.db.close();
      } catch {
        // ignore
      }
      this.sandboxes.delete(projectId);
    }

    const db = new DatabaseSync(':memory:');
    try {
      for (const stmt of compileSqliteSandboxStatements(schemaDoc)) db.exec(stmt);
    } catch (error) {
      db.close();
      throw error;
    }
    this.sandboxes.set(projectId, { db, schemaSignature: sig });
    return db;
  }

  public resetSandbox(projectId: string, schemaDoc: SqlDesignDocument): { ok: boolean; message: string } {
    try {
      this.ensureSandboxDb(projectId, schemaDoc, true);
      return {
        ok: true,
        message: `Sandbox :memory: ripristinata con ${schemaDoc.tables.length} tabelle (${schemaDoc.dialect}).`,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  public resolveLocalSqlitePath(
    profile: SqlConnectionProfile | undefined,
    rootDiskPath: string | null,
    storageProjectDir: string,
    schemaDoc?: SqlDesignDocument,
  ): string {
    const rawPath = profile?.sqliteFilePath?.trim() || schemaDoc?.databaseFileRelPath?.trim() || 'data/app.sqlite';
    if (isAbsolute(rawPath)) {
      return resolve(rawPath);
    }
    if (rootDiskPath) {
      return join(rootDiskPath, rawPath);
    }
    return join(storageProjectDir, rawPath);
  }

  private openLocalSqliteDb(
    filePath: string,
    readOnly = false,
    seedSchemaIfBrandNew?: SqlDesignDocument,
  ): DatabaseSync {
    const existed = existsSync(filePath) && statSync(filePath).size > 0;
    if (existed) {
      verifySqliteFileHeaderIfExisting(filePath);
    } else if (readOnly) {
      throw new Error(`File SQLite non trovato in modalità sola lettura: ${filePath}`);
    } else {
      mkdirSync(dirname(filePath), { recursive: true });
    }

    const db = new DatabaseSync(filePath, { readOnly });
    if (!readOnly) {
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
      `);
      if (seedSchemaIfBrandNew) {
        // Seed only brand-new OR completely empty databases (zero user tables) — never touches populated files.
        const userTableRow = existed
          ? (db
              .prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
              .get() as { n?: number } | undefined)
          : { n: 0 };
        if (Number(userTableRow?.n ?? 0) === 0) {
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const stmt of compileSqliteSandboxStatements(seedSchemaIfBrandNew)) db.exec(stmt);
            db.exec('COMMIT');
          } catch (error) {
            db.close();
            throw error;
          }
        }
      }
    } else {
      db.exec('PRAGMA query_only = ON;');
    }
    return db;
  }

  public introspectSqliteDb(db: DatabaseSync, projectId: string, dbName = 'SQLite Database'): SqlDesignDocument {
    const tblRows = db
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__dbm_migrate_%'
         ORDER BY name ASC`,
      )
      .all() as Array<{ name: string; sql: string | null }>;

    const viewOrTriggerRow = db
      .prepare("SELECT 1 AS has_dep FROM sqlite_schema WHERE type IN ('view', 'trigger') LIMIT 1")
      .get() as { has_dep?: number } | undefined;
    const hasViewsOrTriggers = Boolean(viewOrTriggerRow?.has_dep);

    const tables: SqlTableDef[] = tblRows.map((tr, idx) => {
      const safeQuote = `"${tr.name.replace(/"/g, '""')}"`;
      const xinfo = db.prepare(`PRAGMA table_xinfo(${safeQuote})`).all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
        hidden: number;
      }>;

      const hasGeneratedColumns = xinfo.some((c) => c.hidden === 2 || c.hidden === 3);
      const visibleCols = xinfo.filter((c) => c.hidden === 0);
      const isAutoInc = /\bAUTOINCREMENT\b/i.test(tr.sql ?? '');

      const columns: SqlColumnDef[] = visibleCols.map((c) => {
        const nativeType = c.type || 'TEXT';
        const canonicalType = inferCanonicalType(nativeType);
        const dims = parseTypeDimensions(nativeType);
        const isPk = c.pk > 0;
        return {
          id: `col_${tr.name}_${c.name}`,
          name: c.name,
          sourceName: c.name,
          canonicalType,
          nativeType,
          ...dims,
          nullable: c.notnull === 0 && !isPk,
          primaryKey: isPk,
          unique: isPk && visibleCols.filter((x) => x.pk > 0).length === 1,
          autoIncrement: isPk && isAutoInc && canonicalType === 'integer',
          defaultValue: c.dflt_value ?? undefined,
        };
      });

      // Foreign keys
      const fkRows = db.prepare(`PRAGMA foreign_key_list(${safeQuote})`).all() as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
      }>;
      const fkGroups = new Map<number, typeof fkRows>();
      for (const r of fkRows) {
        if (!fkGroups.has(r.id)) fkGroups.set(r.id, []);
        fkGroups.get(r.id)!.push(r);
      }
      const foreignKeys: SqlForeignKeyDef[] = [...fkGroups.entries()].map(([fkId, list]) => {
        const sorted = list.sort((a, b) => a.seq - b.seq);
        const first = sorted[0];
        return {
          id: `fk_${tr.name}_${fkId}`,
          name: `fk_${tr.name}_${sorted.map((s) => s.from).join('_')}`,
          columns: sorted.map((s) => s.from),
          referencedTable: first.table,
          referencedColumns: sorted.map((s) => s.to || 'id'),
          onDelete: (first.on_delete?.toUpperCase() as SqlForeignKeyDef['onDelete']) || 'NO ACTION',
          onUpdate: (first.on_update?.toUpperCase() as SqlForeignKeyDef['onUpdate']) || 'NO ACTION',
        };
      });

      // Indexes
      const idxList = db.prepare(`PRAGMA index_list(${safeQuote})`).all() as Array<{
        seq: number;
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }>;
      const indexes: SqlIndexDef[] = [];
      for (const il of idxList) {
        if (il.origin === 'pk') continue;
        const safeIdxQuote = `"${il.name.replace(/"/g, '""')}"`;
        const idxCols = (
          db.prepare(`PRAGMA index_info(${safeIdxQuote})`).all() as Array<{ seqno: number; name: string | null }>
        )
          .filter((ic) => Boolean(ic.name))
          .map((ic) => ic.name!);
        if (il.unique === 1 && idxCols.length === 1) {
          const colMatch = columns.find((c) => c.name === idxCols[0]);
          if (colMatch) colMatch.unique = true;
        }
        if (!il.name.startsWith('sqlite_autoindex_')) {
          indexes.push({
            id: `idx_${il.name}`,
            name: il.name,
            columns: idxCols,
            unique: il.unique === 1,
          });
        }
      }

      const checks: SqlCheckConstraintDef[] = [];
      const colPos = idx % 3;
      const rowPos = Math.floor(idx / 3);
      const table: SqlTableDef = {
        id: `tbl_${tr.name}`,
        name: tr.name,
        columns,
        foreignKeys,
        indexes,
        checks,
        position: { x: 64 + colPos * 390, y: 64 + rowPos * 320 },
      };
      table.baselineSnapshot = {
        ...createBaselineSnapshotFromTable(table),
        hasDependentViewsOrTriggers: hasViewsOrTriggers,
        hasGeneratedColumns,
      };
      return table;
    });

    return {
      version: 1,
      id: `sql_${projectId}`,
      projectId,
      name: dbName,
      dialect: 'sqlite',
      tables,
      namedQueries: [],
      seedRows: [],
      updatedAt: Date.now(),
    };
  }

  private executeOnSqliteDb(
    db: DatabaseSync,
    req: SqlQueryRequest,
    effectiveDialect: SqlDialect,
    schemaDoc?: SqlDesignDocument,
    isSandbox = false,
  ): SqlQueryResult {
    const started = Date.now();
    const maxRows = req.maxRows ?? DEFAULT_MAX_ROWS;
    const explanation = explainSqlInItalian(req.sql, effectiveDialect, schemaDoc).summary;

    try {
      const statements = splitSqlStatements(req.sql, effectiveDialect);
      if (statements.length === 0) {
        return {
          ok: true,
          dialect: effectiveDialect,
          columns: [],
          rows: [],
          rowCount: 0,
          durationMs: Date.now() - started,
          executedSql: req.sql,
          explanation,
        };
      }

      let lastResult: SqlQueryResult | null = null;
      let totalAffected = 0;

      for (const singleSql of statements) {
        const adapted = adaptParameterizedSqlForSqlite(singleSql, req.parameters, effectiveDialect, maskSqlNonCode);
        const tokens = tokenizeSql(adapted.sql).filter((token) => token.kind !== 'comment');
        const command = getSqlCommand(tokens) ?? '';
        if (isSandbox && ['ATTACH', 'DETACH', 'VACUUM', 'PRAGMA'].includes(command)) {
          throw new Error('Istruzione non disponibile nella sandbox :memory:.');
        }
        const isRead = ['SELECT', 'PRAGMA', 'WITH', 'EXPLAIN', 'VALUES'].includes(command);

        if (req.readOnly && !['SELECT', 'EXPLAIN', 'VALUES'].includes(command)) {
          throw new Error('Modalità sola lettura attiva: le istruzioni di scrittura/DDL sono bloccate.');
        }

        const stmt = db.prepare(adapted.sql);
        stmt.setReadBigInts(true);
        const statementColumns = stmt.columns?.();
        if (statementColumns ? statementColumns.length > 0 : isRead) {
          const sliced: Array<Record<string, unknown>> = [];
          let truncated = false;
          for (const row of stmt.iterate(...adapted.bindings)) {
            if (sliced.length >= maxRows) {
              truncated = true;
              break;
            }
            sliced.push(row);
          }

          // Match column metadata from schemaDoc if possible
          const fromMatch = singleSql.match(/\bFROM\s+["`[]?([a-zA-Z0-9_]+)["`\]]?/i);
          const targetTbl = fromMatch?.[1]
            ? schemaDoc?.tables.find((t) => equalSqlIdentifiers(effectiveDialect, t.name, fromMatch[1]))
            : undefined;

          const colKeys = statementColumns
            ? statementColumns.map((column) => column.name)
            : sliced.length > 0
              ? Object.keys(sliced[0])
              : targetTbl
                ? targetTbl.columns.map((c) => c.name)
                : [];

          const columns: SqlResultColumnMeta[] = colKeys.map((name) => {
            const schemaCol = targetTbl?.columns.find((c) => equalSqlIdentifiers(effectiveDialect, c.name, name));
            const sampleVal = sliced.find((r) => r[name] !== null && r[name] !== undefined)?.[name];
            return {
              name,
              nativeType: schemaCol?.nativeType,
              cellType: inferCellTypeFromValue(sampleVal),
              primaryKey: schemaCol?.primaryKey,
              nullable: schemaCol?.nullable,
            };
          });

          const rows: SqlDataRow[] = sliced.map((r) => {
            const out: SqlDataRow = {};
            for (const k of colKeys) {
              out[k] = normalizeDriverCellValue(r[k]);
            }
            return out;
          });

          lastResult = {
            ok: true,
            dialect: effectiveDialect,
            columns,
            rows,
            rowCount: rows.length,
            truncated,
            durationMs: Date.now() - started,
            executedSql: singleSql,
            explanation,
          };
        } else {
          const runRes = stmt.run(...adapted.bindings);
          const changesCount = Number(runRes.changes ?? 0);
          totalAffected += changesCount;
          lastResult = {
            ok: true,
            dialect: effectiveDialect,
            columns: [],
            rows: [],
            rowCount: 0,
            affectedRows: totalAffected,
            lastInsertId:
              runRes.lastInsertRowid !== undefined ? normalizeDriverCellValue(runRes.lastInsertRowid) as string | number : null,
            durationMs: Date.now() - started,
            executedSql: singleSql,
            explanation,
          };
        }
      }

      return (
        lastResult ?? {
          ok: true,
          dialect: effectiveDialect,
          columns: [],
          rows: [],
          rowCount: 0,
          durationMs: Date.now() - started,
          executedSql: req.sql,
          explanation,
        }
      );
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const hints = explainSqlErrorInItalian(rawMsg, effectiveDialect);
      return {
        ok: false,
        dialect: effectiveDialect,
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - started,
        executedSql: req.sql,
        explanation: hints[0],
        error: rawMsg,
      };
    }
  }

  // ==========================================================================
  // REMOTE PURE-JS CONNECTORS (`pg`, `mysql2/promise`, `mssql`)
  // ==========================================================================

  private async withPostgresClient<T>(
    profile: SqlConnectionProfile,
    secret: string | null | undefined,
    fn: (client: import('pg').Client) => Promise<T>,
  ): Promise<T> {
    const pgMod = await import('pg');
    const ClientCtor = pgMod.Client ?? (pgMod as any).default?.Client;
    const isConnUri = secret && /^postgres(?:ql)?:\/\//i.test(secret.trim());
    const client = new ClientCtor(
      isConnUri
        ? {
            connectionString: secret!.trim(),
            ssl: profile.ssl ? { rejectUnauthorized: true } : undefined,
            connectionTimeoutMillis: 6_000,
          }
        : {
            host: profile.host || '127.0.0.1',
            port: profile.port || 5432,
            database: profile.database || 'postgres',
            user: profile.username || 'postgres',
            password: secret ?? undefined,
            ssl: profile.ssl ? { rejectUnauthorized: true } : undefined,
            connectionTimeoutMillis: 6_000,
          },
    );
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  private async withMysqlConnection<T>(
    profile: SqlConnectionProfile,
    secret: string | null | undefined,
    fn: (conn: import('mysql2/promise').Connection) => Promise<T>,
  ): Promise<T> {
    const mysqlMod = await import('mysql2/promise');
    const createConn = mysqlMod.createConnection ?? (mysqlMod as any).default?.createConnection;
    const isUri = secret && /^mysql:\/\//i.test(secret.trim());
    const conn = isUri
      ? await createConn(secret!.trim())
      : await createConn({
          host: profile.host || '127.0.0.1',
          port: profile.port || 3306,
          database: profile.database || undefined,
          user: profile.username || 'root',
          password: secret ?? undefined,
          ssl: profile.ssl ? { rejectUnauthorized: true } : undefined,
          connectTimeout: 6_000,
          supportBigNumbers: true,
          bigNumberStrings: true,
        });
    try {
      return await fn(conn);
    } finally {
      await conn.end().catch(() => {});
    }
  }

  private async withMssqlPool<T>(
    profile: SqlConnectionProfile,
    secret: string | null | undefined,
    fn: (pool: import('mssql').ConnectionPool, mssqlMod: typeof import('mssql')) => Promise<T>,
  ): Promise<T> {
    const mssqlMod = await import('mssql');
    const PoolCtor = mssqlMod.ConnectionPool ?? (mssqlMod as any).default?.ConnectionPool;
    const pool = new PoolCtor({
      server: profile.host || '127.0.0.1',
      port: profile.port || 1433,
      database: profile.database || 'master',
      user: profile.username || 'sa',
      password: secret ?? '',
      connectionTimeout: 6_000,
      requestTimeout: 15_000,
      options: {
        encrypt: Boolean(profile.ssl),
        trustServerCertificate: !profile.ssl,
      },
    });
    await pool.connect();
    try {
      return await fn(pool, mssqlMod);
    } finally {
      await pool.close().catch(() => {});
    }
  }

  public async testConnection(input: {
    profile: SqlConnectionProfile;
    decryptedSecret?: string | null;
    rootDiskPath: string | null;
    storageProjectDir: string;
  }): Promise<{ ok: boolean; message: string; version?: string; latencyMs?: number }> {
    const { profile, decryptedSecret, rootDiskPath, storageProjectDir } = input;
    const started = Date.now();

    try {
      if (profile.mode === 'memory_sandbox') {
        return {
          ok: true,
          message: 'Sandbox SQLite :memory: attiva e pronta.',
          version: 'SQLite 3 (:memory:)',
          latencyMs: Date.now() - started,
        };
      }

      if (profile.mode === 'local_sqlite' || profile.dialect === 'sqlite') {
        const targetPath = this.resolveLocalSqlitePath(profile, rootDiskPath, storageProjectDir);
        const db = this.openLocalSqliteDb(targetPath, Boolean(profile.readOnly));
        try {
          const verRow = db.prepare('SELECT sqlite_version() AS ver').get() as { ver: string };
          return {
            ok: true,
            message: `Connesso a SQLite locale (${targetPath})`,
            version: `SQLite ${verRow.ver}`,
            latencyMs: Date.now() - started,
          };
        } finally {
          db.close();
        }
      }

      if (profile.dialect === 'postgresql') {
        return await this.withPostgresClient(profile, decryptedSecret, async (client) => {
          const res = await client.query('SELECT version() AS ver');
          const ver = String(res.rows[0]?.ver ?? 'PostgreSQL').split(',')[0];
          return {
            ok: true,
            message: `Connesso a PostgreSQL (${profile.host}:${profile.port ?? 5432}/${profile.database})`,
            version: ver,
            latencyMs: Date.now() - started,
          };
        });
      }

      if (profile.dialect === 'mysql' || profile.dialect === 'mariadb') {
        return await this.withMysqlConnection(profile, decryptedSecret, async (conn) => {
          const [rows] = await conn.query('SELECT VERSION() AS ver');
          const first = Array.isArray(rows) ? (rows[0] as Record<string, any>) : undefined;
          const ver = String(first?.ver ?? profile.dialect);
          return {
            ok: true,
            message: `Connesso a ${profile.dialect === 'mariadb' ? 'MariaDB' : 'MySQL'} (${ver})`,
            version: ver,
            latencyMs: Date.now() - started,
          };
        });
      }

      if (profile.dialect === 'sqlserver') {
        return await this.withMssqlPool(profile, decryptedSecret, async (pool) => {
          const res = await pool.request().query('SELECT @@VERSION AS ver');
          const ver = String(res.recordset?.[0]?.ver ?? 'SQL Server').split('\n')[0].trim();
          return {
            ok: true,
            message: `Connesso a SQL Server (${profile.host}:${profile.port ?? 1433})`,
            version: ver,
            latencyMs: Date.now() - started,
          };
        });
      }

      return { ok: false, message: `Dialetto non supportato: ${profile.dialect}` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started,
      };
    }
  }

  public async introspectConnection(input: {
    profile: SqlConnectionProfile;
    decryptedSecret?: string | null;
    rootDiskPath: string | null;
    storageProjectDir: string;
  }): Promise<SqlDesignDocument> {
    const { profile, decryptedSecret, rootDiskPath, storageProjectDir } = input;

    if (profile.mode === 'local_sqlite' || profile.dialect === 'sqlite') {
      const targetPath = this.resolveLocalSqlitePath(profile, rootDiskPath, storageProjectDir);
      const db = this.openLocalSqliteDb(targetPath, true);
      try {
        return this.introspectSqliteDb(db, profile.projectId, profile.name);
      } finally {
        db.close();
      }
    }

    if (profile.dialect === 'postgresql') {
      return this.withPostgresClient(profile, decryptedSecret, async (client) => {
        const tblRes = await client.query(`
          SELECT table_schema, table_name
          FROM information_schema.tables
          WHERE table_type = 'BASE TABLE'
            AND table_schema NOT IN ('pg_catalog', 'information_schema')
          ORDER BY table_schema, table_name
        `);
        const colRes = await client.query(`
          SELECT table_schema, table_name, column_name, data_type, udt_name,
                 character_maximum_length, numeric_precision, numeric_scale,
                 is_nullable, column_default, is_identity
          FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          ORDER BY table_schema, table_name, ordinal_position
        `);
        const pkFkRes = await client.query(`
          SELECT tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
                 kcu.column_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          LEFT JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
          WHERE tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
            AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        `);

        const tables: SqlTableDef[] = tblRes.rows.map((tr: any, idx: number) => {
          const tSchema = String(tr.table_schema);
          const tName = String(tr.table_name);
          const constraints = pkFkRes.rows.filter(
            (r: any) => r.table_schema === tSchema && r.table_name === tName,
          );
          const pkCols = new Set(
            constraints.filter((c: any) => c.constraint_type === 'PRIMARY KEY').map((c: any) => String(c.column_name)),
          );
          const uqCols = new Set(
            constraints.filter((c: any) => c.constraint_type === 'UNIQUE').map((c: any) => String(c.column_name)),
          );

          const cols: SqlColumnDef[] = colRes.rows
            .filter((cr: any) => cr.table_schema === tSchema && cr.table_name === tName)
            .map((cr: any) => {
              const colName = String(cr.column_name);
              const rawType = String(cr.data_type === 'USER-DEFINED' ? cr.udt_name : cr.data_type).toUpperCase();
              const isSerialDefault = /nextval\(/i.test(String(cr.column_default ?? ''));
              const canonicalType = inferCanonicalType(rawType);
              return {
                id: `col_${tName}_${colName}`,
                name: colName,
                sourceName: colName,
                canonicalType,
                nativeType: cr.character_maximum_length ? `VARCHAR(${cr.character_maximum_length})` : rawType,
                length: cr.character_maximum_length ? Number(cr.character_maximum_length) : undefined,
                precision: cr.numeric_precision ? Number(cr.numeric_precision) : undefined,
                scale: cr.numeric_scale ? Number(cr.numeric_scale) : undefined,
                nullable: cr.is_nullable === 'YES' && !pkCols.has(colName),
                primaryKey: pkCols.has(colName),
                unique: uqCols.has(colName) || pkCols.has(colName),
                autoIncrement: cr.is_identity === 'YES' || isSerialDefault,
                defaultValue: isSerialDefault ? undefined : (cr.column_default ? String(cr.column_default) : undefined),
              };
            });

          const fks: SqlForeignKeyDef[] = constraints
            .filter((c: any) => c.constraint_type === 'FOREIGN KEY' && c.ref_table)
            .map((c: any, fkIdx: number) => ({
              id: `fk_${tName}_${fkIdx}`,
              name: String(c.constraint_name),
              columns: [String(c.column_name)],
              referencedSchema: String(c.ref_schema || 'public'),
              referencedTable: String(c.ref_table),
              referencedColumns: [String(c.ref_column || 'id')],
            }));

          const tbl: SqlTableDef = {
            id: `tbl_${tSchema}_${tName}`,
            schema: tSchema,
            name: tName,
            columns: cols,
            foreignKeys: fks,
            indexes: [],
            checks: [],
            position: { x: 64 + (idx % 3) * 390, y: 64 + Math.floor(idx / 3) * 320 },
          };
          tbl.baselineSnapshot = createBaselineSnapshotFromTable(tbl);
          return tbl;
        });

        return {
          version: 1,
          id: `sql_${profile.projectId}`,
          projectId: profile.projectId,
          name: profile.name,
          dialect: 'postgresql',
          tables,
          namedQueries: [],
          seedRows: [],
          updatedAt: Date.now(),
        };
      });
    }

    if (profile.dialect === 'mysql' || profile.dialect === 'mariadb') {
      return this.withMysqlConnection(profile, decryptedSecret, async (conn) => {
        const [session] = profile.dialect === 'mysql'
          ? await conn.query<import('mysql2').RowDataPacket[]>('SELECT @@SESSION.sql_mode AS sql_mode')
          : [[]];
        const noBackslashEscapes = String(session[0]?.sql_mode ?? '').split(',').includes('NO_BACKSLASH_ESCAPES');
        const [tblRows] = await conn.query(
          `SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
        );
        const [colRows] = await conn.query(
          `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_KEY AS column_key, COLUMN_DEFAULT AS column_default, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        );
        const [fkRows] = await conn.query(
          `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name, COLUMN_NAME AS column_name, REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
        );

        const tList = Array.isArray(tblRows) ? (tblRows as any[]) : [];
        const cList = Array.isArray(colRows) ? (colRows as any[]) : [];
        const fList = Array.isArray(fkRows) ? (fkRows as any[]) : [];

        const tables: SqlTableDef[] = tList.map((tr, idx) => {
          const tName = String(tr.table_name);
          const cols: SqlColumnDef[] = cList
            .filter((cr) => cr.table_name === tName)
            .map((cr) => {
              const colName = String(cr.column_name);
              const nativeType = String(cr.column_type).replace(/^[a-z]+/i, (type) => type.toUpperCase());
              const canonicalType = inferCanonicalType(nativeType);
              const extra = String(cr.extra ?? '');
              const isPk = cr.column_key === 'PRI';
              return {
                id: `col_${tName}_${colName}`,
                name: colName,
                sourceName: colName,
                canonicalType,
                nativeType,
                ...parseTypeDimensions(nativeType),
                nullable: cr.is_nullable === 'YES' && !isPk,
                primaryKey: isPk,
                unique: isPk || cr.column_key === 'UNI',
                autoIncrement: /auto_increment/i.test(extra),
                defaultValue: profile.dialect === 'mysql'
                  ? normalizeMysqlColumnDefault(cr.column_default, canonicalType, extra, noBackslashEscapes)
                  : cr.column_default === null ? undefined : String(cr.column_default),
              };
            });

          const fks: SqlForeignKeyDef[] = fList
            .filter((fk) => fk.table_name === tName)
            .map((fk, fkIdx) => ({
              id: `fk_${tName}_${fkIdx}`,
              name: String(fk.constraint_name),
              columns: [String(fk.column_name)],
              referencedTable: String(fk.ref_table),
              referencedColumns: [String(fk.ref_col)],
            }));

          const tbl: SqlTableDef = {
            id: `tbl_${tName}`,
            name: tName,
            columns: cols,
            foreignKeys: fks,
            indexes: [],
            checks: [],
            position: { x: 64 + (idx % 3) * 390, y: 64 + Math.floor(idx / 3) * 320 },
          };
          tbl.baselineSnapshot = createBaselineSnapshotFromTable(tbl);
          return tbl;
        });

        return {
          version: 1,
          id: `sql_${profile.projectId}`,
          projectId: profile.projectId,
          name: profile.name,
          dialect: profile.dialect,
          tables,
          namedQueries: [],
          seedRows: [],
          updatedAt: Date.now(),
        };
      });
    }

    if (profile.dialect === 'sqlserver') {
      return this.withMssqlPool(profile, decryptedSecret, async (pool) => {
        const tblRes = await pool.request().query(`
          SELECT s.name AS schema_name, t.name AS table_name, t.object_id
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          WHERE t.is_ms_shipped = 0
          ORDER BY s.name, t.name
        `);
        const colRes = await pool.request().query(`
          SELECT c.object_id, c.name AS col_name, ty.name AS type_name, c.max_length, c.precision, c.scale,
                 c.is_nullable, c.is_identity, dc.definition AS default_def,
                 CAST(CASE WHEN ic.index_id IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS is_pk
          FROM sys.columns c
          JOIN sys.types ty ON c.user_type_id = ty.user_type_id
          LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
          LEFT JOIN sys.indexes pk ON pk.object_id = c.object_id AND pk.is_primary_key = 1
          LEFT JOIN sys.index_columns ic ON ic.object_id = c.object_id AND ic.index_id = pk.index_id AND ic.column_id = c.column_id
          ORDER BY c.object_id, c.column_id
        `);
        const fkRes = await pool.request().query(`
          SELECT fk.parent_object_id, fk.name AS fk_name,
                 pc.name AS src_col, rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_col
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
          JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
          JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
          JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
          JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
        `);

        const tables: SqlTableDef[] = (tblRes.recordset ?? []).map((tr: any, idx: number) => {
          const objId = tr.object_id;
          const sName = String(tr.schema_name || 'dbo');
          const tName = String(tr.table_name);

          const cols: SqlColumnDef[] = (colRes.recordset ?? [])
            .filter((cr: any) => cr.object_id === objId)
            .map((cr: any) => {
              const colName = String(cr.col_name);
              const rawType = String(cr.type_name).toUpperCase();
              const isNvarchar = rawType === 'NVARCHAR' || rawType === 'NCHAR';
              const charLen = cr.max_length === -1 ? 'MAX' : isNvarchar ? Math.floor(Number(cr.max_length) / 2) : Number(cr.max_length);
              const nativeType =
                rawType === 'NVARCHAR' || rawType === 'VARCHAR'
                  ? `${rawType}(${charLen})`
                  : rawType === 'DECIMAL' || rawType === 'NUMERIC'
                    ? `${rawType}(${cr.precision},${cr.scale})`
                    : rawType;

              return {
                id: `col_${tName}_${colName}`,
                name: colName,
                sourceName: colName,
                canonicalType: inferCanonicalType(nativeType),
                nativeType,
                nullable: Boolean(cr.is_nullable) && !Boolean(cr.is_pk),
                primaryKey: Boolean(cr.is_pk),
                unique: Boolean(cr.is_pk),
                autoIncrement: Boolean(cr.is_identity),
                defaultValue: cr.default_def ? String(cr.default_def).replace(/^\(+|\)+$/g, '') : undefined,
              };
            });

          const fks: SqlForeignKeyDef[] = (fkRes.recordset ?? [])
            .filter((fk: any) => fk.parent_object_id === objId)
            .map((fk: any, fkIdx: number) => ({
              id: `fk_${tName}_${fkIdx}`,
              name: String(fk.fk_name),
              columns: [String(fk.src_col)],
              referencedSchema: String(fk.ref_schema || 'dbo'),
              referencedTable: String(fk.ref_table),
              referencedColumns: [String(fk.ref_col)],
            }));

          const tbl: SqlTableDef = {
            id: `tbl_${sName}_${tName}`,
            schema: sName,
            name: tName,
            columns: cols,
            foreignKeys: fks,
            indexes: [],
            checks: [],
            position: { x: 64 + (idx % 3) * 390, y: 64 + Math.floor(idx / 3) * 320 },
          };
          tbl.baselineSnapshot = createBaselineSnapshotFromTable(tbl);
          return tbl;
        });

        return {
          version: 1,
          id: `sql_${profile.projectId}`,
          projectId: profile.projectId,
          name: profile.name,
          dialect: 'sqlserver',
          tables,
          namedQueries: [],
          seedRows: [],
          updatedAt: Date.now(),
        };
      });
    }

    throw new Error(`Dialetto non supportato per introspezione: ${profile.dialect}`);
  }

  public async executeQuery(input: {
    req: SqlQueryRequest;
    profile?: SqlConnectionProfile | null;
    decryptedSecret?: string | null;
    rootDiskPath: string | null;
    storageProjectDir: string;
    schemaDoc: SqlDesignDocument;
  }): Promise<SqlQueryResult> {
    const { req, profile, decryptedSecret, rootDiskPath, storageProjectDir, schemaDoc } = input;
    const effectiveDialect: SqlDialect = req.dialect ?? profile?.dialect ?? schemaDoc.dialect;

    const started = Date.now();
    const maxRows = req.maxRows ?? DEFAULT_MAX_ROWS;
    try {
      if (isMissingConnection(req.connectionId, profile)) {
        throw new Error('Profilo connessione SQL non trovato.');
      }
      const isLocal = req.connectionId === '__local_sqlite__' || profile?.mode === 'local_sqlite' || profile?.dialect === 'sqlite';
      if (req.sandboxMode || profile?.mode === 'memory_sandbox' || (!profile && !isLocal)) {
        const sandboxDb = this.ensureSandboxDb(req.projectId, schemaDoc);
        return this.executeOnSqliteDb(sandboxDb, req, effectiveDialect, schemaDoc, true);
      }
      if (isLocal) {
        const readOnly = Boolean(req.readOnly || profile?.readOnly);
        const localPath = this.resolveLocalSqlitePath(profile ?? undefined, rootDiskPath, storageProjectDir, schemaDoc);
        const db = this.openLocalSqliteDb(localPath, readOnly, schemaDoc);
        try {
          return this.executeOnSqliteDb(db, { ...req, readOnly }, 'sqlite', schemaDoc);
        } finally {
          db.close();
        }
      }
      if (!profile) throw new Error('Profilo connessione SQL non trovato.');

      const readOnly = req.readOnly || profile.readOnly;
      if (readOnly) {
        const statements = splitSqlStatements(req.sql, profile.dialect);
        const tokens = tokenizeSql(statements[0] ?? '').filter((token) => token.kind !== 'comment');
        const command = getSqlCommand(tokens);
        const hasMutation = tokens.some((token) =>
          token.kind === 'word' && ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'INTO', 'EXEC', 'EXECUTE'].includes(token.value.toUpperCase()),
        );
        if (statements.length !== 1 || !['SELECT', 'SHOW', 'DESCRIBE'].includes(command ?? '') || hasMutation) {
          throw new Error('Connessione in sola lettura: istruzioni di modifica bloccate.');
        }
      }

      const explanation = explainSqlInItalian(req.sql, profile.dialect, schemaDoc).summary;
      if (profile.dialect === 'postgresql') {
        return await this.withPostgresClient(profile, decryptedSecret, async (client) => {
          const values = Array.isArray(req.parameters)
            ? req.parameters
            : req.parameters
              ? Object.values(req.parameters)
              : [];
          const res = await client.query(req.sql, values);
          const rawRows: Array<Record<string, any>> = Array.isArray(res.rows) ? res.rows : [];
          const truncated = rawRows.length > maxRows;
          const sliced = truncated ? rawRows.slice(0, maxRows) : rawRows;
          const columns: SqlResultColumnMeta[] = (res.fields ?? []).map((f: any) => ({ name: String(f.name) }));
          const rows: SqlDataRow[] = sliced.map((r) => {
            const out: SqlDataRow = {};
            for (const [k, v] of Object.entries(r)) out[k] = normalizeDriverCellValue(v);
            return out;
          });
          return {
            ok: true,
            dialect: 'postgresql',
            columns,
            rows,
            rowCount: rows.length,
            affectedRows: typeof res.rowCount === 'number' ? res.rowCount : undefined,
            truncated,
            durationMs: Date.now() - started,
            executedSql: req.sql,
            explanation,
          };
        });
      }

      if (profile.dialect === 'mysql' || profile.dialect === 'mariadb') {
        return await this.withMysqlConnection(profile, decryptedSecret, async (conn) => {
          const values = Array.isArray(req.parameters)
            ? req.parameters
            : req.parameters
              ? Object.values(req.parameters)
              : [];
          const [rawRes, fields] = await conn.execute(req.sql, values);
          if (Array.isArray(rawRes)) {
            const list = rawRes as Array<Record<string, any>>;
            const truncated = list.length > maxRows;
            const sliced = truncated ? list.slice(0, maxRows) : list;
            const columns: SqlResultColumnMeta[] = Array.isArray(fields)
              ? fields.map((f: any) => ({ name: String(f.name) }))
              : sliced[0]
                ? Object.keys(sliced[0]).map((name) => ({ name }))
                : [];
            const rows: SqlDataRow[] = sliced.map((r) => {
              const out: SqlDataRow = {};
              for (const [k, v] of Object.entries(r)) out[k] = normalizeDriverCellValue(v);
              return out;
            });
            return {
              ok: true,
              dialect: profile.dialect,
              columns,
              rows,
              rowCount: rows.length,
              truncated,
              durationMs: Date.now() - started,
              executedSql: req.sql,
              explanation,
            };
          }
          const header = rawRes as { affectedRows?: number; insertId?: number };
          return {
            ok: true,
            dialect: profile.dialect,
            columns: [],
            rows: [],
            rowCount: 0,
            affectedRows: header?.affectedRows ?? 0,
            lastInsertId: header?.insertId ?? null,
            durationMs: Date.now() - started,
            executedSql: req.sql,
            explanation,
          };
        });
      }

      if (profile.dialect === 'sqlserver') {
        return await this.withMssqlPool(profile, decryptedSecret, async (pool) => {
          const request = pool.request();
          if (Array.isArray(req.parameters)) {
            req.parameters.forEach((val, idx) => {
              request.input(`p${idx + 1}`, val);
            });
          } else if (req.parameters) {
            for (const [key, val] of Object.entries(req.parameters)) {
              request.input(key.replace(/^@/, ''), val);
            }
          }
          const res = await request.query(req.sql);
          const rawRows: Array<Record<string, any>> = res.recordset ?? [];
          const truncated = rawRows.length > maxRows;
          const sliced = truncated ? rawRows.slice(0, maxRows) : rawRows;
          const columns: SqlResultColumnMeta[] = sliced[0]
            ? Object.keys(sliced[0]).map((name) => ({ name }))
            : [];
          const rows: SqlDataRow[] = sliced.map((r) => {
            const out: SqlDataRow = {};
            for (const [k, v] of Object.entries(r)) out[k] = normalizeDriverCellValue(v);
            return out;
          });
          const affected = (res.rowsAffected ?? []).reduce((a, b) => a + b, 0);
          return {
            ok: true,
            dialect: 'sqlserver',
            columns,
            rows,
            rowCount: rows.length,
            affectedRows: affected,
            truncated,
            durationMs: Date.now() - started,
            executedSql: req.sql,
            explanation,
          };
        });
      }

      throw new Error(`Dialetto remoto non gestito: ${profile.dialect}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        dialect: profile?.dialect ?? (req.connectionId === '__local_sqlite__' ? 'sqlite' : effectiveDialect),
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - started,
        executedSql: req.sql,
        explanation: explainSqlErrorInItalian(msg, profile?.dialect ?? effectiveDialect)[0],
        error: msg,
      };
    }
  }

  public async applyDataChanges(input: {
    projectId: string;
    connectionId?: string | null;
    profile?: SqlConnectionProfile | null;
    decryptedSecret?: string | null;
    sandboxMode?: boolean;
    dialect?: SqlDialect;
    tableName: string;
    schema?: string;
    changes: SqlDataChange[];
    schemaDoc: SqlDesignDocument;
    rootDiskPath: string | null;
    storageProjectDir: string;
  }): Promise<{ ok: boolean; appliedCount: number; sqlPreview: string[]; error?: string }> {
    const {
      projectId,
      connectionId,
      profile,
      decryptedSecret,
      sandboxMode,
      tableName,
      schema,
      changes,
      schemaDoc,
      rootDiskPath,
      storageProjectDir,
    } = input;

    const previewDialect: SqlDialect = profile?.dialect ?? (connectionId === '__local_sqlite__' ? 'sqlite' : input.dialect ?? schemaDoc.dialect);
    const targetSchema = resolveEffectiveSchema(previewDialect, schema) ?? '';
    const tableDef = schemaDoc.tables.find((table) =>
      equalSqlIdentifiers(previewDialect, table.name, tableName) &&
      equalSqlIdentifiers(previewDialect, resolveEffectiveSchema(previewDialect, table.schema) ?? '', targetSchema),
    );

    let sqlPreview: string[] = [];

    if (changes.length === 0) {
      return { ok: true, appliedCount: 0, sqlPreview: [] };
    }

    const executeSqliteBatch = (db: DatabaseSync): number => {
      const sqliteDml = compileDmlStatements('sqlite', tableName, changes, { tableDef });
      let applied = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const stmtSpec of sqliteDml) {
          const adapted = adaptParameterizedSqlForSqlite(stmtSpec.sql, stmtSpec.params, 'sqlite');
          const res = db.prepare(adapted.sql).run(...adapted.bindings);
          applied += checkedGridRowCount(stmtSpec.kind, Number(res.changes));
        }
        db.exec('COMMIT');
        return applied;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      }
    };

    try {
      if (isMissingConnection(connectionId, profile)) throw new Error('Profilo connessione SQL non trovato.');
      if (profile?.readOnly) throw new Error('La connessione SQL è in sola lettura.');
      const keys = tableDef?.columns.filter((column) => column.primaryKey).map((column) => column.name) ?? [];
      const invalidChange = changes.some((change) => {
        if (change.kind === 'insert') return false;
        return keys.length === 0 || Object.keys(change.primaryKey ?? {}).length !== keys.length ||
          keys.some((key) => !Object.hasOwn(change.primaryKey, key) || change.primaryKey[key] == null);
      });
      if (invalidChange) {
        throw new Error('Per modificare o eliminare una riga dalla griglia serve una chiave primaria completa.');
      }

      const previewDml = compileDmlStatements(previewDialect, tableName, changes, {
        schema: schema ?? tableDef?.schema ?? defaultSchemaForDialect(previewDialect),
        tableDef,
      });
      sqlPreview = previewDml.map((d) => d.previewSql);

      // Sandbox or Local SQLite
      if (sandboxMode || (!profile && connectionId !== '__local_sqlite__') || profile?.mode === 'memory_sandbox') {
        const sandboxDb = this.ensureSandboxDb(projectId, schemaDoc);
        const appliedCount = executeSqliteBatch(sandboxDb);
        return { ok: true, appliedCount, sqlPreview };
      }

      if (connectionId === '__local_sqlite__' || profile?.mode === 'local_sqlite' || profile?.dialect === 'sqlite') {
        const localPath = this.resolveLocalSqlitePath(profile ?? undefined, rootDiskPath, storageProjectDir, schemaDoc);
        const db = this.openLocalSqliteDb(localPath, false, schemaDoc);
        try {
          const appliedCount = executeSqliteBatch(db);
          return { ok: true, appliedCount, sqlPreview };
        } finally {
          db.close();
        }
      }

      if (!profile) {
        throw new Error('Profilo connessione SQL non trovato.');
      }

      // Remote PostgreSQL
      if (profile.dialect === 'postgresql') {
        return await this.withPostgresClient(profile, decryptedSecret, async (client) => {
          await client.query('BEGIN');
          try {
            let appliedCount = 0;
            for (const dml of previewDml) {
              const res = await client.query(dml.sql, dml.params);
              appliedCount += checkedGridRowCount(dml.kind, res.rowCount ?? 0);
            }
            await client.query('COMMIT');
            return { ok: true, appliedCount, sqlPreview };
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          }
        });
      }

      // Remote MySQL / MariaDB
      if (profile.dialect === 'mysql' || profile.dialect === 'mariadb') {
        return await this.withMysqlConnection(profile, decryptedSecret, async (conn) => {
          await conn.beginTransaction();
          try {
            let appliedCount = 0;
            for (const dml of previewDml) {
              const [res] = await conn.execute(dml.sql, dml.params);
              appliedCount += checkedGridRowCount(dml.kind, (res as any)?.affectedRows ?? 0);
            }
            await conn.commit();
            return { ok: true, appliedCount, sqlPreview };
          } catch (err) {
            await conn.rollback().catch(() => {});
            throw err;
          }
        });
      }

      // Remote SQL Server
      if (profile.dialect === 'sqlserver') {
        return await this.withMssqlPool(profile, decryptedSecret, async (pool, mssqlMod) => {
          const TxCtor = mssqlMod.Transaction ?? (mssqlMod as any).default?.Transaction;
          const tx = new TxCtor(pool);
          await tx.begin();
          try {
            let appliedCount = 0;
            for (const dml of previewDml) {
              const req = tx.request();
              dml.params.forEach((val, idx) => req.input(`p${idx + 1}`, val));
              const res = await req.query(dml.sql);
              appliedCount += checkedGridRowCount(dml.kind, (res.rowsAffected ?? [])[0] ?? 0);
            }
            await tx.commit();
            return { ok: true, appliedCount, sqlPreview };
          } catch (err) {
            await tx.rollback().catch(() => {});
            throw err;
          }
        });
      }

      throw new Error(`Dialetto non supportato per applyDataChanges: ${profile.dialect}`);
    } catch (err) {
      return {
        ok: false,
        appliedCount: 0,
        sqlPreview,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async compileMigration(input: {
    projectId: string;
    schemaDoc: SqlDesignDocument;
    connectionId?: string | null;
    profile?: SqlConnectionProfile | null;
    decryptedSecret?: string | null;
    rootDiskPath: string | null;
    storageProjectDir: string;
  }): Promise<SqlMigrationPlan> {
    const { projectId, schemaDoc, connectionId, profile, decryptedSecret, rootDiskPath, storageProjectDir } = input;
    if (isMissingConnection(connectionId, profile)) throw new Error('Profilo connessione SQL non trovato.');
    const targetDialect: SqlDialect = profile?.mode === 'remote' ? profile.dialect : 'sqlite';

    let liveBaselineTables: SqlTableSnapshot[] | undefined;
    let fingerprint: string | undefined;
    if (connectionId === '__local_sqlite__' || profile?.mode === 'local_sqlite') {
      const localPath = this.resolveLocalSqlitePath(profile ?? undefined, rootDiskPath, storageProjectDir, schemaDoc);
      if (existsSync(localPath) && statSync(localPath).size > 0) {
        const db = this.openLocalSqliteDb(localPath, true);
        try {
          fingerprint = sqliteSchemaFingerprint(db);
          const liveDoc = this.introspectSqliteDb(db, projectId);
          liveBaselineTables = liveDoc.tables.map((t) => t.baselineSnapshot!);
        } finally {
          db.close();
        }
      } else {
        fingerprint = sqliteSchemaFingerprint();
        liveBaselineTables = [];
      }
    } else if (profile?.mode === 'remote') {
      const liveDoc = await this.introspectConnection({ profile, decryptedSecret, rootDiskPath, storageProjectDir });
      liveBaselineTables = liveDoc.tables.map((t) => t.baselineSnapshot ?? createBaselineSnapshotFromTable(t));
    } else {
      const existingSession = this.sandboxes.get(projectId);
      if (existingSession) {
        fingerprint = sqliteSchemaFingerprint(existingSession.db);
        liveBaselineTables = this.introspectSqliteDb(existingSession.db, projectId).tables.map((table) => table.baselineSnapshot!);
      } else {
        const sandbox = this.ensureSandboxDb(projectId, {
          ...schemaDoc,
          tables: schemaDoc.tables.flatMap((table) => table.baselineSnapshot ? [{ ...table, ...table.baselineSnapshot }] : []),
          seedRows: schemaDoc.seedRows.filter((seed) => schemaDoc.tables.some((table) => table.baselineSnapshot?.name === seed.tableName)),
        });
        fingerprint = sqliteSchemaFingerprint(sandbox);
      }
    }

    const plan = buildSqlMigrationPlan(schemaDoc, {
      targetDialect,
      liveBaselineTables,
    });
    return fingerprint === undefined ? plan : { ...plan, sqliteSchemaFingerprint: fingerprint };
  }

  public async applyMigration(input: {
    projectId: string;
    plan: SqlMigrationPlan;
    schemaDoc: SqlDesignDocument;
    connectionId?: string | null;
    profile?: SqlConnectionProfile | null;
    decryptedSecret?: string | null;
    sandboxMode?: boolean;
    allowDestructive?: boolean;
    rootDiskPath: string | null;
    storageProjectDir: string;
  }): Promise<{ ok: boolean; executedStatements: number; error?: string }> {
    const {
      projectId,
      plan,
      schemaDoc,
      connectionId,
      profile,
      decryptedSecret,
      sandboxMode,
      allowDestructive,
      rootDiskPath,
      storageProjectDir,
    } = input;

    if (isMissingConnection(connectionId, profile) || profile?.readOnly) {
      return {
        ok: false,
        executedStatements: 0,
        error: profile?.readOnly ? 'La connessione SQL è in sola lettura.' : 'Profilo connessione SQL non trovato.',
      };
    }

    if (plan.blockers.length > 0) {
      return { ok: false, executedStatements: 0, error: plan.blockers[0] };
    }
    if (plan.hasDestructiveChanges && !allowDestructive) {
      return {
        ok: false,
        executedStatements: 0,
        error: 'Il piano contiene modifiche distruttive: conferma esplicitamente allowDestructive prima di applicare.',
      };
    }
    if (plan.changes.length === 0) {
      return { ok: true, executedStatements: 0 };
    }

    const executeSqliteMigration = (db: DatabaseSync): number => {
      if (plan.dialect !== 'sqlite') throw new Error('Il piano di migrazione non è per SQLite.');
      const rebuild = plan.rebuildSqliteTables.length > 0;
      const statements = plan.changes.flatMap((change) => splitSqlStatements(change.sql, 'sqlite'));
      if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (plan.sqliteSchemaFingerprint !== undefined && plan.sqliteSchemaFingerprint !== sqliteSchemaFingerprint(db)) {
            throw new Error('Lo schema SQLite è cambiato dopo il calcolo del piano. Ricalcola la migrazione.');
          }
          for (const statement of statements) db.exec(statement);
          const violations = db.prepare('PRAGMA foreign_key_check').all();
          if (violations.length > 0) {
            throw new Error(`Violazione integrità referenziale rilevata (${violations.length} righe non valide).`);
          }
          db.exec('COMMIT');
          return statements.length;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } finally {
        if (rebuild) db.exec('PRAGMA foreign_keys = ON');
      }
    };

    try {
      if (sandboxMode || (!profile && connectionId !== '__local_sqlite__') || profile?.mode === 'memory_sandbox') {
        const existingSession = this.sandboxes.get(projectId);
        const sandboxDb = existingSession?.db ?? this.ensureSandboxDb(projectId, schemaDoc);
        const count = executeSqliteMigration(sandboxDb);
        this.sandboxes.set(projectId, {
          db: sandboxDb,
          schemaSignature: this.computeSandboxSignature(schemaDoc),
        });
        return { ok: true, executedStatements: count };
      }

      if (connectionId === '__local_sqlite__' || profile?.mode === 'local_sqlite' || profile?.dialect === 'sqlite') {
        const localPath = this.resolveLocalSqlitePath(profile ?? undefined, rootDiskPath, storageProjectDir, schemaDoc);
        const db = this.openLocalSqliteDb(localPath, false);
        try {
          const count = executeSqliteMigration(db);
          return { ok: true, executedStatements: count };
        } finally {
          db.close();
        }
      }

      if (!profile) {
        throw new Error('Profilo connessione SQL non trovato.');
      }

      if (plan.dialect !== profile.dialect) throw new Error('Il dialetto del piano non corrisponde alla connessione SQL.');
      const stmts = plan.changes.flatMap((change) => splitSqlStatements(change.sql, profile.dialect));

      if (profile.dialect === 'postgresql') {
        return await this.withPostgresClient(profile, decryptedSecret, async (client) => {
          await client.query('BEGIN');
          try {
            for (const s of stmts) await client.query(s);
            await client.query('COMMIT');
            return { ok: true, executedStatements: stmts.length };
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          }
        });
      }

      if (profile.dialect === 'mysql' || profile.dialect === 'mariadb') {
        return await this.withMysqlConnection(profile, decryptedSecret, async (conn) => {
          for (const s of stmts) await conn.query(s);
          return { ok: true, executedStatements: stmts.length };
        });
      }

      if (profile.dialect === 'sqlserver') {
        return await this.withMssqlPool(profile, decryptedSecret, async (pool, mssqlMod) => {
          const TxCtor = mssqlMod.Transaction ?? (mssqlMod as any).default?.Transaction;
          const tx = new TxCtor(pool);
          await tx.begin();
          try {
            for (const s of stmts) await tx.request().query(s);
            await tx.commit();
            return { ok: true, executedStatements: stmts.length };
          } catch (err) {
            await tx.rollback().catch(() => {});
            throw err;
          }
        });
      }

      throw new Error(`Dialetto non supportato per applyMigration: ${profile.dialect}`);
    } catch (err) {
      return {
        ok: false,
        executedStatements: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
