import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { compileSchemaDdl } from '@shared/sql-dialects';
import { createStarterSqlDocument } from '@shared/sql-ir';

const instance = process.env.STUDIO_TSQL_TEST_INSTANCE;

it.skipIf(!/^studio_qa_[a-z0-9]+$/.test(instance ?? ''))('executes generated T-SQL on disposable SQL Server LocalDB', () => {
  const document = createStarterSqlDocument('sqlserver_test', 'T-SQL test', 'sqlserver');
  const ddl = compileSchemaDdl(document, { dialect: 'sqlserver', includeSeeds: true, ifNotExists: true });
  const database = `${instance}_ddl`;
  const run = (input: string) => execFileSync('sqlcmd', [
    '-S', `(localdb)\\${instance}`, '-E', '-C', '-b', '-l', '12', '-h', '-1', '-W',
  ], { input, encoding: 'utf8', windowsHide: true, timeout: 18_000 });
  run(`CREATE DATABASE [${database}];\nGO\n`);
  try {
    const output = run(`USE [${database}];\nGO\n${ddl}\nGO\n`
      + "INSERT INTO [dbo].[customers] ([full_name], [email]) VALUES (N'Cliente TSQL', N'tsql@example.test');\n"
      + "SELECT [full_name] FROM [dbo].[customers] WHERE [email] = N'tsql@example.test';\nGO\n");
    expect(output).toContain('Cliente TSQL');
  } finally {
    run(`DROP DATABASE [${database}];\nGO\n`);
  }
});
