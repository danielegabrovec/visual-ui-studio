import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { compileTableDdl } from '@shared/sql-dialects';
import { createStarterSqlDocument, type SqlConnectionProfile } from '@shared/sql-ir';
import { SqlStudioEngine } from '../src/workers/db-worker/sql-studio-engine';

for (const dialect of ['mariadb', 'mysql'] as const) {
  const prefix = dialect === 'mariadb' ? 'STUDIO_MARIADB_TEST' : 'STUDIO_MYSQL_TEST';
  const port = Number(process.env[`${prefix}_PORT`]);
  const database = process.env[`${prefix}_DATABASE`];
  const password = process.env[`${prefix}_PASSWORD`];

  it.skipIf(!Number.isInteger(port) || port <= 0 || !database?.startsWith('studio_qa_'))(
    `uses the ${dialect} adapter against a disposable local instance`,
    async () => {
      const engine = new SqlStudioEngine();
      const projectId = `studio_${dialect}_test`;
      const fixture = `studio_customer_${Date.now().toString(36)}`;
      const copy = `${fixture}_copy`;
      const profile: SqlConnectionProfile = {
        id: 'qa_test', projectId, name: `${dialect} test`, dialect, mode: 'remote',
        host: '127.0.0.1', port, database, username: 'root', ssl: false, createdAt: 0, updatedAt: 0,
      };
      const ctx = { projectId, profile, storageProjectDir: tmpdir(), rootDiskPath: null, decryptedSecret: password };
      const sample = createStarterSqlDocument(projectId, `${dialect} test`, dialect);
      const schemaDoc = { ...sample, tables: [{ ...sample.tables[0], name: fixture }], seedRows: [] };
      const query = (sql: string, parameters?: string[]) => engine.executeQuery({
        ...ctx, schemaDoc, req: { projectId, sql, parameters, connectionId: profile.id },
      });

      try {
        const connection = await engine.testConnection(ctx);
        expect(connection.ok, connection.message).toBe(true);
        expect(connection.version?.includes('MariaDB')).toBe(dialect === 'mariadb');
        const plan = await engine.compileMigration({ ...ctx, schemaDoc, connectionId: profile.id });
        expect(plan.blockers).toEqual([]);
        expect(plan.fullSql).toContain(fixture);
        expect(await engine.applyMigration({ ...ctx, schemaDoc, plan, connectionId: profile.id })).toMatchObject({ ok: true });
        expect(await query(`INSERT INTO \`${fixture}\` (full_name, email) VALUES (?, ?)`, ['Cliente QA', 'client@example.test']))
          .toMatchObject({ ok: true, affectedRows: 1 });
        expect(await query(`SELECT full_name, tier FROM \`${fixture}\` WHERE email = ?`, ['client@example.test']))
          .toMatchObject({ ok: true, rows: [{ full_name: 'Cliente QA', tier: 'standard' }] });
        expect(await query(`ALTER TABLE \`${fixture}\` ADD COLUMN theme ENUM('light','dark') NOT NULL DEFAULT 'light'`))
          .toMatchObject({ ok: true });
        const introspected = await engine.introspectConnection(ctx);
        const table = introspected.tables.find((entry) => entry.name === fixture);
        expect(table).toBeDefined();
        expect(table?.columns.find((entry) => entry.name === 'id')).toMatchObject({ primaryKey: true, autoIncrement: true });
        expect(table?.columns.find((entry) => entry.name === 'is_active')?.canonicalType).toBe('boolean');
        expect(table?.columns.find((entry) => entry.name === 'tier')?.defaultValue).toBe("'standard'");
        expect(table?.columns.find((entry) => entry.name === 'theme')?.nativeType).toBe("ENUM('light','dark')");
        expect(await query(compileTableDdl(dialect, { ...table!, name: copy }))).toMatchObject({ ok: true });
        expect(await query(`INSERT INTO \`${copy}\` (full_name, email) VALUES (?, ?)`, ['Cliente roundtrip', 'clone@example.test']))
          .toMatchObject({ ok: true, affectedRows: 1 });
        expect(await query(`SELECT tier, theme FROM \`${copy}\` WHERE email = ?`, ['clone@example.test']))
          .toMatchObject({ ok: true, rows: [{ tier: 'standard', theme: 'light' }] });
      } finally {
        await query(`DROP TABLE IF EXISTS \`${copy}\``);
        await query(`DROP TABLE IF EXISTS \`${fixture}\``);
        engine.closeAll();
      }
    },
    30_000,
  );
}
