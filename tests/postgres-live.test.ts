import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createStarterSqlDocument, type SqlConnectionProfile } from '@shared/sql-ir';
import { SqlStudioEngine } from '../src/workers/db-worker/sql-studio-engine';

const port = Number(process.env.STUDIO_PG_TEST_PORT);
const password = process.env.STUDIO_PG_TEST_PASSWORD;

it.skipIf(!port || !password)('uses the PostgreSQL adapter against a disposable local instance', async () => {
  const engine = new SqlStudioEngine();
  const projectId = 'studio_pg_test';
  const fixture = 'studio_pg_' + Date.now().toString(36);
  const profile: SqlConnectionProfile = {
    id: 'pg_test', projectId, name: 'PostgreSQL test', dialect: 'postgresql', mode: 'remote',
    host: '127.0.0.1', port, database: 'postgres', username: 'studio_qa', ssl: false,
    createdAt: 0, updatedAt: 0,
  };
  const ctx = { projectId, profile, storageProjectDir: tmpdir(), rootDiskPath: null, decryptedSecret: password };
  const sample = createStarterSqlDocument(projectId, 'PostgreSQL test', 'postgresql');
  const schemaDoc = { ...sample, tables: [{ ...sample.tables[0], name: fixture }], seedRows: [] };
  const query = (sql: string, parameters?: string[]) => engine.executeQuery({
    ...ctx, schemaDoc, req: { projectId, sql, parameters, connectionId: profile.id },
  });

  try {
    expect(await engine.testConnection(ctx)).toMatchObject({ ok: true, version: expect.stringContaining('PostgreSQL') });
    const plan = await engine.compileMigration({ ...ctx, schemaDoc, connectionId: profile.id });
    expect(plan.blockers).toEqual([]);
    expect(plan.fullSql).toContain(fixture);
    expect(await engine.applyMigration({ ...ctx, schemaDoc, plan, connectionId: profile.id })).toMatchObject({ ok: true });
    expect((await engine.introspectConnection(ctx)).tables).toContainEqual(expect.objectContaining({ name: fixture, schema: 'public' }));
    expect(await query(`INSERT INTO "${fixture}" (full_name, email) VALUES ($1, $2)`, ['Cliente PostgreSQL', 'pg@example.test']))
      .toMatchObject({ ok: true, affectedRows: 1 });
    expect(await query(`SELECT full_name FROM "${fixture}" WHERE email = $1`, ['pg@example.test']))
      .toMatchObject({ ok: true, rows: [{ full_name: 'Cliente PostgreSQL' }] });
  } finally {
    await query(`DROP TABLE IF EXISTS "${fixture}"`);
    engine.closeAll();
  }
});
