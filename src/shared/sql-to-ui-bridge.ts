/**
 * `Tabella SQL -> Genera Interfaccia UI CRUD` (`src/shared/sql-to-ui-bridge.ts`).
 *
 * Deterministically transforms any `SqlTableDef` (and optional `SqlDesignDocument`) into:
 *   1. `ops: UIPatchOp[]` — a complete, styled Canvas CRUD Card containing:
 *        - Header with table badge + Search input + Refresh button
 *        - Typed Creation/Edit Form (text/number/date/password inputs, textareas, checkboxes/switches,
 *          Foreign-Key `<select>` dropdowns, and `CHECK (col IN (...))` enum `<select>` dropdowns!)
 *        - Submit (`Salva`) + Delete (`Elimina per ID`) action bar
 *        - Searchable Data Table (`controlType: 'table'`) pre-seeded with `seedRows`
 *   2. `automations: AutomationRule[]` — No-Code CRUD and data search rules for `automation-ir.ts`.
 *   3. `namedQueries: SqlNamedQueryDef[]` — parameterized `list`, `insert`, `update`, `delete` SQL queries
 *   4. `stateEntries: UISheetStateSpec[]` — reactive sheet state keys for rows, loading, and selected ID
 *
 * Pure TypeScript, zero Node imports.
 */

import type {
  AutomationRule,
  FormValidationFieldRule,
  ScriptLanguage,
} from './automation-types';
import {
  equalSqlIdentifiers,
  formatParameterPlaceholder,
  qualifyTableName,
  quoteIdentifier,
} from './sql-dialects';
import type {
  SqlColumnDef,
  SqlDesignDocument,
  SqlDialect,
  SqlNamedQueryDef,
  SqlTableDef,
} from './sql-ir';
import type {
  NodeId,
  SemanticTag,
  UIControlSubtype,
  UISheetDocument,
  UISheetStateSpec,
} from './ui-ir';
import { generateNodeId, type UIPatchOp } from './ui-patch';

export interface SqlToUiBridgeOptions {
  table: SqlTableDef;
  sqlDocument?: SqlDesignDocument | null;
  sheet?: UISheetDocument | null;
  parentId?: NodeId | null;
  includeForm?: boolean;
  includeDataTable?: boolean;
  includeSearchBar?: boolean;
  includeDeleteControl?: boolean;
  scriptLanguage?: ScriptLanguage;
  targetScriptRelPath?: string;
  studioTheme?: 'dark' | 'light';
}

export interface SqlToUiFieldDescriptor {
  column: SqlColumnDef;
  inputNodeId: NodeId;
  labelText: string;
  controlType: UIControlSubtype;
  semanticTag: SemanticTag;
  options?: string[];
  placeholder: string;
  valueProp: 'value' | 'checked';
}

export interface SqlToUiBridgeResult {
  tableName: string;
  rootCardNodeId: NodeId;
  tableNodeId?: NodeId;
  submitButtonNodeId?: NodeId;
  refreshButtonNodeId?: NodeId;
  deleteButtonNodeId?: NodeId;
  deleteIdInputNodeId?: NodeId;
  fields: SqlToUiFieldDescriptor[];
  ops: UIPatchOp[];
  automations: AutomationRule[];
  namedQueries: SqlNamedQueryDef[];
  stateEntries: UISheetStateSpec[];
}

function toSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'record'
  );
}

function toCamelCase(name: string): string {
  const parts = toSlug(name).split('_').filter(Boolean);
  return parts
    .map((p, idx) => (idx === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

function toHumanLabel(colName: string): string {
  return colName
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Extracts literal values from `CHECK (status IN ('pending', 'paid', 'shipped'))`.
 */
export function extractCheckInOptions(checkExpr?: string): string[] | undefined {
  if (!checkExpr) return undefined;
  const inMatch = checkExpr.match(/\bIN\s*\(([^)]+)\)/i);
  if (!inMatch) return undefined;
  const literals: string[] = [];
  for (const m of inMatch[1].matchAll(/N?'((?:[^']|'')*)'/g)) {
    literals.push(m[1].replace(/''/g, "'"));
  }
  return literals.length > 0 ? literals : undefined;
}

export function mapSqlColumnToUiControl(
  col: SqlColumnDef,
  ownerTable: SqlTableDef,
  sqlDoc?: SqlDesignDocument | null,
): Omit<SqlToUiFieldDescriptor, 'inputNodeId'> {
  const dialect: SqlDialect = sqlDoc?.dialect ?? 'sqlite';
  const labelText = `${toHumanLabel(col.name)}${!col.nullable && !col.defaultValue ? ' *' : ''}`;

  // 1. Foreign Key column -> Select populated from referenced table seed rows!
  const fk = ownerTable.foreignKeys.find(
    (f) => f.columns.length === 1 && equalSqlIdentifiers(dialect, f.columns[0], col.name),
  );
  if (fk) {
    const refSeed = sqlDoc?.seedRows.find((s) =>
      equalSqlIdentifiers(dialect, s.tableName, fk.referencedTable),
    );
    const refTable = sqlDoc?.tables.find((t) =>
      equalSqlIdentifiers(dialect, t.name, fk.referencedTable),
    );
    const refPkCol = fk.referencedColumns[0] || 'id';
    const displayCol =
      refTable?.columns.find(
        (c) =>
          !c.primaryKey &&
          (c.canonicalType === 'varchar' || c.canonicalType === 'text'),
      )?.name ?? refPkCol;

    const options =
      refSeed && refSeed.rows.length > 0
        ? refSeed.rows.slice(0, 20).map((r) => {
            const pkVal = String(r[refPkCol] ?? '');
            const dispVal = displayCol !== refPkCol && r[displayCol] ? ` — ${r[displayCol]}` : '';
            return `${pkVal}${dispVal}`;
          })
        : ['1', '2', '3'];

    return {
      column: col,
      labelText: `${toHumanLabel(col.name)} (${fk.referencedTable}) *`,
      controlType: 'select',
      semanticTag: 'select',
      options,
      placeholder: `Seleziona ${fk.referencedTable}...`,
      valueProp: 'value',
    };
  }

  // 2. Column or Table CHECK `IN (...)` -> Select dropdown!
  const tableCheck = ownerTable.checks.find((chk) =>
    new RegExp(`\\b${col.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+IN\\s*\\(`, 'i').test(
      chk.expression,
    ),
  );
  const enumOpts = extractCheckInOptions(col.checkExpr ?? tableCheck?.expression);
  if (enumOpts && enumOpts.length > 0) {
    return {
      column: col,
      labelText,
      controlType: 'select',
      semanticTag: 'select',
      options: enumOpts,
      placeholder: `Scegli ${col.name}`,
      valueProp: 'value',
    };
  }

  // 3. Boolean -> Checkbox
  if (col.canonicalType === 'boolean') {
    return {
      column: col,
      labelText: toHumanLabel(col.name),
      controlType: 'checkbox',
      semanticTag: 'input',
      placeholder: '',
      valueProp: 'checked',
    };
  }

  // 4. Long text / JSON -> Textarea
  if (col.canonicalType === 'text' || col.canonicalType === 'json') {
    return {
      column: col,
      labelText,
      controlType: 'textarea',
      semanticTag: 'textarea',
      placeholder:
        col.canonicalType === 'json'
          ? '{"chiave": "valore"}'
          : `Inserisci ${col.name.replace(/_/g, ' ')}...`,
      valueProp: 'value',
    };
  }

  // 5. Password / Secret heuristic
  if (/password|secret|token|api_key/i.test(col.name)) {
    return {
      column: col,
      labelText,
      controlType: 'password',
      semanticTag: 'input',
      placeholder: '••••••••',
      valueProp: 'value',
    };
  }

  // 6. Standard typed text-input (numbers, dates, emails, strings)
  let placeholder = `Inserisci ${col.name.replace(/_/g, ' ')}...`;
  if (/email/i.test(col.name)) placeholder = 'nome@dominio.it';
  else if (col.canonicalType === 'decimal') placeholder = '0.00';
  else if (col.canonicalType === 'integer' || col.canonicalType === 'bigint') placeholder = '0';
  else if (col.canonicalType === 'date') placeholder = '2026-03-15';
  else if (col.canonicalType === 'datetime') placeholder = '2026-03-15 10:30:00';
  else if (col.canonicalType === 'uuid') placeholder = '00000000-0000-4000-8000-000000000000';

  return {
    column: col,
    labelText,
    controlType: 'text-input',
    semanticTag: 'input',
    placeholder,
    valueProp: 'value',
  };
}

export function getSqlFormColumns(table: SqlTableDef): SqlColumnDef[] {
  return table.columns.filter((column) => !column.autoIncrement &&
    !(column.defaultValue && /^(created_at|updated_at)$/i.test(column.name)));
}

function getSinglePrimaryKey(table: SqlTableDef): SqlColumnDef | undefined {
  const keys = table.columns.filter((column) => column.primaryKey);
  return keys.length === 1 ? keys[0] : undefined;
}

export function buildStandardCrudNamedQueries(
  table: SqlTableDef,
  dialect: SqlDialect = 'sqlite',
): SqlNamedQueryDef[] {
  const slug = toSlug(table.name);
  const q = (id: string) => quoteIdentifier(id, dialect);
  const qualified = qualifyTableName(dialect, table.name, table.schema);
  const pkCol = getSinglePrimaryKey(table);
  const editableCols = getSqlFormColumns(table);

  const selectCols = table.columns.map((c) => q(c.name)).join(', ');
  const orderCol = pkCol ? ` ORDER BY ${q(pkCol.name)} DESC` : '';
  const listQuery: SqlNamedQueryDef = {
    id: `qry_list_${slug}`,
    name: `list_${slug}`,
    description: `Carica l'elenco record da ${table.name}`,
    kind: 'select',
    targetTable: table.name,
    canonicalSql: `SELECT ${selectCols} FROM ${qualified}${orderCol};`,
    parameters: [],
    returnColumns: table.columns.map((c) => ({
      name: c.name,
      type: c.canonicalType,
      nullable: c.nullable,
    })),
  };

  const insertCols = editableCols.map((c) => q(c.name)).join(', ');
  const insertPlaceholders = editableCols
    .map((c, idx) => formatParameterPlaceholder(dialect, idx + 1, c.name))
    .join(', ');
  const insertQuery: SqlNamedQueryDef = {
    id: `qry_insert_${slug}`,
    name: `insert_${slug}`,
    description: `Inserisce un nuovo record in ${table.name}`,
    kind: 'insert',
    targetTable: table.name,
    canonicalSql:
      editableCols.length > 0
        ? `INSERT INTO ${qualified} (${insertCols}) VALUES (${insertPlaceholders});`
        : `INSERT INTO ${qualified} ${dialect === 'mysql' || dialect === 'mariadb' ? '() VALUES ()' : 'DEFAULT VALUES'};`,
    parameters: editableCols.map((c) => ({
      name: c.name,
      type: c.canonicalType,
      required: !c.nullable && c.defaultValue === undefined,
    })),
  };

  const updatableCols = editableCols.filter((column) => !column.primaryKey);
  const updateSet = updatableCols
    .map((c, idx) => `${q(c.name)} = ${formatParameterPlaceholder(dialect, idx + 1, c.name)}`)
    .join(', ');
  const pkPhUpdate = formatParameterPlaceholder(dialect, updatableCols.length + 1, pkCol?.name ?? 'id');
  const updateQuery: SqlNamedQueryDef = {
    id: `qry_update_${slug}`,
    name: `update_${slug}`,
    description: `Aggiorna un record esistente in ${table.name}`,
    kind: 'update',
    targetTable: table.name,
    canonicalSql:
      updatableCols.length > 0 && pkCol
        ? `UPDATE ${qualified} SET ${updateSet} WHERE ${q(pkCol.name)} = ${pkPhUpdate};`
        : `-- UPDATE ${table.name}`,
    parameters: [
      ...updatableCols.map((c) => ({
        name: c.name,
        type: c.canonicalType,
        required: !c.nullable,
      })),
      ...(pkCol ? [{ name: pkCol.name, type: pkCol.canonicalType, required: true }] : []),
    ],
  };

  const pkPhDelete = formatParameterPlaceholder(dialect, 1, pkCol?.name ?? 'id');
  const deleteQuery: SqlNamedQueryDef = {
    id: `qry_delete_${slug}`,
    name: `delete_${slug}`,
    description: `Elimina un record per chiave primaria da ${table.name}`,
    kind: 'delete',
    targetTable: table.name,
    canonicalSql: pkCol
      ? `DELETE FROM ${qualified} WHERE ${q(pkCol.name)} = ${pkPhDelete};`
      : '',
    parameters: pkCol ? [{ name: pkCol.name, type: pkCol.canonicalType, required: true }] : [],
  };

  return [listQuery, insertQuery, ...(pkCol && updatableCols.length > 0 ? [updateQuery] : []), ...(pkCol ? [deleteQuery] : [])]
    .map((nq) => ({ ...nq, sql: nq.canonicalSql }));
}

export function synthesizeCrudUiFromSqlTable(options: SqlToUiBridgeOptions): SqlToUiBridgeResult {
  const {
    table,
    sqlDocument,
    sheet,
    includeForm = true,
    includeDataTable = true,
    includeSearchBar = true,
    includeDeleteControl = true,
    scriptLanguage = 'javascript',
    studioTheme = 'dark',
  } = options;

  const dialect: SqlDialect = sqlDocument?.dialect ?? 'sqlite';
  const slug = toSlug(table.name);
  const camel = toCamelCase(table.name);
  const ext = scriptLanguage === 'python' ? 'py' : scriptLanguage === 'typescript' ? 'ts' : 'js';
  const targetScriptRelPath =
    options.targetScriptRelPath ??
    (scriptLanguage === 'python' ? `backend/automations.${ext}` : `src/scripts/automations.${ext}`);

  const rootParentId = options.parentId !== undefined ? options.parentId : (sheet?.rootIds[0] ?? null);
  const parentNode = rootParentId && sheet?.nodes[rootParentId] ? sheet.nodes[rootParentId] : undefined;
  const isParentFreeform =
    parentNode?.layout.mode === 'freeform' || sheet?.defaultLayoutMode === 'freeform';

  // Compute non-overlapping Freeform Y coordinate when placed on a freeform artboard
  let startX = 48;
  let startY = 48;
  if (isParentFreeform && parentNode && sheet) {
    const childBottoms = parentNode.childIds
      .map((cid) => sheet.nodes[cid])
      .filter(Boolean)
      .map((n) => n.layout.frame.y + n.layout.frame.height + 28);
    if (childBottoms.length > 0) {
      startY = Math.round(Math.max(48, ...childBottoms));
    }
  }

  const isDark = studioTheme !== 'light';
  const surfaceColor = isDark ? '#111827' : '#ffffff';
  const elevatedColor = isDark ? '#0b1120' : '#f8fafc';
  const borderColor = isDark ? '#1e293b' : '#cbd5e1';
  const textPrimary = isDark ? '#f8fafc' : '#0f172a';
  const textSecondary = isDark ? '#94a3b8' : '#475569';

  const namedQueries = buildStandardCrudNamedQueries(table, dialect);
  const listQuery = namedQueries[0];
  const pkCol = getSinglePrimaryKey(table);
  const updateQuery = namedQueries.find((query) => query.kind === 'update');
  const deleteQuery = namedQueries.find((query) => query.kind === 'delete');
  const canUpdate = Boolean(includeForm && pkCol && updateQuery);

  const rootCardNodeId = generateNodeId(`crud_${slug}`);
  const headerRowId = generateNodeId(`hdr_${slug}`);
  const titleNodeId = generateNodeId(`ttl_${slug}`);
  const refreshBtnId = generateNodeId(`ref_${slug}`);
  const searchInputId = includeDataTable && includeSearchBar ? generateNodeId(`srch_${slug}`) : undefined;
  const formContainerId = includeForm ? generateNodeId(`frm_${slug}`) : undefined;
  const fieldsGridId = includeForm ? generateNodeId(`fgrid_${slug}`) : undefined;
  const actionsRowId = includeForm ? generateNodeId(`act_${slug}`) : undefined;
  const submitButtonNodeId = includeForm ? generateNodeId(`save_${slug}`) : undefined;
  const editIdInputNodeId = canUpdate ? generateNodeId(`editid_${slug}`) : undefined;
  const editButtonNodeId = canUpdate ? generateNodeId(`editbtn_${slug}`) : undefined;
  const deleteRowId = includeDeleteControl ? generateNodeId(`delrow_${slug}`) : undefined;
  const deleteIdInputNodeId = includeDeleteControl ? generateNodeId(`delid_${slug}`) : undefined;
  const deleteButtonNodeId = includeDeleteControl ? generateNodeId(`delbtn_${slug}`) : undefined;
  const tableNodeId = includeDataTable ? generateNodeId(`tbl_${slug}`) : undefined;

  const editableColumns = getSqlFormColumns(table);
  const fields: SqlToUiFieldDescriptor[] = includeForm
    ? editableColumns.map((col) => ({
        ...mapSqlColumnToUiControl(col, table, sqlDocument),
        inputNodeId: generateNodeId(`inp_${slug}_${toSlug(col.name)}`),
      }))
    : [];

  // Build deterministic AutomationRules first so we can wire `call_script_fn` onto the buttons!
  const now = Date.now();
  const instance = rootCardNodeId.slice(`crud_${slug}_`.length);
  const selectAutoId = `auto_sql_select_${slug}_${instance}`;
  const insertAutoId = `auto_sql_insert_${slug}_${instance}`;
  const updateAutoId = `auto_sql_update_${slug}_${instance}`;
  const deleteAutoId = `auto_sql_delete_${slug}_${instance}`;
  const searchAutoId = `auto_sql_search_${slug}_${instance}`;

  const selectFnName = `load_${slug}_table_${instance}`;
  const insertFnName = `submit_${slug}_form_${instance}`;
  const updateFnName = `update_${slug}_record_${instance}`;
  const deleteFnName = `delete_${slug}_record_${instance}`;
  const searchFnName = `search_${slug}_table_${instance}`;

  const automations: AutomationRule[] = [];

  if (includeDataTable && tableNodeId) {
    automations.push({
      id: selectAutoId,
      name: `Carica ${table.name} nella Tabella UI`,
      description: `Esegue ${listQuery.name} (${dialect}) e aggiorna la tabella dati #${tableNodeId}.`,
      enabled: true,
      targetFileRelPath: targetScriptRelPath,
      language: scriptLanguage,
      generatedFnName: selectFnName,
      trigger: {
        type: 'onClick',
        sourceNodeId: refreshBtnId,
      },
      steps: [
        {
          id: `step_sel_${slug}`,
          kind: 'sql_operation',
          operation: 'select_to_table',
          tableName: table.name,
          namedQueryId: listQuery.id,
          targetTableNodeId: tableNodeId,
          resultStateKey: `${camel}Rows`,
          executionBridge: 'auto',
        },
      ],
      updatedAt: now,
    });
  }

  if (tableNodeId && searchInputId) {
    const sqlByDialect = Object.fromEntries(
      (['sqlite', 'postgresql', 'mysql', 'mariadb', 'sqlserver'] as const).map((engine) => {
        const q = (name: string) => quoteIdentifier(name, engine);
        const targetTable = qualifyTableName(engine, table.name, table.schema);
        const projection = table.columns.map((column) => q(column.name)).join(', ');
        const stringType = engine === 'mysql' || engine === 'mariadb' ? 'CHAR' : 'VARCHAR(255)';
        const fields = table.columns.map((column) => `COALESCE(CAST(${q(column.name)} AS ${stringType}), '')`);
        const parameter = formatParameterPlaceholder(engine, 1, 'search_text');
        const order = pkCol ? ` ORDER BY ${q(pkCol.name)} DESC` : '';
        return [engine, `SELECT ${projection} FROM ${targetTable} WHERE LOWER(CONCAT('', ${fields.join(", ' ', ")})) LIKE LOWER(CONCAT('%', ${parameter}, '%'))${order};`];
      }),
    ) as Record<SqlDialect, string>;
    const query: SqlNamedQueryDef = {
      id: `qry_search_${slug}`,
      name: `search_${slug}`,
      description: `Cerca nelle colonne di ${table.name}.`,
      kind: 'select',
      targetTable: table.name,
      canonicalSql: sqlByDialect[dialect],
      sql: sqlByDialect[dialect],
      sqlByDialect,
      parameters: [{ name: 'search_text', type: 'varchar', required: false }],
      returnColumns: listQuery.returnColumns,
    };
    namedQueries.push(query);
    automations.push({
      id: searchAutoId,
      name: `Cerca in ${table.name}`,
      enabled: true,
      targetFileRelPath: targetScriptRelPath,
      language: scriptLanguage,
      generatedFnName: searchFnName,
      trigger: { type: 'onChange', sourceNodeId: searchInputId },
      steps: [{
        id: `step_search_${slug}`,
        kind: 'sql_operation',
        operation: 'select_to_table',
        tableName: table.name,
        namedQueryId: query.id,
        paramBindings: { search_text: { source: 'ui_element', nodeId: searchInputId, prop: 'value' } },
        targetTableNodeId: tableNodeId,
        resultStateKey: `${camel}Rows`,
        executionBridge: 'auto',
      }],
      updatedAt: now,
    });
  }

  if (includeForm && submitButtonNodeId) {
    const validationRules: FormValidationFieldRule[] = fields
      .filter((f) => !f.column.nullable && f.column.defaultValue === undefined && f.valueProp === 'value')
      .map((f) => ({
        nodeId: f.inputNodeId,
        rule: /email/i.test(f.column.name) ? 'email' : 'required',
        errorMsg: `Il campo "${toHumanLabel(f.column.name)}" è obbligatorio.`,
      }));

    automations.push({
      id: insertAutoId,
      name: `Inserisci ${table.name} dal Form`,
      description: `Valida i campi del form, inserisce il record in "${table.name}" e aggiorna la tabella.`,
      enabled: true,
      targetFileRelPath: targetScriptRelPath,
      language: scriptLanguage,
      generatedFnName: insertFnName,
      trigger: {
        type: 'onClick',
        sourceNodeId: submitButtonNodeId,
      },
      steps: [
        ...(validationRules.length > 0
          ? [
              {
                id: `step_val_${slug}`,
                kind: 'validate_form' as const,
                rules: validationRules,
                stopOnFail: true,
              },
            ]
          : []),
        {
          id: `step_ins_${slug}`,
          kind: 'sql_operation',
          operation: 'insert_from_form',
          tableName: table.name,
          namedQueryId: namedQueries[1].id,
          columnMappings: fields.map((f) => ({
            columnName: f.column.name,
            value: {
              source: 'ui_element',
              nodeId: f.inputNodeId,
              prop: f.valueProp,
            },
          })),
          targetTableNodeId: tableNodeId,
          refreshQueryId: listQuery.id,
          toastOnSuccess: `Record salvato in ${table.name}!`,
          executionBridge: 'auto',
        },
      ],
      updatedAt: now,
    });
  }

  if (pkCol && updateQuery && editIdInputNodeId && editButtonNodeId) {
    const editableFields = fields.filter((field) => !field.column.primaryKey);
    automations.push({
      id: updateAutoId,
      name: `Aggiorna ${table.name} dal Form`,
      enabled: true,
      targetFileRelPath: targetScriptRelPath,
      language: scriptLanguage,
      generatedFnName: updateFnName,
      trigger: { type: 'onClick', sourceNodeId: editButtonNodeId },
      steps: [
        {
          id: `step_val_update_${slug}`,
          kind: 'validate_form',
          stopOnFail: true,
          rules: [
            { nodeId: editIdInputNodeId, rule: 'required', errorMsg: `Inserisci ${pkCol.name} da aggiornare.` },
            ...editableFields.filter((field) => !field.column.nullable && field.valueProp === 'value').map((field): FormValidationFieldRule => ({
              nodeId: field.inputNodeId,
              rule: /email/i.test(field.column.name) ? 'email' : 'required',
              errorMsg: `Il campo "${field.labelText}" è obbligatorio.`,
            })),
          ],
        },
        {
          id: `step_upd_${slug}`,
          kind: 'sql_operation',
          operation: 'update_by_id',
          tableName: table.name,
          namedQueryId: updateQuery.id,
          columnMappings: editableFields.map((field) => ({
            columnName: field.column.name,
            value: { source: 'ui_element', nodeId: field.inputNodeId, prop: field.valueProp },
          })),
          paramBindings: {
            [pkCol.name]: { source: 'ui_element', nodeId: editIdInputNodeId, prop: 'value' },
          },
          targetTableNodeId: tableNodeId,
          refreshQueryId: listQuery.id,
          toastOnSuccess: `Record aggiornato in ${table.name}.`,
          executionBridge: 'auto',
        },
      ],
      updatedAt: now,
    });
  }

  if (includeDeleteControl && deleteButtonNodeId && deleteIdInputNodeId && pkCol && deleteQuery) {
    automations.push({
      id: deleteAutoId,
      name: `Elimina ${table.name} per ${pkCol.name}`,
      description: `Elimina il record da "${table.name}" corrispondente all'ID inserito.`,
      enabled: true,
      targetFileRelPath: targetScriptRelPath,
      language: scriptLanguage,
      generatedFnName: deleteFnName,
      trigger: {
        type: 'onClick',
        sourceNodeId: deleteButtonNodeId,
      },
      steps: [
        {
          id: `step_del_${slug}`,
          kind: 'sql_operation',
          operation: 'delete_by_id',
          tableName: table.name,
          namedQueryId: deleteQuery.id,
          paramBindings: {
            [pkCol.name]: {
              source: 'ui_element',
              nodeId: deleteIdInputNodeId,
              prop: 'value',
            },
          },
          targetTableNodeId: tableNodeId,
          refreshQueryId: listQuery.id,
          toastOnSuccess: `Record rimosso da ${table.name}.`,
          executionBridge: 'auto',
        },
      ],
      updatedAt: now,
    });
  }

  // Build top-down `UIPatchOp[]` (parents inserted before children!)
  const ops: UIPatchOp[] = [];
  const estimatedHeight =
    110 + (includeForm ? Math.ceil(fields.length / 2) * 70 + 76 : 0) + (canUpdate ? 50 : 0) + (includeDataTable ? 230 : 0);

  // 1. Root CRUD Section Card
  ops.push({
    op: 'insert_node',
    parentId: rootParentId,
    node: {
      id: rootCardNodeId,
      kind: 'container',
      name: `${toHumanLabel(table.name).replace(/\s+/g, '')}CrudCard`,
      semanticTag: 'section',
      layout: {
        mode: 'flex',
        positioning: isParentFreeform ? 'absolute' : 'flow',
        direction: 'column',
        gap: 16,
        align: 'stretch',
        justify: 'start',
        frame: { x: startX, y: startY, width: 780, height: estimatedHeight },
        width: isParentFreeform ? { mode: 'fixed', value: 780 } : { mode: 'fill', value: 780 },
        height: { mode: 'hug', value: estimatedHeight },
        padding: { top: 22, right: 24, bottom: 22, left: 24 },
      },
      style: {
        fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
        border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
        radius: 16,
      },
    },
  });

  // 2. Header Row (Title + Search + Refresh)
  ops.push({
    op: 'insert_node',
    parentId: rootCardNodeId,
    node: {
      id: headerRowId,
      kind: 'container',
      name: `${camel}HeaderBar`,
      semanticTag: 'header',
      layout: {
        mode: 'flex',
        positioning: 'flow',
        direction: 'row',
        justify: 'space-between',
        align: 'center',
        gap: 12,
        frame: { x: 0, y: 0, width: 732, height: 42 },
        width: { mode: 'fill', value: 732 },
        height: { mode: 'hug', value: 42 },
        padding: { top: 0, right: 0, bottom: 4, left: 0 },
      },
      style: {
        fills: [],
      },
    },
  });

  ops.push({
    op: 'insert_node',
    parentId: headerRowId,
    node: {
      id: titleNodeId,
      kind: 'text',
      name: `${camel}CrudTitle`,
      semanticTag: 'h2',
      typography: {
        fontFamily: { $token: 'font.sans' },
        fontSize: 18,
        fontWeight: 700,
        color: textPrimary,
      },
      content: {
        text: `Gestione ${toHumanLabel(table.name)} (${dialect.toUpperCase()})`,
      },
    },
  });

  if (includeSearchBar && searchInputId) {
    ops.push({
      op: 'insert_node',
      parentId: headerRowId,
      node: {
        id: searchInputId,
        kind: 'control',
        name: `${camel}SearchInput`,
        semanticTag: 'input',
        layout: {
          mode: 'freeform',
          positioning: 'flow',
          frame: { x: 0, y: 0, width: 220, height: 36 },
          width: { mode: 'fixed', value: 220 },
          height: { mode: 'fixed', value: 36 },
          padding: { top: 6, right: 12, bottom: 6, left: 12 },
        },
        style: {
          fills: [{ type: 'solid', color: elevatedColor }],
          border: { width: 1, style: 'solid', color: borderColor },
          radius: 8,
        },
        content: {
          controlType: 'text-input',
          placeholder: `Cerca in ${table.name}...`,
        },
        interactions: [{ trigger: 'onChange', action: { kind: 'call_script_fn', moduleRelPath: targetScriptRelPath,
          fnName: searchFnName, automationId: searchAutoId } }],
      },
    });
  }

  ops.push({
    op: 'insert_node',
    parentId: headerRowId,
    node: {
      id: refreshBtnId,
      kind: 'control',
      name: `${camel}RefreshButton`,
      semanticTag: 'button',
      layout: {
        mode: 'freeform',
        positioning: 'flow',
        frame: { x: 0, y: 0, width: 124, height: 36 },
        width: { mode: 'hug', value: 124 },
        height: { mode: 'fixed', value: 36 },
        padding: { top: 6, right: 14, bottom: 6, left: 14 },
      },
      style: {
        fills: [{ type: 'solid', color: elevatedColor }],
        border: { width: 1, style: 'solid', color: borderColor },
        radius: 8,
      },
      content: {
        controlType: 'button',
        text: '↻ Aggiorna Dati',
      },
      interactions: includeDataTable
        ? [
            {
              trigger: 'onClick',
              action: {
                kind: 'call_script_fn',
                moduleRelPath: targetScriptRelPath,
                fnName: selectFnName,
                automationId: selectAutoId,
              },
            },
          ]
        : undefined,
    },
  });

  // 3. Creation / Edit Form Container
  if (includeForm && formContainerId && fieldsGridId && actionsRowId && submitButtonNodeId) {
    ops.push({
      op: 'insert_node',
      parentId: rootCardNodeId,
      node: {
        id: formContainerId,
        kind: 'container',
        name: `${camel}Form`,
        semanticTag: 'form',
        layout: {
          mode: 'flex',
          positioning: 'flow',
          direction: 'column',
          gap: 12,
          align: 'stretch',
          frame: { x: 0, y: 0, width: 732, height: 200 },
          width: { mode: 'fill', value: 732 },
          height: { mode: 'hug', value: 200 },
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
        },
        style: {
          fills: [{ type: 'solid', color: elevatedColor }],
          border: { width: 1, style: 'solid', color: borderColor },
          radius: 12,
        },
      },
    });

    ops.push({
      op: 'insert_node',
      parentId: formContainerId,
      node: {
        id: fieldsGridId,
        kind: 'container',
        name: `${camel}FieldsGrid`,
        semanticTag: 'div',
        layout: {
          mode: 'grid',
          positioning: 'flow',
          gridCols: [
            { track: 'fr', value: 1 },
            { track: 'fr', value: 1 },
          ],
          gap: 12,
          frame: { x: 0, y: 0, width: 700, height: 140 },
          width: { mode: 'fill', value: 700 },
          height: { mode: 'hug', value: 140 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: { fills: [] },
      },
    });

    for (const field of fields) {
      const fieldBoxId = generateNodeId(`fld_${slug}`);
      const labelId = generateNodeId(`lbl_${slug}`);

      ops.push({
        op: 'insert_node',
        parentId: fieldsGridId,
        node: {
          id: fieldBoxId,
          kind: 'container',
          name: `${field.column.name}FieldGroup`,
          semanticTag: 'div',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            direction: 'column',
            gap: 5,
            align: 'stretch',
            frame: { x: 0, y: 0, width: 340, height: 64 },
            width: { mode: 'fill', value: 340 },
            height: { mode: 'hug', value: 64 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: { fills: [] },
        },
      });

      ops.push({
        op: 'insert_node',
        parentId: fieldBoxId,
        node: {
          id: labelId,
          kind: 'text',
          name: `${field.column.name}Label`,
          semanticTag: 'label',
          typography: {
            fontFamily: { $token: 'font.sans' },
            fontSize: 12,
            fontWeight: 600,
            color: textSecondary,
          },
          content: {
            text: field.labelText,
          },
        },
      });

      ops.push({
        op: 'insert_node',
        parentId: fieldBoxId,
        node: {
          id: field.inputNodeId,
          kind: 'control',
          name: `${table.name}_${field.column.name}_Input`,
          semanticTag: field.semanticTag,
          layout: {
            mode: 'freeform',
            positioning: 'flow',
            frame: { x: 0, y: 0, width: 340, height: field.controlType === 'textarea' ? 68 : 38 },
            width: { mode: 'fill', value: 340 },
            height: { mode: 'fixed', value: field.controlType === 'textarea' ? 68 : 38 },
            padding: { top: 8, right: 12, bottom: 8, left: 12 },
          },
          style: {
            fills: [{ type: 'solid', color: surfaceColor }],
            border: { width: 1, style: 'solid', color: borderColor },
            radius: 8,
          },
          content: {
            controlType: field.controlType,
            placeholder: field.placeholder,
            options: field.options,
            text: field.controlType === 'checkbox' ? field.labelText : undefined,
            checked:
              field.controlType === 'checkbox'
                ? Boolean(field.column.defaultValue && /^(true|1)$/i.test(field.column.defaultValue))
                : undefined,
          },
        },
      });
    }

    ops.push({
      op: 'insert_node',
      parentId: formContainerId,
      node: {
        id: actionsRowId,
        kind: 'container',
        name: `${camel}FormActions`,
        semanticTag: 'div',
        layout: {
          mode: 'flex',
          positioning: 'flow',
          direction: 'row',
          justify: 'space-between',
          align: 'center',
          gap: 12,
          frame: { x: 0, y: 0, width: 700, height: 40 },
          width: { mode: 'fill', value: 700 },
          height: { mode: 'hug', value: 40 },
          padding: { top: 4, right: 0, bottom: 0, left: 0 },
        },
        style: { fills: [] },
      },
    });

    if (pkCol && editIdInputNodeId && editButtonNodeId) {
      const editRowId = generateNodeId(`editrow_${slug}`);
      ops.push({
        op: 'insert_node',
        parentId: formContainerId,
        node: {
          id: editRowId,
          kind: 'container',
          name: `${camel}UpdateGroup`,
          semanticTag: 'div',
          layout: { mode: 'flex', positioning: 'flow', direction: 'row', align: 'center', gap: 8,
            frame: { x: 0, y: 0, width: 350, height: 38 }, width: { mode: 'fill', value: 350 },
            height: { mode: 'hug', value: 38 }, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        },
      }, {
        op: 'insert_node',
        parentId: editRowId,
        node: {
          id: editIdInputNodeId,
          kind: 'control',
          name: `${table.name}_UpdateId_Input`,
          semanticTag: 'input',
          layout: { mode: 'freeform', positioning: 'flow', frame: { x: 0, y: 0, width: 180, height: 36 },
            width: { mode: 'fixed', value: 180 }, height: { mode: 'fixed', value: 36 },
            padding: { top: 6, right: 10, bottom: 6, left: 10 } },
          style: { fills: [{ type: 'solid', color: surfaceColor }], border: { width: 1, style: 'solid', color: borderColor }, radius: 8 },
          content: { controlType: 'text-input', placeholder: `${pkCol.name} da aggiornare` },
        },
      }, {
        op: 'insert_node',
        parentId: editRowId,
        node: {
          id: editButtonNodeId,
          kind: 'control',
          name: `Update${toHumanLabel(table.name).replace(/\s+/g, '')}Button`,
          semanticTag: 'button',
          layout: { mode: 'freeform', positioning: 'flow', frame: { x: 0, y: 0, width: 130, height: 36 },
            width: { mode: 'hug', value: 130 }, height: { mode: 'fixed', value: 36 },
            padding: { top: 6, right: 12, bottom: 6, left: 12 } },
          style: { fills: [{ type: 'solid', color: { $token: 'color.primary.500' } }], radius: 8 },
          typography: { fontFamily: { $token: 'font.sans' }, fontSize: 12, fontWeight: 600, color: '#ffffff' },
          content: { controlType: 'button', text: 'Aggiorna record' },
          interactions: [{ trigger: 'onClick', action: { kind: 'call_script_fn', moduleRelPath: targetScriptRelPath,
            fnName: updateFnName, automationId: updateAutoId } }],
        },
      });
    }

    ops.push({
      op: 'insert_node',
      parentId: actionsRowId,
      node: {
        id: submitButtonNodeId,
        kind: 'control',
        name: `Save${toHumanLabel(table.name).replace(/\s+/g, '')}Button`,
        semanticTag: 'button',
        layout: {
          mode: 'freeform',
          positioning: 'flow',
          frame: { x: 0, y: 0, width: 180, height: 38 },
          width: { mode: 'hug', value: 180 },
          height: { mode: 'fixed', value: 38 },
          padding: { top: 8, right: 18, bottom: 8, left: 18 },
        },
        style: {
          fills: [{ type: 'solid', color: { $token: 'color.primary.500' } }],
          radius: 8,
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 13,
          fontWeight: 600,
          color: '#ffffff',
        },
        content: {
          controlType: 'button',
          text: `+ Salva in ${table.name}`,
        },
        interactions: [
          {
            trigger: 'onClick',
            action: {
              kind: 'call_script_fn',
              moduleRelPath: targetScriptRelPath,
              fnName: insertFnName,
              automationId: insertAutoId,
            },
          },
        ],
      },
    });

    if (includeDeleteControl && deleteRowId && deleteIdInputNodeId && deleteButtonNodeId && pkCol) {
      ops.push({
        op: 'insert_node',
        parentId: actionsRowId,
        node: {
          id: deleteRowId,
          kind: 'container',
          name: `${camel}DeleteGroup`,
          semanticTag: 'div',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            direction: 'row',
            align: 'center',
            gap: 8,
            frame: { x: 0, y: 0, width: 260, height: 38 },
            width: { mode: 'hug', value: 260 },
            height: { mode: 'hug', value: 38 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: { fills: [] },
        },
      });

      ops.push({
        op: 'insert_node',
        parentId: deleteRowId,
        node: {
          id: deleteIdInputNodeId,
          kind: 'control',
          name: `${table.name}_DeleteId_Input`,
          semanticTag: 'input',
          layout: {
            mode: 'freeform',
            positioning: 'flow',
            frame: { x: 0, y: 0, width: 110, height: 36 },
            width: { mode: 'fixed', value: 110 },
            height: { mode: 'fixed', value: 36 },
            padding: { top: 6, right: 10, bottom: 6, left: 10 },
          },
          style: {
            fills: [{ type: 'solid', color: surfaceColor }],
            border: { width: 1, style: 'solid', color: borderColor },
            radius: 8,
          },
          content: {
            controlType: 'text-input',
            placeholder: `${pkCol.name} da eliminare`,
          },
        },
      });

      ops.push({
        op: 'insert_node',
        parentId: deleteRowId,
        node: {
          id: deleteButtonNodeId,
          kind: 'control',
          name: `Delete${toHumanLabel(table.name).replace(/\s+/g, '')}Button`,
          semanticTag: 'button',
          layout: {
            mode: 'freeform',
            positioning: 'flow',
            frame: { x: 0, y: 0, width: 118, height: 36 },
            width: { mode: 'hug', value: 118 },
            height: { mode: 'fixed', value: 36 },
            padding: { top: 6, right: 12, bottom: 6, left: 12 },
          },
          style: {
            fills: [{ type: 'solid', color: '#dc2626' }],
            radius: 8,
          },
          typography: {
            fontFamily: { $token: 'font.sans' },
            fontSize: 12,
            fontWeight: 600,
            color: '#ffffff',
          },
          content: {
            controlType: 'button',
            text: 'Elimina ID',
          },
          interactions: [
            {
              trigger: 'onClick',
              action: {
                kind: 'call_script_fn',
                moduleRelPath: targetScriptRelPath,
                fnName: deleteFnName,
                automationId: deleteAutoId,
              },
            },
          ],
        },
      });
    }
  }

  // 4. Data Table populated with seedRows
  const colNames = table.columns.map((c) => c.name);
  const seedRows =
    sqlDocument?.seedRows.find((s) => equalSqlIdentifiers(dialect, s.tableName, table.name))
      ?.rows ?? [];
  const sampleMatrix =
    seedRows.length > 0
      ? seedRows.slice(0, 8).map((r) => colNames.map((cn) => (r[cn] === null || r[cn] === undefined ? '—' : String(r[cn]))))
      : [colNames.map((cn, idx) => (idx === 0 ? '1' : `esempio_${cn}`))];

  if (includeDataTable && tableNodeId) {
    ops.push({
      op: 'insert_node',
      parentId: rootCardNodeId,
      node: {
        id: tableNodeId,
        kind: 'control',
        name: `${toHumanLabel(table.name).replace(/\s+/g, '')}DataTable`,
        semanticTag: 'table',
        layout: {
          mode: 'freeform',
          positioning: 'flow',
          frame: { x: 0, y: 0, width: 732, height: 210 },
          width: { mode: 'fill', value: 732 },
          height: { mode: 'hug', value: 210 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: {
          fills: [{ type: 'solid', color: elevatedColor }],
          border: { width: 1, style: 'solid', color: borderColor },
          radius: 10,
        },
        content: {
          controlType: 'table',
          tableColumns: colNames,
          tableRows: sampleMatrix,
        },
        dataBindings: {
          rows: { propOrState: `${camel}Rows`, fallback: sampleMatrix },
        },
      },
    });
  }

  const stateEntries: UISheetStateSpec[] = [
    { name: `${camel}Rows`, type: 'array', initialValue: seedRows.slice(0, 10) },
    { name: `${camel}Search`, type: 'string', initialValue: '' },
    { name: `${camel}Loading`, type: 'boolean', initialValue: false },
  ];

  return {
    tableName: table.name,
    rootCardNodeId,
    tableNodeId,
    submitButtonNodeId,
    refreshButtonNodeId: refreshBtnId,
    deleteButtonNodeId,
    deleteIdInputNodeId,
    fields,
    ops,
    automations,
    namedQueries,
    stateEntries,
  };
}
