/**
 * Excel-Style Editable SQL Data Grid Model (`src/shared/sql-grid-model.ts`).
 * Ported & adapted from `Database Manager/src/components/tableDataModel.ts` + `src/utils.ts`.
 *
 * Capabilities:
 *   - Precision-safe numeric validation (preserving exact strings above JS `Number.MAX_SAFE_INTEGER` and decimals)
 *   - Inline cell parsing (`NULL` / `\N` vs text, boolean, integer, decimal, float, JSON, date/datetime)
 *   - Optimistic `SqlDataChange[]` staging (`insert`, `update`, `delete`) with row status badges (green/amber/red)
 *   - Spreadsheet keyboard navigation (`Arrow*`, `Tab`, `Shift+Tab`, `Enter`, `Home`, `End`, `PageUp`, `PageDown`)
 *   - RFC-quoted TSV / CSV clipboard parser, serializer, and multi-row paste/append planner!
 *
 * Pure TypeScript, zero Node imports.
 */

import type {
  SqlCanonicalType,
  SqlCellValue,
  SqlColumnDef,
  SqlDataChange,
  SqlDataRow,
  SqlResultColumnMeta,
} from './sql-ir';

export interface GridCellCoords {
  row: number;
  column: number;
}

export type GridRowStatus = 'clean' | 'inserted' | 'updated' | 'deleted';

export interface MaterializedGridRow {
  rowKeyId: string;
  sourceIndex: number;
  status: GridRowStatus;
  values: SqlDataRow;
  originalRow?: SqlDataRow;
  changedColumns: Set<string>;
  changeId?: string;
}

export interface ClipboardField {
  text: string;
  quoted: boolean;
}

export interface GridPasteIssue {
  row: number;
  column: number;
  columnName?: string;
  message: string;
}

export interface GridPasteCellMutation {
  sourceIndex: number;
  columnName: string;
  before: SqlCellValue;
  after: SqlCellValue;
}

export interface GridPastePlan {
  mutations: GridPasteCellMutation[];
  appendedRows: SqlDataRow[];
  issues: GridPasteIssue[];
  rowCount: number;
  columnCount: number;
  skippedHeader: boolean;
}

export function formatCellForDisplay(value: SqlCellValue | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function formatCellForInput(value: SqlCellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function inferTypeHint(col?: SqlColumnDef | SqlResultColumnMeta): SqlCanonicalType | 'any' {
  if (!col) return 'any';
  if ('canonicalType' in col && col.canonicalType) {
    return col.canonicalType;
  }
  const native = (col.nativeType ?? '').toUpperCase();
  if (/\b(BIGINT|INT8|BIGSERIAL)\b/.test(native)) return 'bigint';
  if (/\b(TINYINT\s*\(\s*1\s*\)|BOOL|BOOLEAN|BIT)\b/.test(native)) return 'boolean';
  if (/\b(INT|INTEGER|SMALLINT|SERIAL)\b/.test(native)) return 'integer';
  if (/\b(DECIMAL|NUMERIC|MONEY)\b/.test(native)) return 'decimal';
  if (/\b(REAL|FLOAT|DOUBLE)\b/.test(native)) return 'float';
  if (/\b(JSON|JSONB)\b/.test(native)) return 'json';
  return 'any';
}

/**
 * Parses and validates user cell input while preserving exact string representation
 * for large integers (`> Number.MAX_SAFE_INTEGER`) and exact `DECIMAL` columns.
 */
export function parseGridCellInput(
  rawText: string,
  col?: SqlColumnDef | SqlResultColumnMeta,
  options?: { allowNullLiteral?: boolean; isUnquotedBackslashN?: boolean },
): SqlCellValue {
  const nullable = col?.nullable !== false || Boolean(col?.primaryKey);
  const colName = col?.name ?? 'Valore';

  if (options?.isUnquotedBackslashN || (options?.allowNullLiteral !== false && rawText === 'NULL')) {
    if (!nullable) {
      throw new Error(`La colonna "${colName}" non ammette valori NULL.`);
    }
    return null;
  }

  const typeHint = inferTypeHint(col);
  const trimmed = rawText.trim();

  if (trimmed === '' && nullable && (typeHint === 'integer' || typeHint === 'bigint' || typeHint === 'decimal' || typeHint === 'float' || typeHint === 'date' || typeHint === 'datetime')) {
    return null;
  }

  if (typeHint === 'integer' || typeHint === 'bigint') {
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw new Error(`"${colName}": inserisci un numero intero valido.`);
    }
    const asNum = Number(trimmed);
    // Preserve exact string if integer exceeds JS IEEE-754 safe integer precision (`2^53 - 1`)
    if (Number.isSafeInteger(asNum) && String(asNum) === trimmed.replace(/^\+/, '')) {
      return asNum;
    }
    return trimmed;
  }

  if (typeHint === 'decimal') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
      throw new Error(`"${colName}": inserisci un numero decimale valido (usa il punto ".").`);
    }
    // Keep exact decimal string to prevent binary floating-point drift (e.g. "1490.00")
    return trimmed;
  }

  if (typeHint === 'float') {
    const asNum = Number(trimmed);
    if (!trimmed || !Number.isFinite(asNum)) {
      throw new Error(`"${colName}": inserisci un numero in virgola mobile valido.`);
    }
    return asNum;
  }

  if (typeHint === 'boolean') {
    const lower = trimmed.toLowerCase();
    if (!['true', 'false', '1', '0', 'sì', 'si', 'no'].includes(lower)) {
      throw new Error(`"${colName}": usa true/false oppure 1/0.`);
    }
    return lower === 'true' || lower === '1' || lower === 'sì' || lower === 'si';
  }

  if (typeHint === 'json') {
    try {
      JSON.parse(trimmed);
    } catch {
      throw new Error(`"${colName}": il contenuto non è un JSON valido.`);
    }
    return trimmed;
  }

  return rawText;
}

export function extractPrimaryKeyRecord(
  row: SqlDataRow,
  pkColumns: string[],
): Record<string, SqlCellValue> {
  return Object.fromEntries(pkColumns.map((key) => [key, row[key] ?? null]));
}

export function canMutateGridRow(row: MaterializedGridRow, pkColumns: string[]): boolean {
  return row.status === 'inserted' || (pkColumns.length > 0 && pkColumns.every((key) => row.originalRow?.[key] != null));
}

function samePrimaryKey(a: Record<string, SqlCellValue>, b: Record<string, SqlCellValue>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length === 0 || aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

let stagedIdCounter = 0;
function nextStagedChangeId(): string {
  stagedIdCounter = (stagedIdCounter + 1) % 1_000_000;
  return `chg_${Date.now().toString(36)}_${stagedIdCounter}`;
}

export function materializeGridRows(
  baseRows: SqlDataRow[],
  stagedChanges: SqlDataChange[],
  pkColumns: string[],
  _allColumns: string[],
): MaterializedGridRow[] {
  const result: MaterializedGridRow[] = baseRows.map((orig, idx) => {
    const pk = extractPrimaryKeyRecord(orig, pkColumns);
    const matchingChange = stagedChanges.find(
      (c) => c.kind !== 'insert' && samePrimaryKey(c.primaryKey, pk),
    );

    if (!matchingChange) {
      return {
        rowKeyId: `row_${idx}`,
        sourceIndex: idx,
        status: 'clean',
        values: { ...orig },
        originalRow: orig,
        changedColumns: new Set<string>(),
      };
    }

    if (matchingChange.kind === 'delete') {
      return {
        rowKeyId: `row_${idx}`,
        sourceIndex: idx,
        status: 'deleted',
        values: { ...orig },
        originalRow: orig,
        changedColumns: new Set<string>(),
        changeId: matchingChange.id,
      };
    }

    const merged = { ...orig, ...(matchingChange.values ?? {}) };
    const changedCols = new Set<string>(Object.keys(matchingChange.values ?? {}));
    return {
      rowKeyId: `row_${idx}`,
      sourceIndex: idx,
      status: 'updated',
      values: merged,
      originalRow: orig,
      changedColumns: changedCols,
      changeId: matchingChange.id,
    };
  });

  const inserted = stagedChanges.filter((c) => c.kind === 'insert');
  inserted.forEach((ins, offset) => {
    const sourceIndex = baseRows.length + offset;
    result.push({
      rowKeyId: ins.id ?? `ins_${offset}`,
      sourceIndex,
      status: 'inserted',
      values: { ...(ins.values ?? {}) },
      changedColumns: new Set<string>(Object.keys(ins.values ?? {})),
      changeId: ins.id,
    });
  });

  return result;
}

export function stageCellEdit(
  baseRows: SqlDataRow[],
  stagedChanges: SqlDataChange[],
  rowIndex: number,
  columnName: string,
  newValue: SqlCellValue,
  pkColumns: string[],
  allColumns: string[],
): SqlDataChange[] {
  const materialized = materializeGridRows(baseRows, stagedChanges, pkColumns, allColumns);
  const targetRow = materialized[rowIndex];
  if (!targetRow) return stagedChanges;
  if (targetRow.status === 'deleted') {
    throw new Error('Ripristina la riga eliminata prima di modificarne le celle.');
  }

  if (targetRow.status === 'inserted') {
    return stagedChanges.map((chg) =>
      chg.id === targetRow.changeId
        ? {
            ...chg,
            values: { ...(chg.values ?? {}), [columnName]: newValue },
          }
        : chg,
    );
  }

  const origRow = targetRow.originalRow ?? baseRows[targetRow.sourceIndex];
  if (!origRow) return stagedChanges;

  if (!canMutateGridRow(targetRow, pkColumns)) {
    throw new Error('Per modificare una riga esistente serve una chiave primaria completa.');
  }
  const pk = extractPrimaryKeyRecord(origRow, pkColumns);
  const existingIdx = stagedChanges.findIndex(
    (c) => c.kind === 'update' && samePrimaryKey(c.primaryKey, pk),
  );

  const prevUpdates = existingIdx >= 0 ? { ...(stagedChanges[existingIdx].values ?? {}) } : {};
  if (JSON.stringify(origRow[columnName] ?? null) === JSON.stringify(newValue ?? null)) {
    delete prevUpdates[columnName];
  } else {
    prevUpdates[columnName] = newValue;
  }

  const next = [...stagedChanges];
  if (Object.keys(prevUpdates).length === 0) {
    if (existingIdx >= 0) next.splice(existingIdx, 1);
    return next;
  }

  const updatedChange: SqlDataChange = {
    id: existingIdx >= 0 ? stagedChanges[existingIdx].id : nextStagedChangeId(),
    kind: 'update',
    primaryKey: pk,
    originalRow: origRow,
    values: prevUpdates,
  };

  if (existingIdx >= 0) {
    next[existingIdx] = updatedChange;
  } else {
    next.push(updatedChange);
  }
  return next;
}

export function stageNewBlankRow(
  stagedChanges: SqlDataChange[],
  columns: Array<SqlColumnDef | SqlResultColumnMeta>,
): SqlDataChange[] {
  const initialValues: Record<string, SqlCellValue> = {};
  for (const col of columns) {
    if (('autoIncrement' in col && col.autoIncrement) || ('defaultValue' in col && col.defaultValue?.trim())) {
      continue;
    }
    if (col.nullable === false && !col.primaryKey) {
      const hint = inferTypeHint(col);
      initialValues[col.name] =
        hint === 'integer' || hint === 'bigint'
          ? 0
          : hint === 'decimal'
            ? '0.00'
            : hint === 'float'
              ? 0
              : hint === 'boolean'
                ? false
                : '';
    } else {
      initialValues[col.name] = null;
    }
  }

  return [
    ...stagedChanges,
    {
      id: nextStagedChangeId(),
      kind: 'insert',
      primaryKey: {},
      values: initialValues,
    },
  ];
}

export function stageDeleteOrRestoreRow(
  baseRows: SqlDataRow[],
  stagedChanges: SqlDataChange[],
  rowIndex: number,
  pkColumns: string[],
  allColumns: string[],
): SqlDataChange[] {
  const materialized = materializeGridRows(baseRows, stagedChanges, pkColumns, allColumns);
  const target = materialized[rowIndex];
  if (!target) return stagedChanges;

  // Deleting a staged insert simply removes it from staging
  if (target.status === 'inserted') {
    return stagedChanges.filter((c) => c.id !== target.changeId);
  }

  const orig = target.originalRow ?? baseRows[target.sourceIndex];
  if (!orig) return stagedChanges;
  if (!canMutateGridRow(target, pkColumns)) {
    throw new Error('Per eliminare una riga esistente serve una chiave primaria completa.');
  }
  const pk = extractPrimaryKeyRecord(orig, pkColumns);

  // Toggle restore if already marked for deletion
  if (target.status === 'deleted') {
    return stagedChanges.filter((c) => !(c.kind === 'delete' && samePrimaryKey(c.primaryKey, pk)));
  }

  const withoutPriorUpdate = stagedChanges.filter(
    (c) => !(c.kind !== 'insert' && samePrimaryKey(c.primaryKey, pk)),
  );
  return [
    ...withoutPriorUpdate,
    {
      id: nextStagedChangeId(),
      kind: 'delete',
      primaryKey: pk,
      originalRow: orig,
    },
  ];
}

export function navigateGridCell(
  position: GridCellCoords,
  key: string,
  rowCount: number,
  colCount: number,
  shift = false,
  ctrl = false,
): GridCellCoords | null {
  if (rowCount <= 0 || colCount <= 0) return null;
  let row = Math.max(0, Math.min(rowCount - 1, position.row));
  let column = Math.max(0, Math.min(colCount - 1, position.column));

  switch (key) {
    case 'ArrowLeft':
      column--;
      break;
    case 'ArrowRight':
      column++;
      break;
    case 'ArrowUp':
      row--;
      break;
    case 'ArrowDown':
      row++;
      break;
    case 'PageUp':
      row -= 10;
      break;
    case 'PageDown':
      row += 10;
      break;
    case 'Home':
      column = 0;
      if (ctrl) row = 0;
      break;
    case 'End':
      column = colCount - 1;
      if (ctrl) row = rowCount - 1;
      break;
    case 'Enter':
      row += shift ? -1 : 1;
      break;
    case 'Tab': {
      const linear = row * colCount + column + (shift ? -1 : 1);
      if (linear < 0 || linear >= rowCount * colCount) return null;
      return { row: Math.floor(linear / colCount), column: linear % colCount };
    }
    default:
      return null;
  }

  return {
    row: Math.max(0, Math.min(rowCount - 1, row)),
    column: Math.max(0, Math.min(colCount - 1, column)),
  };
}

// ============================================================================
// RFC-QUOTED TSV / CSV CLIPBOARD PARSER, SERIALIZER & PASTE PLANNER
// ============================================================================

export function detectClipboardDelimiter(text: string): '\t' | ',' {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(',')) return ',';
  return '\t';
}

export function parseDelimitedClipboard(
  text: string,
  delimiter: '\t' | ',' = detectClipboardDelimiter(text),
): ClipboardField[][] {
  if (text.length > 4 * 1024 * 1024) {
    throw new Error('Il testo copiato supera 4 MiB.');
  }

  const rows: ClipboardField[][] = [];
  let currentRow: ClipboardField[] = [];
  let value = '';
  let quoted = false;
  let inQuote = false;
  let afterQuote = false;
  let fieldCount = 0;

  const pushField = () => {
    fieldCount++;
    if (fieldCount > 50_000) {
      throw new Error('Incolla al massimo 50.000 celle per operazione.');
    }
    currentRow.push({ text: value, quoted });
    value = '';
    quoted = false;
    afterQuote = false;
  };

  const pushRow = () => {
    pushField();
    rows.push(currentRow);
    currentRow = [];
  };

  // Strip trailing single newline common when copying from Excel / Google Sheets
  const normalizedText = text.replace(/\r?\n$/, '');

  for (let i = 0; i < normalizedText.length; i++) {
    const ch = normalizedText[i];
    if (inQuote) {
      if (ch === '"') {
        if (normalizedText[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuote = false;
          afterQuote = true;
        }
      } else {
        value += ch;
      }
      continue;
    }

    if (ch === '"' && value === '' && !afterQuote) {
      quoted = true;
      inQuote = true;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && normalizedText[i + 1] === '\n') i++;
      pushRow();
      continue;
    }

    value += ch;
  }

  if (inQuote) {
    throw new Error('Virgolette non chiuse nel contenuto TSV/CSV incollato.');
  }
  if (value !== '' || quoted || currentRow.length > 0) {
    pushRow();
  }

  return rows;
}

export function serializeDelimitedClipboard(
  columnNames: string[],
  rows: SqlDataRow[],
  delimiter: '\t' | ',' = '\t',
  includeHeaders = true,
): string {
  const encode = (raw: string, forceQuote = false): string => {
    if (
      forceQuote ||
      raw === '' ||
      raw === '\\N' ||
      raw.includes(delimiter) ||
      /["\r\n]/.test(raw)
    ) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  const lines: string[] = [];
  if (includeHeaders) {
    lines.push(columnNames.map((name) => encode(name)).join(delimiter));
  }
  for (const row of rows) {
    lines.push(
      columnNames
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '\\N';
          return encode(String(val));
        })
        .join(delimiter),
    );
  }
  return lines.join('\r\n');
}

export function buildClipboardPastePlan(
  baseRows: SqlDataRow[],
  stagedChanges: SqlDataChange[],
  columns: Array<SqlColumnDef | SqlResultColumnMeta>,
  startPos: GridCellCoords,
  clipboardText: string,
  pkColumns: string[],
): GridPastePlan {
  const fields = parseDelimitedClipboard(clipboardText);
  if (fields.length === 0) {
    return {
      mutations: [],
      appendedRows: [],
      issues: [],
      rowCount: 0,
      columnCount: 0,
      skippedHeader: false,
    };
  }

  const colNames = columns.map((c) => c.name);
  const materialized = materializeGridRows(baseRows, stagedChanges, pkColumns, colNames);

  // Auto-skip header row if first clipboard row matches column names starting at `startPos.column` (or col 0)
  const firstRow = fields[0];
  const matchesAtStart =
    firstRow.length > 0 &&
    firstRow.every(
      (f, idx) =>
        columns[startPos.column + idx]?.name.toLowerCase() === f.text.trim().toLowerCase(),
    );
  const skippedHeader = matchesAtStart && fields.length > 1;
  const dataRows = skippedHeader ? fields.slice(1) : fields;

  const mutations: GridPasteCellMutation[] = [];
  const appendedRows: SqlDataRow[] = [];
  const issues: GridPasteIssue[] = [];

  dataRows.forEach((line, rOffset) => {
    const targetRowIdx = startPos.row + rOffset;
    const existingRow = materialized[targetRowIdx];

    if (!existingRow) {
      // Append as a new staged insert row!
      const newRow: SqlDataRow = {};
      line.forEach((field, cOffset) => {
        const colDef = columns[startPos.column + cOffset];
        if (!colDef) return;
        if ('autoIncrement' in colDef && colDef.autoIncrement && field.text.trim() === '') {
          return;
        }
        try {
          newRow[colDef.name] = parseGridCellInput(field.text, colDef, {
            allowNullLiteral: !field.quoted,
            isUnquotedBackslashN: !field.quoted && field.text === '\\N',
          });
        } catch (err) {
          issues.push({
            row: rOffset + 1,
            column: cOffset + 1,
            columnName: colDef.name,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
      appendedRows.push(newRow);
      return;
    }

    if (existingRow.status === 'deleted') {
      issues.push({
        row: rOffset + 1,
        column: 1,
        message: 'Impossibile incollare sopra una riga marcata per l\'eliminazione.',
      });
      return;
    }

    if (!canMutateGridRow(existingRow, pkColumns)) {
      issues.push({ row: rOffset + 1, column: 1, message: 'Per incollare su una riga esistente serve una chiave primaria completa.' });
      return;
    }

    line.forEach((field, cOffset) => {
      const colDef = columns[startPos.column + cOffset];
      if (!colDef) {
        issues.push({
          row: rOffset + 1,
          column: cOffset + 1,
          message: 'Colonna incollata oltre il numero di colonne della tabella.',
        });
        return;
      }
      try {
        const parsed = parseGridCellInput(field.text, colDef, {
          allowNullLiteral: !field.quoted,
          isUnquotedBackslashN: !field.quoted && field.text === '\\N',
        });
        const before = existingRow.values[colDef.name] ?? null;
        if (JSON.stringify(before) !== JSON.stringify(parsed)) {
          mutations.push({
            sourceIndex: targetRowIdx,
            columnName: colDef.name,
            before,
            after: parsed,
          });
        }
      } catch (err) {
        issues.push({
          row: rOffset + 1,
          column: cOffset + 1,
          columnName: colDef.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  });

  return {
    mutations,
    appendedRows,
    issues,
    rowCount: dataRows.length,
    columnCount: Math.max(0, ...dataRows.map((r) => r.length)),
    skippedHeader,
  };
}

export function applyPastePlanToStagedChanges(
  baseRows: SqlDataRow[],
  stagedChanges: SqlDataChange[],
  plan: GridPastePlan,
  pkColumns: string[],
  allColumns: string[],
): SqlDataChange[] {
  if (plan.issues.length > 0) {
    throw new Error(plan.issues[0].message);
  }
  let next = [...stagedChanges];
  for (const mut of plan.mutations) {
    next = stageCellEdit(
      baseRows,
      next,
      mut.sourceIndex,
      mut.columnName,
      mut.after,
      pkColumns,
      allColumns,
    );
  }
  for (const appRow of plan.appendedRows) {
    next.push({
      id: nextStagedChangeId(),
      kind: 'insert',
      primaryKey: {},
      values: appRow,
    });
  }
  return next;
}
