/**
 * Safe Multi-Dialect Schema Diff & Transactional Migration Planner (`src/shared/sql-migration.ts`).
 * Ported & adapted from `Database Manager/src/designer/schemaMigration.ts` across all 5 SQL engines:
 *   - `sqlite` (including transactional `__dbm_migrate_*` table rebuild + `PRAGMA foreign_key_check` + view/trigger blockers)
 *   - `postgresql` (`ALTER COLUMN ... TYPE ... USING`, `SET/DROP DEFAULT`, `SET/DROP NOT NULL`, `DROP CONSTRAINT`)
 *   - `mysql` / `mariadb` (`MODIFY COLUMN`, `RENAME TABLE`, `DROP FOREIGN KEY`, `DROP INDEX ... ON ...`)
 *   - `sqlserver` T-SQL (`sp_rename`, `ALTER COLUMN`, `DROP CONSTRAINT`, `DROP INDEX ... ON ...`)
 *
 * Pure TypeScript, zero Node imports.
 */

import {
  checkForeignKeyTarget,
  compileColumnDefinitionSql,
  compileForeignKeyConstraintSql,
  compileIndexDdl,
  compileTableDdl,
  equalSqlIdentifiers,
  identifierKey,
  mapCanonicalToNativeType,
  normalizeDefaultValueForDialect,
  qualifyTableName,
  quoteIdentifier,
  remapTableToDialect,
  resolveEffectiveSchema,
  sortTablesTopologically,
  tableObjectKey,
  validateTableDefinition,
} from './sql-dialects';
import type {
  SqlColumnDef,
  SqlDesignDocument,
  SqlDialect,
  SqlForeignKeyDef,
  SqlIndexDef,
  SqlMigrationChange,
  SqlMigrationPlan,
  SqlTableDef,
  SqlTableSnapshot,
} from './sql-ir';

export function createBaselineSnapshotFromTable(table: SqlTableDef): SqlTableSnapshot {
  return {
    schema: table.schema,
    name: table.name,
    columns: table.columns.map((c) => ({ ...c, sourceName: c.name })),
    foreignKeys: table.foreignKeys.map((fk) => ({
      ...fk,
      columns: [...fk.columns],
      referencedColumns: [...fk.referencedColumns],
    })),
    indexes: table.indexes.map((idx) => ({
      ...idx,
      columns: [...idx.columns],
    })),
    checks: table.checks.map((chk) => ({ ...chk })),
  };
}

export function attachBaselinesToDocument(doc: SqlDesignDocument): SqlDesignDocument {
  return {
    ...doc,
    tables: doc.tables.map((tbl) => ({
      ...tbl,
      columns: tbl.columns.map((c) => ({ ...c, sourceName: c.name })),
      baselineSnapshot: createBaselineSnapshotFromTable(tbl),
    })),
    updatedAt: Date.now(),
  };
}

function normalizeSqlType(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeDefault(raw?: string): string {
  return (raw ?? '').trim();
}

function fkSignature(dialect: SqlDialect, ownerSchema: string | undefined, fk: SqlForeignKeyDef): string {
  const refSchema = resolveEffectiveSchema(dialect, fk.referencedSchema ?? ownerSchema) ?? '';
  return JSON.stringify([
    fk.columns.map((c) => identifierKey(dialect, c)),
    identifierKey(dialect, refSchema),
    identifierKey(dialect, fk.referencedTable),
    fk.referencedColumns.map((c) => identifierKey(dialect, c)),
    fk.onDelete ?? 'NO ACTION',
    fk.onUpdate ?? 'NO ACTION',
  ]);
}

function indexSignature(dialect: SqlDialect, idx: SqlIndexDef): string {
  return JSON.stringify([
    identifierKey(dialect, idx.name),
    Boolean(idx.unique),
    idx.columns.map((c) => identifierKey(dialect, c)),
    (idx.whereClause ?? '').trim(),
  ]);
}

function effectiveColumnNativeType(col: SqlColumnDef, dialect: SqlDialect): string {
  return (
    col.nativeType?.trim() ||
    mapCanonicalToNativeType(col.canonicalType, dialect, {
      length: col.length,
      precision: col.precision,
      scale: col.scale,
      autoIncrement: col.autoIncrement,
    })
  );
}

export interface BuildMigrationPlanOptions {
  targetDialect?: SqlDialect;
  /**
   * Optional live database tables introspected from the target DB connection.
   * When omitted, each `SqlTableDef.baselineSnapshot` is used as the baseline;
   * tables without `baselineSnapshot` are planned as `create_table`.
   */
  liveBaselineTables?: SqlTableSnapshot[];
}

export function buildSqlMigrationPlan(
  doc: SqlDesignDocument,
  options: BuildMigrationPlanOptions = {},
): SqlMigrationPlan {
  const dialect = options.targetDialect ?? doc.dialect;
  const designTables =
    dialect === doc.dialect
      ? doc.tables
      : doc.tables.map((t) => remapTableToDialect(t, dialect));

  const changes: SqlMigrationChange[] = [];
  const deferredFkChanges: SqlMigrationChange[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const rebuildSqliteTables: string[] = [];
  const affectedTableIds = new Set<string>();
  let changeCounter = 0;

  const q = (id: string) => quoteIdentifier(id, dialect);
  const nextChangeId = (prefix: string) => `${prefix}_${++changeCounter}`;

  // 1. Validate design tables for duplicate names & column validity
  const seenDesignKeys = new Set<string>();
  for (const tbl of designTables) {
    const tblIssues = validateTableDefinition(dialect, tbl);
    for (const issue of tblIssues) {
      blockers.push(issue);
    }
    const key = tableObjectKey(dialect, tbl);
    if (seenDesignKeys.has(key)) {
      blockers.push(`Tabella duplicata nel progetto: "${tbl.name}".`);
    }
    seenDesignKeys.add(key);
  }

  if (blockers.length > 0) {
    return {
      dialect,
      changes: [],
      warnings,
      blockers,
      rebuildSqliteTables: [],
      affectedTableIds: [],
      fullSql: '',
      hasDestructiveChanges: false,
    };
  }

  // Build baseline map if liveBaselineTables is supplied, else derive from per-table baselineSnapshot
  const liveMap = new Map<string, SqlTableSnapshot>();
  if (options.liveBaselineTables) {
    for (const snap of options.liveBaselineTables) {
      const remappedSnap: SqlTableSnapshot = {
        ...snap,
        schema: resolveEffectiveSchema(dialect, snap.schema),
      };
      liveMap.set(tableObjectKey(dialect, remappedSnap), remappedSnap);
    }
  }

  const resolveBaselineForTable = (tbl: SqlTableDef): SqlTableSnapshot | undefined => {
    if (options.liveBaselineTables) {
      if (tbl.baselineSnapshot) {
        const snapKey = tableObjectKey(dialect, tbl.baselineSnapshot);
        if (liveMap.has(snapKey)) return liveMap.get(snapKey);
      }
      return liveMap.get(tableObjectKey(dialect, tbl));
    }
    if (!tbl.baselineSnapshot) return undefined;
    // Remap baseline column types if dialect was switched
    if (dialect !== doc.dialect) {
      const remappedBase = remapTableToDialect(
        {
          id: tbl.id,
          name: tbl.baselineSnapshot.name,
          schema: tbl.baselineSnapshot.schema,
          columns: tbl.baselineSnapshot.columns,
          foreignKeys: tbl.baselineSnapshot.foreignKeys,
          indexes: tbl.baselineSnapshot.indexes,
          checks: tbl.baselineSnapshot.checks,
          position: tbl.position,
        },
        dialect,
      );
      return {
        ...tbl.baselineSnapshot,
        schema: remappedBase.schema,
        columns: remappedBase.columns,
        foreignKeys: remappedBase.foreignKeys,
      };
    }
    return tbl.baselineSnapshot;
  };

  const matchedBaselineKeys = new Set<string>();
  const newTables: SqlTableDef[] = [];
  const existingPairs: Array<{ design: SqlTableDef; baseline: SqlTableSnapshot }> = [];

  for (const tbl of designTables) {
    const baseline = resolveBaselineForTable(tbl);
    if (!baseline) {
      newTables.push(tbl);
    } else {
      matchedBaselineKeys.add(tableObjectKey(dialect, baseline));
      existingPairs.push({ design: tbl, baseline });
    }
  }

  // 2. Drop only tables the project explicitly removed from its model.
  if (options.liveBaselineTables) {
    const removedTables = new Map((doc.removedTables ?? []).map((table) => [tableObjectKey(dialect, table), table]));
    const unmanagedTables: string[] = [];
    const drops: SqlTableDef[] = [];
    for (const [snapKey, snap] of liveMap.entries()) {
      if (matchedBaselineKeys.has(snapKey)) continue;
      const removed = removedTables.get(snapKey);
      if (!removed) {
        unmanagedTables.push(qualifyTableName(dialect, snap.name, snap.schema));
        continue;
      }
      drops.push({ ...snap, id: removed.id, position: { x: 0, y: 0 } });
    }
    const droppingKeys = new Set(drops.map((table) => tableObjectKey(dialect, table)));
    for (const table of sortTablesTopologically(dialect, drops).reverse()) {
      const key = tableObjectKey(dialect, table);
      const dependent = [...liveMap.entries()].find(([sourceKey, source]) => !droppingKeys.has(sourceKey) &&
        source.foreignKeys.some((fk) => tableObjectKey(dialect, {
          name: fk.referencedTable,
          schema: fk.referencedSchema ?? source.schema,
        }) === key));
      if (dependent) {
        blockers.push(`Prima di eliminare ${table.name}, rimuovi dal database il vincolo esterno in ${dependent[1].name}.`);
        continue;
      }
      changes.push({
        id: nextChangeId('chg_drop_tbl'),
        tableId: table.id,
        tableName: table.name,
        kind: 'drop_table',
        label: `Elimina tabella ${table.name}`,
        sql: `DROP TABLE ${qualifyTableName(dialect, table.name, table.schema)};`,
        destructive: true,
      });
      affectedTableIds.add(table.id);
    }
    if (unmanagedTables.length > 0) {
      warnings.push(`Tabelle presenti nel database e gestite fuori dal progetto: ${unmanagedTables.join(', ')}.`);
    }
  }

  // 3. Plan creation of brand-new tables in topological order
  const orderedNewTables = sortTablesTopologically(dialect, newTables);
  for (const tbl of orderedNewTables) {
    for (const fk of tbl.foreignKeys) {
      const targetDesign = designTables.find(
        (other) =>
          tableObjectKey(dialect, other) ===
          tableObjectKey(dialect, {
            name: fk.referencedTable,
            schema: fk.referencedSchema ?? tbl.schema,
          }),
      );
      if (targetDesign) {
        try {
          checkForeignKeyTarget(dialect, targetDesign, fk.referencedColumns);
        } catch (err) {
          blockers.push(err instanceof Error ? err.message : String(err));
        }
      }
    }
    const createSql = compileTableDdl(dialect, tbl, {
      ifNotExists: false,
      includeForeignKeysInline: true,
      includeIndexes: true,
    });
    changes.push({
      id: nextChangeId('chg_create_tbl'),
      tableId: tbl.id,
      tableName: tbl.name,
      kind: 'create_table',
      label: `Crea tabella ${tbl.name}`,
      sql: createSql,
      destructive: false,
    });
    affectedTableIds.add(tbl.id);
  }

  // 4. Diff each existing table against its baseline snapshot
  for (const { design, baseline } of existingPairs) {
    const baseCols = baseline.columns;
    const nextCols = design.columns;

    // Match columns via `sourceName` (or fallback exact `name` match if `sourceName` was omitted)
    const matchedBaseColNames = new Set<string>();
    const colPairs: Array<{ base: SqlColumnDef; next: SqlColumnDef }> = [];
    const addedCols: SqlColumnDef[] = [];

    for (const nextCol of nextCols) {
      const lookupName = nextCol.sourceName ?? nextCol.name;
      const baseMatch = baseCols.find(
        (bc) =>
          !matchedBaseColNames.has(identifierKey(dialect, bc.name)) &&
          equalSqlIdentifiers(dialect, bc.name, lookupName),
      );
      if (baseMatch) {
        matchedBaseColNames.add(identifierKey(dialect, baseMatch.name));
        colPairs.push({ base: baseMatch, next: nextCol });
      } else {
        addedCols.push(nextCol);
      }
    }

    const droppedCols = baseCols.filter(
      (bc) => !matchedBaseColNames.has(identifierKey(dialect, bc.name)),
    );

    const renamedPairs = colPairs.filter(
      ({ base, next }) => !equalSqlIdentifiers(dialect, base.name, next.name),
    );

    const alteredPairs = colPairs.filter(({ base, next }) => {
      const baseType = normalizeSqlType(effectiveColumnNativeType(base, dialect));
      const nextType = normalizeSqlType(effectiveColumnNativeType(next, dialect));
      const baseDef = normalizeDefault(
        normalizeDefaultValueForDialect(base.defaultValue, base.canonicalType, dialect),
      );
      const nextDef = normalizeDefault(
        normalizeDefaultValueForDialect(next.defaultValue, next.canonicalType, dialect),
      );
      return (
        baseType !== nextType ||
        Boolean(base.nullable) !== Boolean(next.nullable) ||
        baseDef !== nextDef ||
        Boolean(base.unique) !== Boolean(next.unique) ||
        Boolean(base.primaryKey) !== Boolean(next.primaryKey) ||
        Boolean(base.autoIncrement) !== Boolean(next.autoIncrement)
      );
    });

    const pkChanged =
      alteredPairs.some(({ base, next }) => Boolean(base.primaryKey) !== Boolean(next.primaryKey)) ||
      addedCols.some((c) => c.primaryKey || c.autoIncrement) ||
      droppedCols.some((c) => c.primaryKey);

    if (pkChanged && dialect !== 'sqlite') {
      blockers.push(
        `${design.name}: la modifica della chiave primaria o dell'identità richiede una migrazione SQL dedicata.`,
      );
      continue;
    }

    // Foreign key diffs (accounting for column renames)
    const renameLookup = new Map<string, string>();
    for (const { base, next } of renamedPairs) {
      renameLookup.set(identifierKey(dialect, base.name), next.name);
    }

    const normalizedBaseFks: SqlForeignKeyDef[] = baseline.foreignKeys.map((fk) => ({
      ...fk,
      columns: fk.columns.map((c) => renameLookup.get(identifierKey(dialect, c)) ?? c),
    }));

    const removedFks = normalizedBaseFks.filter(
      (bfk) =>
        !design.foreignKeys.some(
          (nfk) => fkSignature(dialect, design.schema, nfk) === fkSignature(dialect, baseline.schema, bfk),
        ),
    );
    const addedFks = design.foreignKeys.filter(
      (nfk) =>
        !normalizedBaseFks.some(
          (bfk) => fkSignature(dialect, design.schema, nfk) === fkSignature(dialect, baseline.schema, bfk),
        ),
    );

    // Index diffs
    const normalizedBaseIndexes: SqlIndexDef[] = baseline.indexes.map((idx) => ({
      ...idx,
      columns: idx.columns.map((c) => renameLookup.get(identifierKey(dialect, c)) ?? c),
    }));

    const removedIndexes = normalizedBaseIndexes.filter(
      (bIdx) =>
        !design.indexes.some((nIdx) => indexSignature(dialect, nIdx) === indexSignature(dialect, bIdx)),
    );
    const addedIndexes = design.indexes.filter(
      (nIdx) =>
        !normalizedBaseIndexes.some(
          (bIdx) => indexSignature(dialect, nIdx) === indexSignature(dialect, bIdx),
        ),
    );

    const tableRenamed = !equalSqlIdentifiers(dialect, baseline.name, design.name);

    // Transactional SQLite Table Rebuild path when SQLite requires non-trivial structural edits
    const sqliteNeedsRebuild =
      dialect === 'sqlite' &&
      (alteredPairs.length > 0 ||
        droppedCols.length > 0 ||
        removedFks.length > 0 ||
        addedFks.length > 0 ||
        pkChanged);

    if (sqliteNeedsRebuild) {
      if (baseline.hasDependentViewsOrTriggers) {
        blockers.push(
          `${baseline.name}: la ricostruzione automatica SQLite è bloccata perché esistono viste o trigger dipendenti.`,
        );
        continue;
      }
      if (baseline.hasGeneratedColumns) {
        blockers.push(
          `${baseline.name}: la ricostruzione automatica SQLite è bloccata perché la tabella contiene colonne generate (GENERATED ALWAYS).`,
        );
        continue;
      }
      if (colPairs.length === 0) {
        blockers.push(
          `${baseline.name}: la ricostruzione SQLite richiede almeno una colonna mappata dalla struttura di origine.`,
        );
        continue;
      }
      for (const addCol of addedCols) {
        if (!addCol.nullable && !addCol.autoIncrement && (!addCol.defaultValue || /^NULL$/i.test(addCol.defaultValue))) {
          blockers.push(
            `${design.name}.${addCol.name}: una nuova colonna NOT NULL durante la ricostruzione richiede un valore DEFAULT.`,
          );
        }
      }
      if (blockers.length > 0) continue;

      const tempName = `__dbm_migrate_${design.name}`;
      if (designTables.some((t) => equalSqlIdentifiers('sqlite', t.name, tempName))) {
        blockers.push(`${tempName}: nome temporaneo di migrazione già presente nello schema.`);
        continue;
      }

      const tempTable: SqlTableDef = {
        ...design,
        name: tempName,
        indexes: [],
      };
      const createTempSql = compileTableDdl('sqlite', tempTable, {
        ifNotExists: false,
        includeForeignKeysInline: true,
        includeIndexes: false,
      });

      const dstColsSql = colPairs.map(({ next }) => q(next.name)).join(', ');
      const srcColsSql = colPairs.map(({ base }) => q(base.name)).join(', ');
      const indexSqlLines = design.indexes.map((idx) => compileIndexDdl('sqlite', design, idx, false));

      const rebuildSteps = [
        createTempSql,
        `INSERT INTO ${q(tempName)} (${dstColsSql}) SELECT ${srcColsSql} FROM ${q(baseline.name)};`,
        `DROP TABLE ${q(baseline.name)};`,
        `ALTER TABLE ${q(tempName)} RENAME TO ${q(design.name)};`,
        ...indexSqlLines,
      ];

      changes.push({
        id: nextChangeId('chg_sqlite_rebuild'),
        tableId: design.id,
        tableName: design.name,
        kind: 'rebuild_sqlite_table',
        label: `Ricostruisci tabella SQLite ${baseline.name}${tableRenamed ? ` → ${design.name}` : ''} (transazionale)`,
        sql: rebuildSteps.join('\n'),
        destructive: droppedCols.length > 0 || alteredPairs.length > 0,
      });
      rebuildSqliteTables.push(design.name);
      affectedTableIds.add(design.id);
      warnings.push(
        `SQLite (${design.name}): ricostruzione atomica tramite ${tempName} con verifica PRAGMA foreign_key_check prima del COMMIT.`,
      );
      continue;
    }

    // Standard incremental ALTER path (SQLite simple ops + PostgreSQL + MySQL + MariaDB + SQL Server)
    const qualifiedOld = qualifyTableName(dialect, baseline.name, baseline.schema);
    const qualifiedCurrent = qualifyTableName(dialect, design.name, design.schema);

    if (tableRenamed) {
      let renameSql: string;
      if (dialect === 'mysql' || dialect === 'mariadb') {
        renameSql = `RENAME TABLE ${qualifiedOld} TO ${qualifiedCurrent};`;
      } else if (dialect === 'sqlserver') {
        const srcSchema = resolveEffectiveSchema(dialect, baseline.schema) ?? 'dbo';
        renameSql = `EXEC sp_rename N'${srcSchema}.${baseline.name}', N'${design.name}';`;
      } else {
        renameSql = `ALTER TABLE ${qualifiedOld} RENAME TO ${q(design.name)};`;
      }
      changes.push({
        id: nextChangeId('chg_rename_tbl'),
        tableId: design.id,
        tableName: design.name,
        kind: 'rename_table',
        label: `Rinomina tabella ${baseline.name} → ${design.name}`,
        sql: renameSql,
        destructive: false,
      });
      affectedTableIds.add(design.id);
    }

    // Column renames
    for (const { base, next } of renamedPairs) {
      let renameColSql: string;
      if (dialect === 'sqlserver') {
        const effSchema = resolveEffectiveSchema(dialect, design.schema) ?? 'dbo';
        renameColSql = `EXEC sp_rename N'${effSchema}.${design.name}.${base.name}', N'${next.name}', N'COLUMN';`;
      } else {
        renameColSql = `ALTER TABLE ${qualifiedCurrent} RENAME COLUMN ${q(base.name)} TO ${q(next.name)};`;
      }
      changes.push({
        id: nextChangeId('chg_rename_col'),
        tableId: design.id,
        tableName: design.name,
        kind: 'alter_column',
        label: `Rinomina colonna ${design.name}.${base.name} → ${next.name}`,
        sql: renameColSql,
        destructive: false,
      });
      affectedTableIds.add(design.id);
    }

    // Added columns
    for (const addCol of addedCols) {
      if (!addCol.nullable && (!addCol.defaultValue || /^NULL$/i.test(addCol.defaultValue))) {
        blockers.push(
          `${design.name}.${addCol.name}: una nuova colonna NOT NULL richiede un valore DEFAULT per le righe esistenti.`,
        );
        continue;
      }
      if (
        dialect === 'sqlite' &&
        addCol.defaultValue &&
        /CURRENT_(TIME|DATE|TIMESTAMP)|^\s*\(/i.test(addCol.defaultValue) &&
        !addCol.nullable
      ) {
        blockers.push(
          `${design.name}.${addCol.name}: SQLite ALTER TABLE ADD COLUMN NOT NULL richiede un valore DEFAULT costante.`,
        );
        continue;
      }

      const colSql = compileColumnDefinitionSql(dialect, addCol, {
        inlineSinglePk: false,
        includeCheckInline: true,
      });
      const addKeyword = dialect === 'sqlserver' ? 'ADD' : 'ADD COLUMN';
      const sqliteSafeColSql =
        dialect === 'sqlite' && addCol.unique ? colSql.replace(/\s+UNIQUE\b/i, '') : colSql;

      changes.push({
        id: nextChangeId('chg_add_col'),
        tableId: design.id,
        tableName: design.name,
        kind: 'add_column',
        label: `Aggiungi colonna ${design.name}.${addCol.name}`,
        sql: `ALTER TABLE ${qualifiedCurrent} ${addKeyword} ${sqliteSafeColSql};`,
        destructive: false,
      });
      if (dialect === 'sqlite' && addCol.unique) {
        changes.push({
          id: nextChangeId('chg_sqlite_uq'),
          tableId: design.id,
          tableName: design.name,
          kind: 'create_index',
          label: `Indice univoco su ${design.name}.${addCol.name}`,
          sql: `CREATE UNIQUE INDEX ${q(`uq_${design.name}_${addCol.name}`)} ON ${qualifiedCurrent} (${q(addCol.name)});`,
          destructive: false,
        });
      }
      affectedTableIds.add(design.id);
    }

    // Altered columns (PostgreSQL, MySQL, MariaDB, SQL Server)
    for (const { base, next } of alteredPairs) {
      const baseType = normalizeSqlType(effectiveColumnNativeType(base, dialect));
      const nextTypeRaw = effectiveColumnNativeType(next, dialect);
      const nextType = normalizeSqlType(nextTypeRaw);
      const nextDef = normalizeDefaultValueForDialect(next.defaultValue, next.canonicalType, dialect);
      const baseDef = normalizeDefaultValueForDialect(base.defaultValue, base.canonicalType, dialect);
      const typeChanged = baseType !== nextType;

      if (dialect === 'postgresql') {
        const pgStmts: string[] = [];
        if (typeChanged) {
          pgStmts.push(`ALTER TABLE ${qualifiedCurrent} ALTER COLUMN ${q(next.name)} DROP DEFAULT;`);
          pgStmts.push(
            `ALTER TABLE ${qualifiedCurrent} ALTER COLUMN ${q(next.name)} TYPE ${nextTypeRaw} USING ${q(next.name)}::${nextTypeRaw};`,
          );
          if (nextDef) {
            pgStmts.push(
              `ALTER TABLE ${qualifiedCurrent} ALTER COLUMN ${q(next.name)} SET DEFAULT ${nextDef};`,
            );
          }
        } else if (normalizeDefault(baseDef) !== normalizeDefault(nextDef)) {
          pgStmts.push(
            `ALTER TABLE ${qualifiedCurrent} ALTER COLUMN ${q(next.name)} ${nextDef ? `SET DEFAULT ${nextDef}` : 'DROP DEFAULT'};`,
          );
        }
        if (Boolean(base.nullable) !== Boolean(next.nullable)) {
          pgStmts.push(
            `ALTER TABLE ${qualifiedCurrent} ALTER COLUMN ${q(next.name)} ${next.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
          );
        }
        if (pgStmts.length > 0) {
          changes.push({
            id: nextChangeId('chg_pg_alter_col'),
            tableId: design.id,
            tableName: design.name,
            kind: 'alter_column',
            label: `Modifica colonna ${design.name}.${next.name}`,
            sql: pgStmts.join('\n'),
            destructive: typeChanged || (!next.nullable && base.nullable),
          });
          affectedTableIds.add(design.id);
        }
      } else if (dialect === 'mysql' || dialect === 'mariadb') {
        const colDef = compileColumnDefinitionSql(dialect, next, {
          inlineSinglePk: false,
          includeCheckInline: false,
        });
        changes.push({
          id: nextChangeId('chg_mysql_mod_col'),
          tableId: design.id,
          tableName: design.name,
          kind: 'alter_column',
          label: `Modifica colonna ${design.name}.${next.name} (${nextTypeRaw})`,
          sql: `ALTER TABLE ${qualifiedCurrent} MODIFY COLUMN ${colDef};`,
          destructive: typeChanged || (!next.nullable && base.nullable),
        });
        affectedTableIds.add(design.id);
      } else if (dialect === 'sqlserver') {
        const nullKw = next.nullable ? 'NULL' : 'NOT NULL';
        const tsqlStmts: string[] = [
          `ALTER TABLE ${qualifiedCurrent} ALTER COLUMN ${q(next.name)} ${nextTypeRaw} ${nullKw};`,
        ];
        if (normalizeDefault(baseDef) !== normalizeDefault(nextDef) && nextDef) {
          const dfName = `df_${design.name}_${next.name}`;
          tsqlStmts.push(
            `ALTER TABLE ${qualifiedCurrent} ADD CONSTRAINT ${q(dfName)} DEFAULT ${nextDef} FOR ${q(next.name)};`,
          );
        }
        changes.push({
          id: nextChangeId('chg_tsql_alter_col'),
          tableId: design.id,
          tableName: design.name,
          kind: 'alter_column',
          label: `Modifica colonna T-SQL ${design.name}.${next.name} (${nextTypeRaw})`,
          sql: tsqlStmts.join('\n'),
          destructive: typeChanged || (!next.nullable && base.nullable),
        });
        affectedTableIds.add(design.id);
      }
    }

    // Removed Foreign Keys (before dropping columns)
    for (const rfk of removedFks) {
      const fkName = rfk.name?.trim() || `fk_${baseline.name}_${rfk.columns.join('_')}`;
      const dropClause =
        dialect === 'mysql' || dialect === 'mariadb'
          ? `ALTER TABLE ${qualifiedCurrent} DROP FOREIGN KEY ${q(fkName)};`
          : `ALTER TABLE ${qualifiedCurrent} DROP CONSTRAINT ${q(fkName)};`;
      changes.push({
        id: nextChangeId('chg_drop_fk'),
        tableId: design.id,
        tableName: design.name,
        kind: 'drop_fk',
        label: `Rimuovi chiave esterna ${fkName} da ${design.name}`,
        sql: dropClause,
        destructive: true,
      });
      affectedTableIds.add(design.id);
    }

    // Removed Indexes (before dropping columns)
    for (const rIdx of removedIndexes) {
      let dropIdxSql: string;
      if (dialect === 'mysql' || dialect === 'mariadb' || dialect === 'sqlserver') {
        dropIdxSql = `DROP INDEX ${q(rIdx.name)} ON ${qualifiedCurrent};`;
      } else if (dialect === 'postgresql') {
        const schemaPrefix = resolveEffectiveSchema(dialect, design.schema);
        dropIdxSql = `DROP INDEX ${schemaPrefix ? `${q(schemaPrefix)}.` : ''}${q(rIdx.name)};`;
      } else {
        dropIdxSql = `DROP INDEX IF EXISTS ${q(rIdx.name)};`;
      }
      changes.push({
        id: nextChangeId('chg_drop_idx'),
        tableId: design.id,
        tableName: design.name,
        kind: 'drop_index',
        label: `Rimuovi indice ${rIdx.name}`,
        sql: dropIdxSql,
        destructive: false,
      });
      affectedTableIds.add(design.id);
    }

    // Dropped Columns
    for (const dropCol of droppedCols) {
      const referencedExternally = designTables.some((other) =>
        other.foreignKeys.some(
          (fk) =>
            equalSqlIdentifiers(dialect, fk.referencedTable, baseline.name) &&
            fk.referencedColumns.some((rc) => equalSqlIdentifiers(dialect, rc, dropCol.name)),
        ),
      );
      if (referencedExternally) {
        blockers.push(
          `${design.name}.${dropCol.name}: impossibile eliminare la colonna perché è riferita da una chiave esterna di un'altra tabella.`,
        );
        continue;
      }
      changes.push({
        id: nextChangeId('chg_drop_col'),
        tableId: design.id,
        tableName: design.name,
        kind: 'drop_column',
        label: `Elimina colonna ${design.name}.${dropCol.name} (perdita dati)`,
        sql: `ALTER TABLE ${qualifiedCurrent} DROP COLUMN ${q(dropCol.name)};`,
        destructive: true,
      });
      affectedTableIds.add(design.id);
    }

    // Added Indexes
    for (const aIdx of addedIndexes) {
      changes.push({
        id: nextChangeId('chg_add_idx'),
        tableId: design.id,
        tableName: design.name,
        kind: 'create_index',
        label: `Crea indice ${aIdx.name} su ${design.name}`,
        sql: compileIndexDdl(dialect, design, aIdx, false),
        destructive: false,
      });
      affectedTableIds.add(design.id);
    }

    // Added Foreign Keys (deferred after all table/column creations)
    for (const afk of addedFks) {
      const targetDesign = designTables.find(
        (other) =>
          tableObjectKey(dialect, other) ===
          tableObjectKey(dialect, {
            name: afk.referencedTable,
            schema: afk.referencedSchema ?? design.schema,
          }),
      );
      if (targetDesign) {
        try {
          checkForeignKeyTarget(dialect, targetDesign, afk.referencedColumns);
        } catch (err) {
          blockers.push(err instanceof Error ? err.message : String(err));
          continue;
        }
      }
      deferredFkChanges.push({
        id: nextChangeId('chg_add_fk'),
        tableId: design.id,
        tableName: design.name,
        kind: 'add_fk',
        label: `Aggiungi relazione ${design.name}(${afk.columns.join(', ')}) → ${afk.referencedTable}`,
        sql: `ALTER TABLE ${qualifiedCurrent} ADD ${compileForeignKeyConstraintSql(dialect, design, afk)};`,
        destructive: false,
      });
      affectedTableIds.add(design.id);
    }
  }

  changes.push(...deferredFkChanges);

  if ((dialect === 'mysql' || dialect === 'mariadb') && changes.length > 1) {
    warnings.push(
      'MySQL / MariaDB: le istruzioni DDL eseguono commit impliciti; verifica lo stato dello schema in caso di interruzione parziale.',
    );
  }

  const hasDestructiveChanges = changes.some((c) => c.destructive);
  const bodySql = changes.map((c) => `-- ${c.label}\n${c.sql}`).join('\n\n');

  let fullSql = '';
  if (changes.length === 0) {
    fullSql = `-- Nessuna differenza rilevata per ${doc.name} (${dialect}). Lo schema è allineato.\n`;
  } else if (dialect === 'sqlite') {
    const rebuild = rebuildSqliteTables.length > 0;
    fullSql = [
      `-- Piano di Migrazione Sicura SQLite (${doc.name})`,
      ...(rebuild ? ['PRAGMA foreign_keys = OFF;'] : []),
      'BEGIN IMMEDIATE;',
      bodySql,
      'PRAGMA foreign_key_check;',
      'COMMIT;',
      ...(rebuild ? ['PRAGMA foreign_keys = ON;'] : []),
    ].join('\n\n') + '\n';
  } else if (dialect === 'postgresql' || dialect === 'sqlserver') {
    const txStart = dialect === 'sqlserver' ? 'BEGIN TRANSACTION;' : 'BEGIN;';
    fullSql = [
      `-- Piano di Migrazione Transazionale (${dialect})`,
      txStart,
      bodySql,
      'COMMIT;',
    ].join('\n\n') + '\n';
  } else {
    fullSql = `-- Piano di Migrazione (${dialect})\n\n${bodySql}\n`;
  }

  return {
    dialect,
    changes,
    warnings: [...new Set(warnings)],
    blockers,
    rebuildSqliteTables,
    affectedTableIds: [...affectedTableIds],
    fullSql,
    hasDestructiveChanges,
  };
}
