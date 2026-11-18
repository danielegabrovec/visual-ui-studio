import { compileSchemaDdl, resolveEffectiveSchema } from '@shared/sql-dialects';
import type { SqlColumnDef, SqlDesignDocument, SqlDialect } from '@shared/sql-ir';
import type { EmittedCodeFile } from '@shared/ui-ir';

const driverPackages: Record<SqlDialect, string> = {
  sqlite: 'kysely',
  postgresql: 'kysely pg',
  mysql: 'kysely mysql2',
  mariadb: 'kysely mysql2',
  sqlserver: 'kysely tedious tarn',
};

export function describeKyselySetup(dialect: SqlDialect): string {
  return `Installa ${driverPackages[dialect]} e applica db/schema.sql al database.${dialect === 'sqlite'
    ? ' Il client SQLite usa node:sqlite (Node 22.16 o successivo) e SQLITE_PATH.'
    : dialect === 'sqlserver'
      ? ' Imposta MSSQL_HOST, MSSQL_DATABASE, MSSQL_USER e MSSQL_PASSWORD.'
      : ' Imposta DATABASE_URL.'}`;
}

export function firstUnsupportedKyselyIdentifier(doc: SqlDesignDocument, dialect: SqlDialect): string | undefined {
  return doc.tables.flatMap((table) => [
    resolveEffectiveSchema(dialect, table.schema) ?? '',
    table.name.trim(),
    ...table.columns.map((column) => column.name.trim()),
  ]).find((name) => name.includes('.') || name.includes(' as '));
}

function columnType(column: SqlColumnDef, dialect: SqlDialect): string {
  let read: string;
  let write: string | undefined;
  switch (column.canonicalType) {
    case 'integer':
      read = dialect === 'sqlite' ? 'bigint' : 'number';
      if (dialect === 'sqlite') write = 'number | bigint';
      break;
    case 'bigint':
      read = dialect === 'sqlite' ? 'bigint' : 'string';
      write = dialect === 'sqlite' ? 'number | bigint' : dialect === 'sqlserver' ? 'bigint' : 'string';
      break;
    case 'decimal':
      read = dialect === 'sqlite' ? 'bigint | number' : dialect === 'sqlserver' ? 'number' : 'string';
      break;
    case 'float':
      read = 'number';
      break;
    case 'boolean':
      read = dialect === 'sqlite' ? '0n | 1n' : dialect === 'mysql' || dialect === 'mariadb' ? '0 | 1' : 'boolean';
      if (dialect === 'sqlite') write = 'boolean | 0 | 1 | 0n | 1n';
      break;
    case 'date':
    case 'datetime':
      read = dialect === 'postgresql' || dialect === 'sqlserver' ? 'Date' : 'string';
      break;
    case 'json':
      read = dialect === 'postgresql' || dialect === 'mysql' ? 'unknown' : 'string';
      write = 'string';
      break;
    case 'blob':
      read = 'Uint8Array';
      break;
    default:
      read = 'string';
  }

  if (column.nullable && !column.primaryKey) {
    read = `${read} | null`;
    if (write) write = `${write} | null`;
  }
  if (column.autoIncrement) return `ColumnType<${read}, never, never>`;
  if (write || column.primaryKey || column.defaultValue !== undefined) {
    const writable = write ?? read;
    const insert = column.defaultValue !== undefined ? `${writable} | undefined` : writable;
    return `ColumnType<${read}, ${insert}, ${column.primaryKey ? 'never' : writable}>`;
  }
  return read;
}

function buildClient(doc: SqlDesignDocument, dialect: SqlDialect): string {
  let dialectSetup: string;
  if (dialect === 'sqlite') {
    dialectSetup = `import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Kysely, SqliteDialect } from 'kysely';

function bindings(parameters: readonly unknown[]): SQLInputValue[] {
  return parameters.map((value) => {
    if (typeof value === 'boolean') return Number(value);
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array) return value;
    throw new TypeError('Unsupported SQLite bind value');
  });
}

const dialect = new SqliteDialect({
  async database() {
    const path = process.env.SQLITE_PATH || resolve(${JSON.stringify(doc.databaseFileRelPath || 'data/app.sqlite')});
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const sqlite = new DatabaseSync(path);
    sqlite.exec('PRAGMA foreign_keys = ON');
    return {
      close: () => sqlite.close(),
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        statement.setReadBigInts(true);
        return {
          reader: statement.columns().length > 0,
          all: (parameters) => statement.all(...bindings(parameters)),
          run: (parameters) => statement.run(...bindings(parameters)),
          iterate: (parameters) => statement.iterate(...bindings(parameters)),
        };
      },
    };
  },
});`;
  } else if (dialect === 'postgresql') {
    dialectSetup = `import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const dialect = new PostgresDialect({ pool: new Pool({ connectionString: url }) });`;
  } else if (dialect === 'mysql' || dialect === 'mariadb') {
    dialectSetup = `import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const dialect = new MysqlDialect({
  pool: createPool({ uri: url, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true }),
});`;
  } else {
    dialectSetup = `import { Kysely, MssqlDialect } from 'kysely';
import * as Tarn from 'tarn';
import * as Tedious from 'tedious';

const server = process.env.MSSQL_HOST;
const database = process.env.MSSQL_DATABASE;
const userName = process.env.MSSQL_USER;
const password = process.env.MSSQL_PASSWORD;
if (!server || !database || !userName || password === undefined) {
  throw new Error('MSSQL_HOST, MSSQL_DATABASE, MSSQL_USER and MSSQL_PASSWORD are required');
}
const dialect = new MssqlDialect({
  tarn: { ...Tarn, options: { min: 0, max: 10 } },
  tedious: {
    ...Tedious,
    connectionFactory: () => new Tedious.Connection({
      server,
      authentication: { type: 'default', options: { userName, password } },
      options: { database, port: Number(process.env.MSSQL_PORT || 1433), encrypt: true },
    }),
  },
});`;
  }

  return `import type { Database } from './kysely-schema.js';
${dialectSetup}

export const db = new Kysely<Database>({ dialect });
`;
}

export function emitKyselyBundle(doc: SqlDesignDocument, dialect: SqlDialect, includeSeeds: boolean): EmittedCodeFile[] {
  const isMysql = dialect === 'mysql' || dialect === 'mariadb';
  const schema = ["import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely';\n"];
  const imports = ["import { db } from './kysely-client.js';", "import type { Kysely } from 'kysely';"];
  if (isMysql) imports.push("import { InsertResult, sql } from 'kysely';");
  const tables: string[] = [];
  const functions: string[] = [];

  for (const [index, table] of doc.tables.entries()) {
    const schemaName = resolveEffectiveSchema(dialect, table.schema);
    const tableName = schemaName ? `${schemaName}.${table.name.trim()}` : table.name.trim();
    const prefix = table.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table';
    const name = `Table_${prefix}_${index + 1}`;
    const tableLiteral = JSON.stringify(tableName);
    const primaryKeys = table.columns.filter((column) => column.primaryKey);
    const canUpdate = primaryKeys.length > 0 && table.columns.some((column) => !column.primaryKey && !column.autoIncrement);
    const keyType = primaryKeys.length > 0 ? `${name}Key` : undefined;
    const predicates = primaryKeys.map(({ name: columnName }) => {
      const identifier = JSON.stringify(columnName.trim());
      return `.where(${identifier}, '=', key[${identifier}])`;
    }).join('');
    const ordering = primaryKeys.map(({ name: columnName }) => `.orderBy(${JSON.stringify(columnName.trim())})`).join('');

    schema.push(`export interface ${name} {
${table.columns.map((column) => `  ${JSON.stringify(column.name.trim())}: ${columnType(column, dialect)};`).join('\n')}
}
export type ${name}Row = Selectable<${name}>;
export type ${name}Insert = Insertable<${name}>;`);
    if (keyType) schema.push(`export type ${keyType} = Pick<${name}Row, ${primaryKeys.map(({ name }) => JSON.stringify(name.trim())).join(' | ')}>;`);
    if (canUpdate) schema.push(`export type ${name}Update = Updateable<${name}>;`);
    schema.push('');
    tables.push(`  ${tableLiteral}: ${name};`);
    imports.push(`import type { ${[`${name}Insert`, keyType, canUpdate ? `${name}Update` : undefined].filter(Boolean).join(', ')} } from './kysely-schema.js';`);

    const defaultInsert = isMysql
      ? `const result = await sql\`insert into \${sql.table(${tableLiteral})} () values ()\`.execute(connection);
        return new InsertResult(result.insertId, result.numAffectedRows);`
      : `return connection.insertInto(${tableLiteral}).defaultValues().executeTakeFirstOrThrow();`;
    functions.push(`export function create${name}Repository(connection: Kysely<Database> = db) {
  return {
    list: () => connection.selectFrom(${tableLiteral}).selectAll()${ordering}.execute(),
    async insert(values: ${name}Insert) {
      if (Object.values(values).every((value) => value === undefined)) {
        ${defaultInsert}
      }
      return connection.insertInto(${tableLiteral}).values(values).executeTakeFirstOrThrow();
    },${keyType ? `
    findByKey: (key: ${keyType}) => connection.selectFrom(${tableLiteral}).selectAll()${predicates}.executeTakeFirst(),
    removeByKey: (key: ${keyType}) => connection.deleteFrom(${tableLiteral})${predicates}.executeTakeFirstOrThrow(),` : ''}${canUpdate ? `
    async updateByKey(key: ${keyType}, values: ${name}Update) {
      if (Object.values(values).every((value) => value === undefined)) throw new Error('Provide at least one value to update');
      return connection.updateTable(${tableLiteral}).set(values)${predicates}.executeTakeFirstOrThrow();
    },` : ''}
  };
}`);
  }

  schema.push('export interface Database {', ...tables, '}', '');
  imports.push("import type { Database } from './kysely-schema.js';");
  return [
    { relativePath: 'src/db/kysely-repository.ts', language: 'typescript', code: [...imports, '', ...functions, ''].join('\n'), isEntry: true, sourceMap: [], diagnostics: [] },
    { relativePath: 'src/db/kysely-schema.ts', language: 'typescript', code: schema.join('\n'), sourceMap: [], diagnostics: [] },
    { relativePath: 'src/db/kysely-client.ts', language: 'typescript', code: buildClient(doc, dialect), sourceMap: [], diagnostics: [] },
    { relativePath: 'db/schema.sql', language: 'sql', code: compileSchemaDdl(doc, { dialect, ifNotExists: true, includeSeeds }), sourceMap: [], diagnostics: [] },
  ];
}
