import { describe, expect, it } from 'vitest';
import { createStarterSqlDocument } from '@shared/sql-ir';
import { generateSqlCodeBundle } from '../src/workers/codegen-worker/sql-codegen';

describe('SQLite ORM exports', () => {
  it('exports an initialized Drizzle client and typed writes with SQLite defaults', () => {
    const schema = createStarterSqlDocument('drizzle-smoke', 'Drizzle Smoke', 'sqlite');
    const bundle = generateSqlCodeBundle({ schema, targetKind: 'ts-drizzle', dialect: 'sqlite' });
    const files = new Map(bundle.files.map((file) => [file.relativePath, file.code]));

    expect(files.get('src/db/client.ts')).toContain('drizzle({ client: sqliteConnection })');
    expect(files.get('src/db/client.ts')).toContain('initDatabaseSchema');
    expect(files.get('src/db/queries.ts')).toContain('updateCustomersById(db: StudioDatabase');
    expect(files.get('src/db/queries.ts')).toContain('.where(eq(schema.customers.id, id)).returning()');
    expect(files.get('src/db/schema.ts')).toContain('.default(sql.raw("\'standard\'"))');

    for (const customer of schema.tables.filter((table) => table.name === 'customers')) {
      customer.columns = customer.columns.map((column) => ({ ...column, primaryKey: false, autoIncrement: false }));
    }
    const noPrimaryKey = generateSqlCodeBundle({ schema, targetKind: 'ts-drizzle', dialect: 'sqlite' });
    expect(noPrimaryKey.files.find((file) => file.relativePath === 'src/db/queries.ts')?.code).not.toContain('updateCustomersById');
  });

  it('preserves SQLite defaults and foreign key actions in a Prisma 6 schema', () => {
    const schema = createStarterSqlDocument('prisma-smoke', 'Prisma Smoke', 'sqlite');
    const bundle = generateSqlCodeBundle({ schema, targetKind: 'ts-prisma', dialect: 'sqlite' });
    const code = bundle.files.find((file) => file.relativePath === 'prisma/schema.prisma')?.code;

    expect(code).toContain('tier String @default("standard")');
    expect(code).toContain('isActive Boolean @default(true)');
    expect(code).toContain('totalEur Decimal @default(0.00)');
    expect(code).toContain('createdAt DateTime @default(now())');
    expect(code).toContain('onDelete: Cascade, onUpdate: NoAction');
  });
});
