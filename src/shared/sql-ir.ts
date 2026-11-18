/**
 * Canonical Shared SQL & Multi-Dialect Database Studio IR (v3.0).
 * Supports all 5 relational SQL engines (`sqlite`, `postgresql`, `mysql`, `mariadb`, `sqlserver`),
 * ER Diagram Design, Safe Schema Migrations, Visual Query Graph (*Query Rapide*), Editable Data Grid,
 * UI CRUD Synthesis, and Multi-Language Backend Codegen (`JS`, `TS`, `Python`, `Rust+Tauri`).
 *
 * Pure TypeScript, zero Node imports.
 */

export type SqlDialect = 'sqlite' | 'postgresql' | 'mysql' | 'mariadb' | 'sqlserver';

export interface SqlDialectDescriptor {
  id: SqlDialect;
  label: string;
  shortLabel: string;
  defaultPort: number | null;
  supportsSchemas: boolean;
  defaultSchema?: string;
  driverPackage: string;
  quoteExample: string;
  placeholderExample: string;
}

export const SQL_DIALECT_CATALOG: SqlDialectDescriptor[] = [
  {
    id: 'sqlite',
    label: 'SQLite 3 (Nativo Locale / :memory:)',
    shortLabel: 'SQLite',
    defaultPort: null,
    supportsSchemas: false,
    driverPackage: 'node:sqlite',
    quoteExample: '"users"',
    placeholderExample: '? / :p1',
  },
  {
    id: 'postgresql',
    label: 'PostgreSQL 17',
    shortLabel: 'PostgreSQL',
    defaultPort: 5432,
    supportsSchemas: true,
    defaultSchema: 'public',
    driverPackage: 'pg',
    quoteExample: '"public"."users"',
    placeholderExample: '$1, $2',
  },
  {
    id: 'mysql',
    label: 'MySQL 8 / 9',
    shortLabel: 'MySQL',
    defaultPort: 3306,
    supportsSchemas: false,
    driverPackage: 'mysql2',
    quoteExample: '`users`',
    placeholderExample: '?',
  },
  {
    id: 'mariadb',
    label: 'MariaDB 11',
    shortLabel: 'MariaDB',
    defaultPort: 3306,
    supportsSchemas: false,
    driverPackage: 'mysql2',
    quoteExample: '`users`',
    placeholderExample: '?',
  },
  {
    id: 'sqlserver',
    label: 'SQL Server (T-SQL)',
    shortLabel: 'SQL Server',
    defaultPort: 1433,
    supportsSchemas: true,
    defaultSchema: 'dbo',
    driverPackage: 'mssql',
    quoteExample: '[dbo].[users]',
    placeholderExample: '@p1, @p2',
  },
];

export type SqlCanonicalType =
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'varchar'
  | 'text'
  | 'uuid'
  | 'date'
  | 'datetime'
  | 'json'
  | 'blob';

export type SqlReferentialAction =
  | 'NO ACTION'
  | 'RESTRICT'
  | 'CASCADE'
  | 'SET NULL'
  | 'SET DEFAULT';

export type SqlCellType =
  | 'null'
  | 'text'
  | 'integer'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'json'
  | 'binary'
  | 'datetime';

export type SqlCellValue = string | number | boolean | null;

export type SqlDataRow = Record<string, SqlCellValue>;

export interface SqlColumnDef {
  id: string;
  name: string;
  sourceName?: string; // Tracks column renames for lossless migration planning
  canonicalType: SqlCanonicalType;
  nativeType: string; // e.g. 'INTEGER', 'TIMESTAMPTZ', 'NVARCHAR(255)', 'DECIMAL(12,2)'
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  autoIncrement: boolean;
  defaultValue?: string;
  checkExpr?: string;
  comment?: string;
}

export interface SqlForeignKeyDef {
  id: string;
  name?: string;
  columns: string[];
  referencedSchema?: string;
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: SqlReferentialAction;
  onUpdate?: SqlReferentialAction;
}

export interface SqlIndexDef {
  id: string;
  name: string;
  columns: string[];
  unique: boolean;
  whereClause?: string;
}

export interface SqlCheckConstraintDef {
  id: string;
  name?: string;
  expression: string;
}

export interface SqlTableSnapshot {
  schema?: string;
  name: string;
  columns: SqlColumnDef[];
  foreignKeys: SqlForeignKeyDef[];
  indexes: SqlIndexDef[];
  checks: SqlCheckConstraintDef[];
  hasDependentViewsOrTriggers?: boolean;
  hasGeneratedColumns?: boolean;
}

export interface SqlTableDef {
  id: string;
  schema?: string;
  name: string;
  columns: SqlColumnDef[];
  foreignKeys: SqlForeignKeyDef[];
  indexes: SqlIndexDef[];
  checks: SqlCheckConstraintDef[];
  position: { x: number; y: number };
  comment?: string;
  baselineSnapshot?: SqlTableSnapshot;
}

// ============================================================================
// VISUAL QUERY COMPOSER ("QUERY RAPIDE" OPERATION GRAPH) & NAMED QUERIES
// ============================================================================

export interface SqlOperationJoinSpec {
  id: string;
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  table: string;
  alias?: string;
  leftColumn: string;
  rightColumn: string;
}

export interface SqlOperationFilterSpec {
  id: string;
  column: string;
  operator:
    | '='
    | '!='
    | '>'
    | '>='
    | '<'
    | '<='
    | 'LIKE'
    | 'ILIKE'
    | 'IN'
    | 'IS NULL'
    | 'IS NOT NULL';
  value?: string;
  parameterName?: string;
}

export interface SqlOperationAggregateSpec {
  id: string;
  fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  column: string;
  alias: string;
}

export interface SqlOperationOrderSpec {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface SqlOperationGraphDraft {
  kind: 'select' | 'insert' | 'update' | 'delete';
  sourceTable: string;
  sourceAlias?: string;
  selectedColumns: string[];
  distinct?: boolean;
  joins: SqlOperationJoinSpec[];
  filters: SqlOperationFilterSpec[];
  filterCombinator?: 'AND' | 'OR';
  groupBy: string[];
  aggregates: SqlOperationAggregateSpec[];
  orderBy: SqlOperationOrderSpec[];
  limit?: number;
  offset?: number;
  writeValues?: Array<{ column: string; valueExpr: string; isParam?: boolean }>;
}

export interface SqlNamedQueryDef {
  id: string;
  name: string;
  description?: string;
  kind: 'select' | 'insert' | 'update' | 'delete' | 'custom';
  targetTable?: string;
  canonicalSql: string;
  /** Runtime alias of `canonicalSql` (read by Live Sandbox / automation runners). Optional; producers mirror `canonicalSql`. */
  sql?: string;
  sqlByDialect?: Partial<Record<SqlDialect, string>>;
  operationGraph?: SqlOperationGraphDraft;
  parameters: Array<{
    name: string;
    type: SqlCanonicalType;
    required: boolean;
    sampleValue?: SqlCellValue;
  }>;
  returnColumns?: Array<{
    name: string;
    type: SqlCanonicalType;
    nullable: boolean;
  }>;
}

export interface SqlTableSeedRows {
  tableName: string;
  rows: SqlDataRow[];
}

export interface SqlDesignDocument {
  version: 1;
  id: string;
  projectId: string;
  name: string;
  dialect: SqlDialect;
  databaseFileRelPath?: string; // e.g. "data/app.sqlite"
  tables: SqlTableDef[];
  removedTables?: Array<Pick<SqlTableDef, 'id' | 'schema' | 'name'>>;
  namedQueries: SqlNamedQueryDef[];
  seedRows: SqlTableSeedRows[];
  updatedAt: number;
}

// ============================================================================
// CONNECTIONS, EXECUTION, EDITABLE DATA GRID, MIGRATIONS & MULTI-LANG CODEGEN
// ============================================================================

export interface SqlConnectionProfile {
  id: string;
  projectId: string;
  name: string;
  dialect: SqlDialect;
  mode: 'local_sqlite' | 'memory_sandbox' | 'remote';
  sqliteFilePath?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  ssl?: boolean;
  envVarRef?: string; // e.g. "DATABASE_URL"
  hasStoredSecret?: boolean;
  readOnly?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SqlQueryRequest {
  projectId: string;
  connectionId?: string | null;
  sandboxMode?: boolean;
  dialect?: SqlDialect;
  sql: string;
  parameters?: SqlCellValue[] | Record<string, SqlCellValue>;
  readOnly?: boolean;
  maxRows?: number;
  schemaDoc?: SqlDesignDocument;
}

export interface SqlResultColumnMeta {
  name: string;
  nativeType?: string;
  cellType?: SqlCellType;
  primaryKey?: boolean;
  nullable?: boolean;
}

export interface SqlQueryResult {
  ok: boolean;
  dialect: SqlDialect;
  columns: SqlResultColumnMeta[];
  rows: SqlDataRow[];
  rowCount: number;
  affectedRows?: number;
  lastInsertId?: string | number | null;
  truncated?: boolean;
  durationMs: number;
  executedSql: string;
  explanation?: string;
  error?: string;
}

export interface SqlDataChange {
  id?: string;
  kind: 'insert' | 'update' | 'delete';
  primaryKey: Record<string, SqlCellValue>;
  originalRow?: SqlDataRow;
  values?: Record<string, SqlCellValue>;
}

export interface SqlMigrationChange {
  id: string;
  tableId?: string;
  tableName: string;
  kind:
    | 'create_table'
    | 'drop_table'
    | 'rename_table'
    | 'add_column'
    | 'alter_column'
    | 'drop_column'
    | 'rebuild_sqlite_table'
    | 'create_index'
    | 'drop_index'
    | 'add_fk'
    | 'drop_fk';
  label: string;
  sql: string;
  destructive: boolean;
}

export interface SqlMigrationPlan {
  dialect: SqlDialect;
  changes: SqlMigrationChange[];
  warnings: string[];
  blockers: string[];
  rebuildSqliteTables: string[];
  affectedTableIds: string[];
  fullSql: string;
  hasDestructiveChanges: boolean;
  sqliteSchemaFingerprint?: string;
}

export interface SqlQueryHistoryEntry {
  id: string;
  projectId: string;
  connectionId: string | null;
  dialect: SqlDialect;
  sql: string;
  durationMs: number;
  rowCount: number;
  ok: boolean;
  error?: string;
  executedAt: number;
}

export type SqlCodegenTargetKind =
  | 'js-node'
  | 'ts-drizzle'
  | 'ts-prisma'
  | 'ts-kysely'
  | 'ts-nextjs'
  | 'python-fastapi'
  | 'rust-tauri';

export interface GenerateSqlCodeRequest {
  schema: SqlDesignDocument;
  targetKind: SqlCodegenTargetKind;
  dialect?: SqlDialect;
  includeRestRoutes?: boolean;
  includeSeedScript?: boolean;
}

export interface ExtractedSqlOperation {
  filePath: string;
  line: number;
  language: string;
  kind: 'ddl' | 'select' | 'insert' | 'update' | 'delete' | 'raw';
  sql: string;
  parameters: string[];
  enclosingFn?: string;
}

export function createStarterSqlDocument(
  projectId: string,
  projectName = 'Studio Database',
  dialect: SqlDialect = 'sqlite',
): SqlDesignDocument {
  const now = Date.now();
  const defaultSchema =
    dialect === 'postgresql' ? 'public' : dialect === 'sqlserver' ? 'dbo' : undefined;

  const customersTable: SqlTableDef = {
    id: 'tbl_customers',
    schema: defaultSchema,
    name: 'customers',
    position: { x: 64, y: 64 },
    comment: 'Anagrafica clienti registrati',
    columns: [
      {
        id: 'col_cust_id',
        name: 'id',
        canonicalType: 'integer',
        nativeType: 'INTEGER',
        nullable: false,
        primaryKey: true,
        unique: true,
        autoIncrement: true,
      },
      {
        id: 'col_cust_full_name',
        name: 'full_name',
        canonicalType: 'varchar',
        nativeType: 'VARCHAR(140)',
        length: 140,
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
      },
      {
        id: 'col_cust_email',
        name: 'email',
        canonicalType: 'varchar',
        nativeType: 'VARCHAR(180)',
        length: 180,
        nullable: false,
        primaryKey: false,
        unique: true,
        autoIncrement: false,
      },
      {
        id: 'col_cust_tier',
        name: 'tier',
        canonicalType: 'varchar',
        nativeType: 'VARCHAR(32)',
        length: 32,
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
        defaultValue: "'standard'",
        checkExpr: "tier IN ('standard', 'pro', 'enterprise')",
      },
      {
        id: 'col_cust_active',
        name: 'is_active',
        canonicalType: 'boolean',
        nativeType: dialect === 'sqlite' ? 'INTEGER' : dialect === 'sqlserver' ? 'BIT' : dialect === 'mysql' ? 'TINYINT(1)' : 'BOOLEAN',
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
        defaultValue: dialect === 'postgresql' ? 'TRUE' : '1',
      },
      {
        id: 'col_cust_created',
        name: 'created_at',
        canonicalType: 'datetime',
        nativeType:
          dialect === 'postgresql'
            ? 'TIMESTAMPTZ'
            : dialect === 'sqlserver'
              ? 'DATETIME2'
              : 'DATETIME',
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
        defaultValue: 'CURRENT_TIMESTAMP',
      },
    ],
    foreignKeys: [],
    indexes: [
      {
        id: 'idx_customers_email',
        name: 'idx_customers_email',
        columns: ['email'],
        unique: true,
      },
    ],
    checks: [
      {
        id: 'chk_customers_tier',
        name: 'chk_customers_tier',
        expression: "tier IN ('standard', 'pro', 'enterprise')",
      },
    ],
  };

  const ordersTable: SqlTableDef = {
    id: 'tbl_orders',
    schema: defaultSchema,
    name: 'orders',
    position: { x: 460, y: 64 },
    comment: 'Ordini collegati ai clienti tramite chiave esterna',
    columns: [
      {
        id: 'col_ord_id',
        name: 'id',
        canonicalType: 'integer',
        nativeType: 'INTEGER',
        nullable: false,
        primaryKey: true,
        unique: true,
        autoIncrement: true,
      },
      {
        id: 'col_ord_customer_id',
        name: 'customer_id',
        canonicalType: 'integer',
        nativeType: 'INTEGER',
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
      },
      {
        id: 'col_ord_total',
        name: 'total_eur',
        canonicalType: 'decimal',
        nativeType: 'DECIMAL(10,2)',
        precision: 10,
        scale: 2,
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
        defaultValue: '0.00',
        checkExpr: 'total_eur >= 0',
      },
      {
        id: 'col_ord_status',
        name: 'status',
        canonicalType: 'varchar',
        nativeType: 'VARCHAR(32)',
        length: 32,
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
        defaultValue: "'pending'",
        checkExpr: "status IN ('pending', 'paid', 'shipped', 'cancelled')",
      },
      {
        id: 'col_ord_created',
        name: 'created_at',
        canonicalType: 'datetime',
        nativeType:
          dialect === 'postgresql'
            ? 'TIMESTAMPTZ'
            : dialect === 'sqlserver'
              ? 'DATETIME2'
              : 'DATETIME',
        nullable: false,
        primaryKey: false,
        unique: false,
        autoIncrement: false,
        defaultValue: 'CURRENT_TIMESTAMP',
      },
    ],
    foreignKeys: [
      {
        id: 'fk_orders_customer',
        name: 'fk_orders_customer',
        columns: ['customer_id'],
        referencedSchema: defaultSchema,
        referencedTable: 'customers',
        referencedColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ],
    indexes: [
      {
        id: 'idx_orders_customer_id',
        name: 'idx_orders_customer_id',
        columns: ['customer_id'],
        unique: false,
      },
    ],
    checks: [
      {
        id: 'chk_orders_total_nonneg',
        name: 'chk_orders_total_nonneg',
        expression: 'total_eur >= 0',
      },
    ],
  };

  const namedQueries: SqlNamedQueryDef[] = [
    {
      id: 'qry_list_customers',
      name: 'listActiveCustomers',
      description: 'Elenca i clienti attivi ordinati per ID decrescente',
      kind: 'select',
      targetTable: 'customers',
      canonicalSql:
        'SELECT id, full_name, email, tier, is_active, created_at FROM customers ORDER BY id DESC',
      sql: 'SELECT id, full_name, email, tier, is_active, created_at FROM customers ORDER BY id DESC',
      parameters: [],
      returnColumns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'full_name', type: 'varchar', nullable: false },
        { name: 'email', type: 'varchar', nullable: false },
        { name: 'tier', type: 'varchar', nullable: false },
        { name: 'is_active', type: 'boolean', nullable: false },
        { name: 'created_at', type: 'datetime', nullable: false },
      ],
      operationGraph: {
        kind: 'select',
        sourceTable: 'customers',
        selectedColumns: ['id', 'full_name', 'email', 'tier', 'is_active', 'created_at'],
        joins: [],
        filters: [],
        groupBy: [],
        aggregates: [],
        orderBy: [{ column: 'id', direction: 'DESC' }],
        limit: 100,
      },
    },
    {
      id: 'qry_orders_with_customer',
      name: 'listOrdersWithCustomer',
      description: 'Riepilogo ordini con nome ed email cliente (INNER JOIN)',
      kind: 'select',
      targetTable: 'orders',
      canonicalSql:
        'SELECT o.id, c.full_name, c.email, o.total_eur, o.status, o.created_at FROM orders o INNER JOIN customers c ON o.customer_id = c.id ORDER BY o.id DESC',
      sql: 'SELECT o.id, c.full_name, c.email, o.total_eur, o.status, o.created_at FROM orders o INNER JOIN customers c ON o.customer_id = c.id ORDER BY o.id DESC',
      parameters: [],
    },
  ];

  const seedRows: SqlTableSeedRows[] = [
    {
      tableName: 'customers',
      rows: [
        {
          id: 1,
          full_name: 'Giulia Conti',
          email: 'giulia.conti@studio.it',
          tier: 'enterprise',
          is_active: 1,
          created_at: '2026-03-10 09:30:00',
        },
        {
          id: 2,
          full_name: 'Marco Bellini',
          email: 'marco.bellini@azienda.it',
          tier: 'pro',
          is_active: 1,
          created_at: '2026-03-11 14:15:00',
        },
        {
          id: 3,
          full_name: 'Sara Ferri',
          email: 'sara.ferri@design.it',
          tier: 'standard',
          is_active: 1,
          created_at: '2026-03-12 11:00:00',
        },
      ],
    },
    {
      tableName: 'orders',
      rows: [
        {
          id: 101,
          customer_id: 1,
          total_eur: '1490.00',
          status: 'paid',
          created_at: '2026-03-12 10:12:00',
        },
        {
          id: 102,
          customer_id: 2,
          total_eur: '420.50',
          status: 'shipped',
          created_at: '2026-03-13 16:40:00',
        },
      ],
    },
  ];

  return {
    version: 1,
    id: `sql_${projectId}`,
    projectId,
    name: `${projectName} Schema`,
    dialect,
    databaseFileRelPath: 'data/app.sqlite',
    tables: [customersTable, ordersTable],
    namedQueries,
    seedRows,
    updatedAt: now,
  };
}
