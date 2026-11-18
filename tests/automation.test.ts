import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildSandboxPreviewHtml, bundleScriptsForSandboxRegistry } from '@renderer/utils/sandbox-html-builder';
import {
  compileAutomationRuleToCode,
  getManagedAutomationBodyRange,
  isManagedBlockManuallyModified,
  removeManagedAutomationFromFile,
  upsertManagedAutomationInFile,
  type AutomationRule,
} from '@shared/automation-ir';
import { createStarterDemoSheet } from '@shared/default-tokens';
import { adaptParameterizedSqlForSqlite, compileSchemaDdl } from '@shared/sql-dialects';
import { createStarterSqlDocument, type SqlCellValue } from '@shared/sql-ir';
import { synthesizeCrudUiFromSqlTable } from '@shared/sql-to-ui-bridge';
import { applyPatchOpsToSheet } from '@shared/ui-patch';

const rule: AutomationRule = {
  id: 'auto_status',
  enabled: true,
  name: 'Mostra stato',
  language: 'javascript',
  generatedFnName: 'mostra_stato',
  targetFileRelPath: 'scripts/actions.js',
  trigger: { type: 'onClick', sourceNodeId: 'nd_primary_cta' },
  steps: [{ id: 'write', kind: 'ui_set_text', targetNodeId: 'nd_kpi_ord_value', value: { source: 'literal', value: 'Salvato' } }],
  updatedAt: 0,
};

describe('Automazioni da file separati', () => {
  it('preserva byte per byte il codice manuale e rileva modifiche in un blocco gestito', () => {
    const manual = '// commento utente\r\n\r\n\r\nexport const untouched = "spacing";  \r\n';
    const first = upsertManagedAutomationInFile(manual, rule);
    const trailing = '\r\n\r\n// altro codice\nexport const next = true;';
    expect(first.startsWith(manual)).toBe(true);
    expect(isManagedBlockManuallyModified(first, rule.id)).toBe(false);
    const source = first + trailing;
    const body = getManagedAutomationBodyRange(source, rule.id)!;
    expect(source.slice(body.start, body.end)).toContain('export function mostra_stato');
    expect(source.slice(body.start, body.end)).not.toContain('@studio-automation');
    const edited = source.slice(0, body.start)
      + source.slice(body.start, body.end).replace('String("Salvato")', 'String("Aggiornato a mano")')
      + source.slice(body.end);
    expect(isManagedBlockManuallyModified(edited, rule.id)).toBe(true);

    const replaced = upsertManagedAutomationInFile(edited, { ...rule, name: 'Mostra nuovo stato' });
    expect(replaced.startsWith(manual)).toBe(true);
    expect(replaced.endsWith(trailing)).toBe(true);
    expect(replaced.match(/@studio-automation:start/g)).toHaveLength(1);
    expect(removeManagedAutomationFromFile(replaced, rule.id)).toBe(manual + '\r\n' + trailing);
  });

  it('compila una funzione con nome esplicito e la carica insieme alle sue dipendenze', async () => {
    const externalRule: AutomationRule = {
      ...rule,
      steps: [
        { id: 'run', kind: 'call_external_fn', fnName: 'formatLabel', moduleRelPath: 'scripts/helpers.js', args: [{ source: 'literal', value: 'studio' }], outputVar: 'label' },
        { id: 'text', kind: 'ui_set_text', targetNodeId: 'nd_kpi_ord_value', value: { source: 'step_result', stepId: 'run' } },
      ],
    };
    const app = { textContent: '', querySelector: () => null };
    const browser = {} as { __studioScriptHandlers: Record<string, () => Promise<void>> };
    const blocks = bundleScriptsForSandboxRegistry([
      { name: 'actions.js', relativePath: externalRule.targetFileRelPath, content: upsertManagedAutomationInFile('', externalRule) },
      { name: 'helpers.js', relativePath: 'scripts/helpers.js', content: 'export const formatLabel = (label) => label.toUpperCase();' },
    ]);
    new Function('window', 'document', blocks.join('\n'))(browser, { getElementById: () => app });
    await browser.__studioScriptHandlers.mostra_stato();
    expect(app.textContent).toBe('STUDIO');
  });

  it('mostra un solo toast gestito dal runtime o dal fallback standalone', () => {
    const compiled = compileAutomationRuleToCode({
      ...rule,
      trigger: { type: 'callable' },
      steps: [{ id: 'notice', kind: 'toast', variant: 'success', message: { source: 'literal', value: 'Salvato' } }],
    });
    const browser = new EventTarget();
    let rendered = 0;
    const timers: (() => void)[] = [];
    const pill = { textContent: '', style: {}, remove() { rendered -= 1; } };
    const host = { id: '', style: {}, setAttribute() {}, appendChild() { rendered += 1; } };
    const body = { appendChild() {} };
    const document = {
      body,
      getElementById: () => null,
      createElement: () => host.id ? pill : host,
    };
    const source = compiled.code.replace('export function', 'function');
    const notify = new Function('window', 'document', 'setTimeout', `${source}\nreturn ${compiled.fnName};`)(
      browser, document, (callback: () => void) => timers.push(callback),
    );

    notify();
    expect(rendered).toBe(1);
    expect(pill.textContent).toBe('Salvato');
    timers[0]();
    expect(rendered).toBe(0);

    browser.addEventListener('studio:toast', (event) => {
      expect((event as CustomEvent).detail).toEqual({ variant: 'success', message: 'Salvato' });
      event.preventDefault();
      rendered += 1;
    });
    notify();
    expect(rendered).toBe(1);
    expect(timers).toHaveLength(1);
  });

  it('lega i parametri SQLite, aggiorna le righe dopo la scrittura e recupera i vecchi fogli senza modulo', async () => {
    const base = createStarterDemoSheet('project', 'sheet');
    const schema = createStarterSqlDocument('project', 'Test', 'sqlite');
    const crud = synthesizeCrudUiFromSqlTable({ table: schema.tables[0], sqlDocument: schema, sheet: base });
    const sqlDoc = { ...schema, namedQueries: crud.namedQueries };
    const sheet = applyPatchOpsToSheet(base, [...crud.ops, { op: 'update_sheet_meta', automations: crud.automations }]).nextSheet;
    const insert = crud.automations.find((item) => item.steps.some((step) => step.kind === 'sql_operation' && step.operation === 'insert_from_form'))!;
    const compiled = compileAutomationRuleToCode(insert, { sheet, sqlDocument: sqlDoc });
    expect(compiled.fnName).toBe(insert.generatedFnName);
    const preview = buildSandboxPreviewHtml(sheet, [], null, { sqlDocument: sqlDoc });
    expect(preview).toContain(`data-script-click="${insert.generatedFnName}"`);
    expect(preview).toContain(`function ${insert.generatedFnName}(`);

    const fields = new Map(crud.fields.map((field) => [
      field.column.name,
      field.column.name === 'email' ? 'studio@example.test' : field.column.name === 'tier' ? 'standard' : '<Cliente>',
    ]));
    const payloads: { sql: string; params: SqlCellValue[] }[] = [];
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(compileSchemaDdl(sqlDoc));
      const run = async (_url: string, request: { body: string }) => {
        const payload = JSON.parse(request.body) as { sql: string; params: SqlCellValue[] };
        payloads.push(payload);
        const { sql, bindings } = adaptParameterizedSqlForSqlite(payload.sql, payload.params);
        const stmt = db.prepare(sql);
        if (/^INSERT/i.test(payload.sql)) {
          stmt.run(...bindings);
          return { ok: true, json: () => ({ ok: true }) };
        }
        return { ok: true, json: () => ({ ok: true, rows: stmt.all(...bindings) }) };
      };
      const cellValues: string[] = [];
      const document = {
        getElementById: (id: string) => ({
          value: [...fields].find(([column]) => id.includes(column.replace(/_/g, '-')))?.[1] ?? '',
          checked: true,
          removeAttribute() {},
          setAttribute() {},
          style: { removeProperty() {}, setProperty() {} },
          querySelector: (selector: string) => selector === 'tbody' ? { replaceChildren() {} } : null,
        }),
        createDocumentFragment: () => ({ append() {} }),
        createElement: () => ({ insertCell: () => ({ set textContent(value: string) { cellValues.push(value); } }) }),
      };
      const generated = compiled.code.replace('export async function', 'async function');
      const fn = new Function('document', 'fetch', `${generated}\nreturn ${compiled.fnName};`)(document, run);
      await fn();
      expect(payloads).toHaveLength(2);
      expect(payloads[0].params).toContain('studio@example.test');
      expect(payloads[1].sql).toMatch(/^SELECT/i);
      expect(cellValues).toContain('<Cliente>');
    } finally {
      db.close();
    }
  });
});
