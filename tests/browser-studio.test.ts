import { createBrowserStudioApi } from '@renderer/api/studio-client';
import { expect, it } from 'vitest';

it('generates real SQL previews from the browser project and reports desktop-only execution', async () => {
  const api = createBrowserStudioApi();
  const { project } = await api.project.getCurrent();
  const schemaDoc = await api.sql.loadSchema(project.id);
  const plan = await api.sql.compileMigration({ projectId: project.id, schemaDoc });
  expect(plan.fullSql).toMatch(/CREATE TABLE/i);

  await api.vfs.createEntry({
    projectId: project.id,
    parentId: null,
    name: 'verification.sql',
    entryKind: 'sql_file',
    initialContent: 'SELECT 23 AS test_value;',
  });
  expect(await api.sql.extractSqlFromProjectFiles(project.id)).toContainEqual(
    expect.objectContaining({ sql: expect.stringMatching(/SELECT 23 AS test_value/i) }),
  );
  expect(await api.sql.executeQuery({ projectId: project.id, sql: 'SELECT 23' })).toMatchObject({
    ok: false,
    rows: [],
    error: expect.stringContaining('desktop'),
  });
  expect(await api.sql.applyMigration({ projectId: project.id, plan })).toMatchObject({ ok: false });
  const doctor = await api.toolchain.checkDoctor();
  expect(doctor.node.available).toBe(false);
  await expect(api.toolchain.runTask({ projectId: project.id, kind: 'dev' })).rejects.toThrow('desktop');
});
