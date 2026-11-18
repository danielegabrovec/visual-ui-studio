import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('salva sorgenti Blueprint, Three.js e automazioni modificati negli editor', async ({}, testInfo) => {
  const workspace = testInfo.outputPath('workspace');
  const project = join(workspace, 'editor-project');
  const scripts = join(project, 'scripts');
  const generated = join(project, 'generated');
  const automationFile = join(scripts, 'automations.js');
  const stylesheetFile = join(project, 'site.css');
  mkdirSync(scripts, { recursive: true });
  const originalScript = 'export function codiceManuale() { return "preservato"; }\n';
  writeFileSync(automationFile, originalScript);
  const originalCss = '/* Foglio sorgente */\n:root { --test-accent: #123456; }\n';
  writeFileSync(stylesheetFile, originalCss);
  writeFileSync(join(project, 'index.html'), '<main><button id="run">Avvia</button><p id="status">In attesa</p></main>');

  const env = { ...process.env, STUDIO_DATA_DIR: join(workspace, 'data') };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(workspace, 'profile')}`], env });
  try {
    const page = await app.firstWindow();
    const previewNavigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame.url() === 'about:srcdoc') previewNavigations.push(frame.url());
    });
    await app.evaluate(({ BrowserWindow, dialog }, folder) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1680, 1000);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, project);

    await page.getByTestId('btn-hub-open-disk-folder').click();
    await expect(page.getByTestId('visual-canvas-sheet').getByText('In attesa', { exact: true })).toBeVisible();
    await page.getByTestId('visual-canvas-sheet').getByText('Avvia', { exact: true }).click({ button: 'right' });
    const canvasMenu = page.getByRole('menu', { name: 'Azioni del Canvas' });
    await expect(canvasMenu.getByRole('menuitem', { name: /Taglia/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(canvasMenu.getByRole('menuitem', { name: /Elimina Elemento/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(canvasMenu).toHaveCount(0);

    const inspectorMode = page.getByTestId('right-mode-inspector');
    await inspectorMode.click();
    await expect(inspectorMode).toHaveAttribute('aria-pressed', 'true');
    const marginLock = page.getByTestId('btn-boxmodel-lock');
    const previousLockLabel = await marginLock.getAttribute('title');
    await marginLock.press('Enter');
    await expect(marginLock).not.toHaveAttribute('title', previousLockLabel!);
    await expect(page.getByTestId('boxmodel-margin-top')).toBeVisible();

    await page.getByTestId('vfs-item-site.css').press('Enter');
    await expect(page.getByTestId('code-editor-textarea')).toHaveValue(originalCss);
    await page.getByRole('button', { name: 'Editor specializzato' }).click();
    const css = page.getByTestId('css-editor-textarea');
    await expect(css).toHaveValue(originalCss);
    await css.fill(`${originalCss}\n#status { opacity: 0.55;`);
    await page.getByTestId('btn-apply-css').click();
    await expect(page.getByTestId('css-live-editor')).toContainText('Completa la regola CSS');
    expect(readFileSync(stylesheetFile, 'utf8')).toBe(originalCss);
    const revisedCss = originalCss.replace('#123456', '#654321');
    await css.fill(revisedCss);
    await css.press('Control+s');
    await expect.poll(() => readFileSync(stylesheetFile, 'utf8')).toBe(revisedCss);
    await page.getByTestId('css-scope-selected').click();
    await css.fill((await css.inputValue()).replace(/}\s*$/, '  opacity: 0.88;\n}\n'));
    await page.getByTestId('btn-apply-css').click();
    await expect(page.getByTestId('toast-viewport')).toContainText('CSS applicato al Design');
    expect(readFileSync(stylesheetFile, 'utf8')).toBe(revisedCss);

    const readGenerated = (filter: RegExp) => {
      if (!existsSync(generated)) return '';
      const file = readdirSync(generated).find((entry) => filter.test(entry));
      return file ? readFileSync(join(generated, file), 'utf8') : '';
    };

    await page.getByTestId('preset-split-blueprint').click();
    const blueprintVariable = page.getByTestId('blueprint-editor-view').locator('input[data-testid^="bp-var-input-"][type="number"]').first();
    const variableName = (await blueprintVariable.getAttribute('data-testid'))!.replace('bp-var-input-', '');
    await blueprintVariable.evaluate((input) => {
      const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      nativeValue?.set?.call(input, '59');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector<HTMLButtonElement>('[data-testid="preset-split-css"]')?.click();
    });
    const readBlueprintVariable = () => {
      const folder = join(project, 'blueprints');
      const location = existsSync(folder) ? folder : project;
      const source = readdirSync(location).find((file) => file.endsWith('.blueprint.json'));
      if (!source) return undefined;
      const graph = JSON.parse(readFileSync(join(location, source), 'utf8')) as { variables: { name: string; initialValue: unknown }[] };
      return graph.variables.find((item) => item.name === variableName)?.initialValue;
    };
    await expect.poll(readBlueprintVariable).toBe(59);
    await page.getByTestId('preset-split-blueprint').click();
    await page.getByTestId('btn-toggle-blueprint-code').click();
    await page.getByTestId('btn-edit-blueprint-code').click();
    const blueprint = page.getByTestId('blueprint-code-editor');
    await expect(blueprint).toHaveValue(/StudioRuntimeContext/);
    const customBlueprint = `${await blueprint.inputValue()}\n// modifica Blueprint dal pannello\n`;
    await blueprint.fill(customBlueprint);
    await page.getByTestId('preset-split-css').click();
    await page.getByTestId('preset-split-blueprint').click();
    await page.getByTestId('btn-toggle-blueprint-code').click();
    await expect(blueprint).toHaveValue(customBlueprint);
    await page.getByTestId('btn-save-blueprint-code').click();
    await expect.poll(() => readGenerated(/^blueprint-.*\.ts$/)).toBe(customBlueprint);
    await page.getByTestId('btn-save-blueprint').click();
    await expect.poll(() => existsSync(join(scripts, 'blueprint.generated.ts'))).toBe(true);
    expect(readGenerated(/^blueprint-.*\.ts$/)).toBe(customBlueprint);

    await page.getByTestId('preset-three-studio').click();
    await page.getByTestId('three-code-format-select').selectOption('three-html');
    await page.getByTestId('btn-edit-three-code').click();
    const three = page.getByTestId('three-code-editor');
    await expect(three).toHaveValue(/<html/i);
    const customHtml = `${await three.inputValue()}\n<!-- modifica Three.js dal pannello -->\n`;
    await three.fill(customHtml);
    await page.getByTestId('btn-save-three-vfs').click();
    await expect.poll(() => readGenerated(/\.three\.html$/)).toBe(customHtml);
    await page.getByTestId('btn-edit-three-code').click();
    await page.getByTestId('btn-edit-three-code').click();
    await expect(three).toHaveValue(customHtml);
    const revisedHtml = `${customHtml}<!-- revisione non ancora salvata -->\n`;
    await three.fill(revisedHtml);
    await page.getByTestId('preset-split-css').click();
    await page.getByTestId('preset-three-studio').click();
    await page.getByTestId('three-code-format-select').selectOption('three-html');
    await expect(three).toHaveValue(revisedHtml);
    await three.press('Control+s');
    await expect.poll(() => readGenerated(/\.three\.html$/)).toBe(revisedHtml);

    await page.getByTestId('preset-split-automation').click();
    const automation = page.getByTestId('visual-automation-studio');
    await automation.getByTestId('btn-new-automation').click();
    await automation.getByTestId('automation-name-input').fill('Aggiorna stato');
    const trigger = automation.getByTestId('automation-stage-trigger').locator('select').nth(1);
    await trigger.selectOption((await trigger.locator('option', { hasText: /#run\)/ }).getAttribute('value'))!);
    await automation.getByTestId('automation-target-file-select').selectOption('scripts/automations.js');
    await automation.getByTestId('select-new-step-kind').selectOption('ui_set_text');
    await automation.getByTestId('btn-add-step').click();
    const step = automation.getByTestId('automation-step-card-ui_set_text');
    const target = step.locator('select').first();
    await target.selectOption((await target.locator('option', { hasText: /#status\)/ }).getAttribute('value'))!);
    await step.locator('input').last().fill('Testo generato');
    await automation.getByRole('button', { name: 'Solo Funzione' }).click();
    const source = automation.getByTestId('automation-live-code-preview');
    await expect(source).toHaveValue(/export function aggiornaStato/);
    const edited = (await source.inputValue()).replaceAll('Testo generato', 'Testo scritto nell’editor');
    await source.fill(edited);
    await automation.getByTestId('btn-apply-automation').click();
    await expect.poll(() => readFileSync(automationFile, 'utf8')).toContain('Testo scritto nell’editor');
    await expect(page.getByTestId('toast-viewport')).toContainText('Automazione "Aggiorna stato" applicata');
    expect(readFileSync(automationFile, 'utf8')).toContain(originalScript);

    await page.getByTestId('preset-split-preview').click();
    const preview = page.frameLocator('[data-testid="sandbox-preview-iframe"]');
    await expect(preview.locator('body')).toHaveAttribute('data-studio-ready', 'true');
    const run = preview.getByRole('button', { name: 'Avvia' });
    await expect(run).toHaveAttribute('data-script-click', 'aggiornaStato');
    await expect.poll(() => run.evaluate(() => {
      const runtime = window as typeof window & { __studioScriptHandlers?: Record<string, unknown> };
      return typeof runtime.__studioScriptHandlers?.aggiornaStato;
    })).toBe('function');
    await run.click();
    try {
      await expect(preview.getByText('Testo scritto nell’editor', { exact: true })).toBeVisible();
    } catch (error) {
      await testInfo.attach('preview-diagnostics', {
        body: JSON.stringify({ previewNavigations, status: await preview.locator('#status').textContent() }),
        contentType: 'application/json',
      });
      throw error;
    }
  } finally {
    await app.close();
  }
});
