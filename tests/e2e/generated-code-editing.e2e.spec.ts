import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { version } from '../../package.json';

test('keeps manual bundle edits on reopen and uses them for saved files and scaffold exports', async ({}, testInfo) => {
  const fixture = testInfo.outputPath('code-editing');
  const repo = join(fixture, 'source-project');
  const exports = join(fixture, 'exports');
  const source = 'export function esegui(ctx) { ctx.log("Sorgente originale"); }\n';
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(exports, { recursive: true });
  writeFileSync(join(repo, 'index.html'), '<html><body><h1>Editor verificato</h1><button>Avvia</button></body></html>');
  writeFileSync(join(repo, 'scripts', 'actions.js'), source);

  const env: Record<string, string> = { STUDIO_DATA_DIR: join(fixture, 'studio') };
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RUN_AS_NODE' && key !== 'STUDIO_DATA_DIR' && value !== undefined) env[key] = value;
  }
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${join(fixture, 'profile')}`],
    env,
  });

  try {
    const page = await app.firstWindow();
    const mockFolder = (dir: string) => app.evaluate(({ BrowserWindow, dialog }, path) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1660, 1000);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, dir);
    await mockFolder(repo);
    await page.getByTestId('btn-hub-open-disk-folder').click();
    await page.getByTestId('preset-split-code').click();
    await page.getByTestId('code-target-select').selectOption('html-vanilla');
    const code = page.getByTestId('live-code-sheet');
    await expect(code.getByTestId('code-viewer-output')).toContainText('Editor verificato');
    await code.getByTestId('btn-toggle-code-edit').click();
    const editor = code.getByTestId('code-editable-textarea');
    const htmlMarker = '<!-- modifica HTML verificata -->';
    const cssMarker = '/* modifica CSS verificata */';
    await editor.fill((await editor.inputValue()) + '\n' + htmlMarker);
    await code.getByTestId('bundle-file-styles.css').click();
    await editor.fill((await editor.inputValue()) + '\n' + cssMarker);
    await code.getByTestId('bundle-file-index.html').click();
    await expect(editor).toHaveValue(/modifica HTML verificata/);
    await editor.press('Control+s');
    await expect(page.getByTestId('toast-viewport')).toContainText('Modifiche al codice salvate nel foglio');

    await page.getByTestId('btn-menubar-home').click();
    await page.getByTestId('btn-hub-open-disk-folder').click();
    await page.getByTestId('preset-split-code').click();
    await expect(code.getByTestId('code-viewer-output')).toContainText(htmlMarker);
    await code.getByTestId('bundle-file-styles.css').click();
    await expect(code.getByTestId('code-viewer-output')).toContainText(cssMarker);

    await code.getByTestId('btn-save-bundle-disk').click();
    await expect(page.getByTestId('toast-viewport')).toContainText(/Salvati \d+ file su disco/);
    expect(readFileSync(join(repo, 'generated', 'html-vanilla', 'index.html'), 'utf8')).toContain(htmlMarker);
    expect(readFileSync(join(repo, 'generated', 'html-vanilla', 'styles.css'), 'utf8')).toContain(cssMarker);
    await mockFolder(exports);
    await code.getByTestId('btn-export-scaffold').click();
    await expect(page.getByTestId('toast-viewport')).toContainText('Progetto html-vanilla esportato');
    const [folder] = readdirSync(exports);
    expect(readFileSync(join(exports, folder, 'index.html'), 'utf8')).toContain(htmlMarker);
    expect(readFileSync(join(exports, folder, 'styles.css'), 'utf8')).toContain(cssMarker);

    await page.getByTestId('preset-split-script').click();
    await page.getByTestId('btn-edit-transpiled-js').click();
    const jsEditor = page.getByTestId('script-transpiled-js-editor');
    const jsSource = 'export function esegui(ctx) { ctx.log("JavaScript manuale eseguito", typeof globalThis.document, typeof globalThis.studioApi, typeof globalThis.process); }\n';
    await jsEditor.fill(jsSource);
    await page.getByTestId('btn-run-transpiled-js').click();
    await expect(page.getByTestId('console-log-list')).toContainText('JavaScript manuale eseguito undefined undefined undefined');
    await page.getByTestId('btn-save-transpiled-js').click();
    await expect(page.getByTestId('toast-viewport')).toContainText('Sorgente salvato nel progetto');
    const jsCopy = readdirSync(join(repo, 'generated')).find((name) => name.startsWith('actions-') && name.endsWith('.js'));
    expect(jsCopy).toBeTruthy();
    expect(readFileSync(join(repo, 'generated', jsCopy!), 'utf8')).toBe(jsSource);
    expect(readFileSync(join(repo, 'scripts', 'actions.js'), 'utf8')).toBe(source);

    await jsEditor.fill('export function esegui() { while (true) { /* Verifica del limite di esecuzione. */ } }');
    await page.getByTestId('btn-run-transpiled-js').click();
    await expect(page.getByTestId('btn-run-transpiled-js')).toBeDisabled();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 760));
    const toggle = page.getByTestId('btn-toggle-right-dock');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await toggle.evaluate((button) => button.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    const help = page.getByTestId('menu-help');
    await help.focus();
    await help.press('ArrowDown');
    const aboutButton = page.getByTestId('menu-item-help-about');
    await expect(aboutButton).toBeFocused();
    await aboutButton.press('Enter');
    const about = page.getByTestId('studio-about-dialog');
    await expect(page).toHaveTitle(`Visual UI Studio ${version}`);
    await expect(about).toContainText(`Versione ${version}`);
    await expect(about).toContainText('Daniele Gabrovec');
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();
    await expect(page.getByTestId('console-log-list')).toContainText('Il test ha superato 8 secondi', { timeout: 12_000 });
  } finally {
    await app.close();
  }
});
