import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('creates and edits disk projects, applies CSS and JavaScript, and generates UI from SQLite', async ({}, testInfo) => {
  const tempDir = testInfo.outputPath('workspace');
  const projectParent = join(tempDir, 'projects');
  const existingProject = join(tempDir, 'existing-project');
  mkdirSync(projectParent, { recursive: true });
  mkdirSync(join(existingProject, 'scripts'), { recursive: true });
  const originalHtml = '<!doctype html><html><body><main><h1>Progetto esistente</h1><button id="run">Avvia azione</button><p id="status">In attesa</p></main></body></html>';
  const originalJs = 'export function azioneManuale() { return "preservata"; }\n';
  writeFileSync(join(existingProject, 'index.html'), originalHtml);
  const configPath = join(existingProject, 'settings.json');
  writeFileSync(configPath, '{"title":"Prima"}\n');
  const automationPath = join(existingProject, 'scripts', 'automations.js');
  writeFileSync(automationPath, originalJs);

  const env = { ...process.env, STUDIO_DATA_DIR: join(tempDir, 'data') };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${join(tempDir, 'profile')}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow, dialog }, folder) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1680, 1000);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, existingProject);

    const fillDiskWizard = async (name: string, stack: string) => {
      await page.getByTestId(`wizard-stack-${stack}`).click();
      for (let step = 1; step < 5; step += 1) {
        await page.getByTestId('btn-wizard-next').click();
      }
      await page.getByTestId('wizard-input-name').fill(name);
      await page.getByTestId('wizard-input-disk-path').fill(projectParent);
      await page.getByTestId('wizard-checkbox-run-init').uncheck();
      await page.getByTestId('btn-wizard-finish').click();
      await expect(page.getByTestId('guided-project-wizard')).toHaveCount(0);
    };
    await page.getByTestId('btn-launch-wizard').click();
    await fillDiskWizard('Verifica Desktop V3', 'html-css-js');
    const [createdDir] = readdirSync(projectParent);
    expect(existsSync(join(projectParent, createdDir, 'index.html'))).toBe(true);

    await page.getByTestId('btn-menubar-home').click();
    await page.getByTestId('btn-hub-open-disk-folder').click();
    const canvas = page.getByTestId('visual-canvas-sheet');
    await expect(canvas.getByText('Progetto esistente', { exact: true })).toBeVisible();
    expect(readFileSync(join(existingProject, 'index.html'), 'utf8')).toBe(originalHtml);
    expect(readFileSync(automationPath, 'utf8')).toBe(originalJs);

    await page.getByTestId('vfs-item-settings.json').dblclick();
    await page.getByTestId('code-editor-textarea').fill('{"title":"Dopo"}\n');
    await page.getByTestId('btn-code-editor-save').click();
    await expect.poll(() => readFileSync(configPath, 'utf8')).toBe('{"title":"Dopo"}\n');
    writeFileSync(configPath, '{"title":"Esterno"}\n');
    await expect(page.getByTestId('code-editor-textarea')).toHaveValue('{"title":"Esterno"}\n');

    await page.getByTestId('preset-split-css').click();
    await canvas.getByText('Avvia azione', { exact: true }).click();
    await page.getByTestId('boxmodel-margin-top').fill('17');
    await expect(page.getByTestId('css-editor-textarea')).toHaveValue(/margin(?:-top)?: 17px/);

    await page.getByTestId('preset-split-automation').click();
    const automation = page.getByTestId('visual-automation-studio');
    await automation.getByTestId('btn-new-automation').click();
    await automation.getByTestId('automation-name-input').fill('Verifica azione');
    await automation.getByTestId('automation-trigger-type-select').selectOption('onClick');
    const trigger = automation.getByTestId('automation-stage-trigger').locator('select').nth(1);
    const buttonValue = await trigger.locator('option', { hasText: /#run\)/ }).getAttribute('value');
    expect(buttonValue).toBeTruthy();
    await trigger.selectOption(buttonValue!);
    await automation.getByTestId('automation-target-file-select').selectOption('scripts/automations.js');
    await automation.getByTestId('select-new-step-kind').selectOption('ui_set_text');
    await automation.getByTestId('btn-add-step').click();
    const setText = automation.getByTestId('automation-step-card-ui_set_text');
    const target = setText.locator('select').first();
    const paragraphValue = await target.locator('option', { hasText: /#status\)/ }).getAttribute('value');
    expect(paragraphValue).toBeTruthy();
    await target.selectOption(paragraphValue!);
    await setText.locator('input').last().fill('Azione verificata');
    await automation.getByTestId('btn-apply-automation').click();
    await expect.poll(() => readFileSync(automationPath, 'utf8')).toContain('function verificaAzione');
    await expect(page.getByTestId('toast-viewport')).toContainText('Automazione "Verifica azione" applicata');
    expect(readFileSync(automationPath, 'utf8')).toContain(originalJs);
    expect(readFileSync(join(existingProject, 'index.html'), 'utf8')).toBe(originalHtml);

    await page.getByTestId('preset-split-preview').click();
    const preview = page.frameLocator('[data-testid="sandbox-preview-iframe"]');
    await expect(preview.locator('body')).toHaveAttribute('data-studio-ready', 'true');
    const runButton = preview.getByRole('button', { name: 'Avvia azione' });
    await expect(runButton).toHaveAttribute('data-script-click', 'verificaAzione');
    await expect.poll(() => preview.locator('body').evaluate(() => {
      const runtime = window as Window & { __studioScriptHandlers?: Record<string, unknown> };
      return typeof runtime.__studioScriptHandlers?.verificaAzione;
    })).toBe('function');
    await runButton.click();
    await expect(preview.getByText('Azione verificata', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('v3-automation.png') });

    await page.getByTestId('preset-split-sql').click();
    const sql = page.getByTestId('sql-studio-view');
    await sql.getByTestId('sql-tab-query').click();
    const editor = sql.getByTestId('sql-query-editor');
    await editor.fill('SELECT upper(\'verifica sqlite\') AS risultato, 19 + 23 AS totale');
    await sql.getByTestId('btn-sql-run-query').click();
    await expect(sql.getByTestId('sql-query-results')).toContainText('VERIFICA SQLITE');
    await expect(sql.getByTestId('sql-query-results')).toContainText('42');
    await page.screenshot({ path: testInfo.outputPath('v3-sql-query.png') });
    await sql.getByTestId('sql-tab-er').click();
    await sql.getByTestId('btn-sql-generate-ui').click();
    await page.getByTestId('btn-sql-confirm-generate-ui').click();
    await expect(page.getByTestId('sql-to-ui-modal')).toHaveCount(0);
    await expect(canvas.getByRole('table').last()).toBeVisible();
    expect(readFileSync(join(existingProject, 'src', 'scripts', 'automations.js'), 'utf8')).toContain('@studio-automation:start');

    await page.getByTestId('preset-split-preview').click();
    await expect(preview.locator('body')).toHaveAttribute('data-studio-ready', 'true');
    await preview.getByPlaceholder('Inserisci full name...').fill('Cliente verifica Electron');
    await preview.getByPlaceholder('nome@dominio.it').fill('verifica.electron@example.test');
    await preview.getByRole('combobox').selectOption('standard');
    await preview.getByRole('button', { name: '+ Salva in customers', exact: true }).click();
    await expect(preview.getByRole('table').getByText('Cliente verifica Electron', { exact: true })).toBeVisible();
    await expect(preview.getByText('Record salvato in customers!', { exact: true })).toHaveCount(1);
    const createdRow = preview.getByRole('row', { name: /Cliente verifica Electron/ });
    const customerId = await createdRow.getByRole('cell').first().innerText();
    await preview.getByPlaceholder('id da aggiornare').fill(customerId);
    await preview.getByPlaceholder('Inserisci full name...').fill('Cliente aggiornato Electron');
    await preview.getByRole('button', { name: 'Aggiorna record', exact: true }).click();
    const updatedRow = preview.getByRole('row', { name: /Cliente aggiornato Electron/ });
    await expect(updatedRow).toBeVisible();
    await expect(createdRow).toHaveCount(0);
    await preview.getByPlaceholder('id da eliminare').fill(customerId);
    await preview.getByRole('button', { name: 'Elimina ID', exact: true }).click();
    await expect(updatedRow).toHaveCount(0);
    const search = preview.getByPlaceholder('Cerca in customers...');
    await search.fill('Giulia');
    await search.press('Tab');
    await expect(preview.getByRole('table').getByText('Giulia Conti')).toBeVisible();
    await expect(preview.getByRole('table').getByText('Marco Bellini')).toHaveCount(0);
    await search.fill('');
    await search.press('Tab');
    await expect(preview.getByRole('table').getByText('Marco Bellini')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('v3-sql-ui.png') });

    await page.getByTestId('preset-split-sql').click();
    await sql.getByTestId('sql-connection-select').selectOption('__local_sqlite__');
    await sql.getByTestId('sql-tab-migration').click();
    await expect(sql.getByTestId('sql-migration-full-sql')).toHaveValue(/CREATE TABLE/);
    const ddlEditor = sql.getByTestId('sql-export-ddl-preview');
    await expect(ddlEditor).toHaveValue(/CREATE TABLE/);
    await ddlEditor.fill((await ddlEditor.inputValue()) + '\n-- DDL personalizzato\n');
    await ddlEditor.press('Control+s');
    const ddlPath = join(existingProject, 'schema_sqlite.sql');
    await expect.poll(() => existsSync(ddlPath) ? readFileSync(ddlPath, 'utf8') : '').toContain('-- DDL personalizzato');
    await sql.getByTestId('btn-sql-apply-migration').click();
    await expect(page.getByTestId('toast-viewport')).toContainText('Migrazione applicata con successo');
    await sql.getByTestId('sql-tab-query').click();
    await editor.fill("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customers'");
    await sql.getByTestId('btn-sql-run-query').click();
    await expect(sql.getByTestId('sql-query-results')).toContainText('customers');
    await sql.getByTestId('sql-tab-codegen').click();
    await sql.getByTestId('sql-codegen-file-db/repository.js').click();
    const sqlSource = sql.getByTestId('sql-codegen-preview');
    await expect(sqlSource).toHaveValue(/export/);
    const repositoryCode = (await sqlSource.inputValue()) + '\n// Modifica SQL Studio verificata\n';
    await sqlSource.fill(repositoryCode);
    await sql.getByTestId('btn-sql-write-codegen').click();
    const repositoryPath = join(existingProject, 'db', 'repository.js');
    await expect.poll(() => existsSync(repositoryPath) ? readFileSync(repositoryPath, 'utf8') : '').toBe(repositoryCode);
    await expect(page.getByTestId('toast-viewport')).toContainText(/Salvati \d+ file del modulo DB/);
    const secondEdit = repositoryCode + '// Secondo salvataggio\n';
    await sqlSource.fill(secondEdit);
    await sqlSource.press('Control+s');
    await expect.poll(() => readFileSync(repositoryPath, 'utf8')).toBe(secondEdit);
    await sql.getByTestId('sql-codegen-target-ts-kysely').click();
    await expect(sqlSource).toHaveValue(/Kysely|interface/);

    await page.getByTestId('btn-header-new-project').click();
    await fillDiskWizard('Verifica Rust Studio', 'rust-tauri');
    const rustProject = readdirSync(projectParent).find((folder) => folder.includes('rust-studio'));
    expect(rustProject).toBeTruthy();
    const rustSourceDir = join(projectParent, rustProject!, 'src-tauri', 'src');
    const originalDatabaseModule = readFileSync(join(rustSourceDir, 'db.rs'), 'utf8');
    await page.getByTestId('preset-split-sql').click();
    await sql.getByTestId('sql-tab-codegen').click();
    await sql.getByTestId('sql-codegen-target-rust-tauri').click();
    await sql.getByTestId('btn-sql-write-codegen').click();
    await expect(page.getByTestId('toast-viewport')).toContainText('Modulo SQLite installato e comandi Tauri registrati');
    expect(readFileSync(join(rustSourceDir, 'lib.rs'), 'utf8')).toContain('studio_sql::studio_sql_list_customers');
    expect(readFileSync(join(rustSourceDir, 'db.rs'), 'utf8')).toBe(originalDatabaseModule);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
