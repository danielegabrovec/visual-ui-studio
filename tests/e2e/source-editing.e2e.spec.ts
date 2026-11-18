import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('edits raw source files, retains drafts, and refuses to overwrite an external change', async ({}, testInfo) => {
  const fixture = testInfo.outputPath('source-editing');
  const projectDir = join(fixture, 'project');
  const files = {
    'index.html': '<!doctype html><main><h1>Progetto sorgenti</h1></main>',
    'settings.json': '{"title":"Iniziale"}\n',
    'styles.css': 'body { color: red; }\r\n',
    'query.sql': 'SELECT 1;\n',
    'scripts/action.js': 'export const action = () => 1;\n',
    'generated/screen.ts': 'export const generatedScreen = "iniziale";\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    const path = join(projectDir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const env = { ...process.env, STUDIO_DATA_DIR: join(fixture, 'studio-data') };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${join(fixture, 'profile')}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow, dialog }, folder) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1680, 1000);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, projectDir);
    await page.getByTestId('btn-hub-open-disk-folder').click();
    const editor = page.getByTestId('code-editor-textarea');
    const openRaw = (name: string) => page.getByTestId(`vfs-edit-source-${name}`).click();
    const read = (file: string) => readFileSync(join(projectDir, file), 'utf8');

    await openRaw('settings.json');
    await editor.fill('{"title":"Bozza"}\n');
    await openRaw('styles.css');
    await editor.fill('body { color: blue; }\n');
    await editor.press('Control+s');
    await expect.poll(() => read('styles.css')).toBe('body { color: blue; }\r\n');

    await openRaw('settings.json');
    await expect(editor).toHaveValue('{"title":"Bozza"}\n');
    writeFileSync(join(projectDir, 'settings.json'), '{"title":"Esterno"}\n');
    await expect(page.getByTestId('code-editor-external-conflict')).toBeVisible();
    await expect(editor).toHaveValue('{"title":"Bozza"}\n');
    await editor.press('Control+s');
    expect(read('settings.json')).toBe('{"title":"Esterno"}\n');
    await page.getByTestId('btn-code-editor-reload').click();
    await expect(editor).toHaveValue('{"title":"Esterno"}\n');
    await expect(page.getByTestId('code-editor-external-conflict')).toHaveCount(0);

    await page.getByTestId('vfs-item-query.sql').click({ button: 'right' });
    await page.getByTestId('vfs-context-open-workbench').click();
    await expect(page.getByTestId('sql-studio-view')).toBeVisible();
    await page.getByTestId('btn-open-workbench-source').click();
    await expect(editor).toHaveValue(files['query.sql']);
    await editor.fill('SELECT 42;\n');
    await page.getByTestId('btn-code-editor-save').click();
    await expect.poll(() => read('query.sql')).toBe('SELECT 42;\n');

    await openRaw('action.js');
    await editor.fill('export const action = () => 99;\n');
    await page.getByTestId('btn-code-editor-discard').click();
    await expect(editor).toHaveValue(files['scripts/action.js']);
    expect(read('scripts/action.js')).toBe(files['scripts/action.js']);

    await openRaw('screen.ts');
    await editor.fill('export const generatedScreen = "modificato";\n');
    await editor.press('Control+s');
    await expect.poll(() => read('generated/screen.ts')).toBe('export const generatedScreen = "modificato";\n');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
