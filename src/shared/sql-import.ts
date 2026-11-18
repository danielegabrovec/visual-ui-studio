/**
 * Zero-Dependency Recursive-Descent SQL DDL Importer & Static Multi-Language SQL Query Extractor.
 * Ported & adapted from `Database Manager/src/designer/schemaImport.ts`,
 * `src/files/sqlScriptAnalysis.ts`, and `src/files/queryExtraction.ts`.
 *
 * Supports `sqlite`, `postgresql`, `mysql`, `mariadb`, and `sqlserver` (T-SQL `[dbo].[t]`, `IDENTITY(1,1)`, `GO`),
 * plus static extraction from `.js`, `.ts`, `.tsx`, `.jsx`, `.py`, `.rs`, and `.sql` files without executing code.
 *
 * Pure TypeScript, zero Node imports.
 */

import {
  defaultSchemaForDialect,
  equalSqlIdentifiers,
  inferCanonicalType,
  mapCanonicalToNativeType,
  parseTypeDimensions,
  resolveEffectiveSchema,
  tableObjectKey,
} from './sql-dialects';
import type {
  ExtractedSqlOperation,
  SqlCheckConstraintDef,
  SqlColumnDef,
  SqlDesignDocument,
  SqlDialect,
  SqlForeignKeyDef,
  SqlIndexDef,
  SqlReferentialAction,
  SqlTableDef,
} from './sql-ir';
import { createBaselineSnapshotFromTable } from './sql-migration';

export interface SqlClientDirective {
  line: number;
  client: 'psql' | 'mysql' | 'sqlite-cli' | 'sqlserver';
  command: string;
}

export interface SqlScriptAnalysis {
  inferredDialect: SqlDialect | null;
  directives: SqlClientDirective[];
  warnings: string[];
}

export function analyzeSqlScript(sqlText: string): SqlScriptAnalysis {
  const directives: SqlClientDirective[] = [];
  const warnings: string[] = [];
  let inferredDialect: SqlDialect | null = null;

  const lines = sqlText.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (/^\\[a-z!?.]/i.test(trimmed)) {
      directives.push({ line: idx + 1, client: 'psql', command: trimmed.split(/\s/)[0] });
      inferredDialect ??= 'postgresql';
    } else if (/^(DELIMITER|SOURCE)\b/i.test(trimmed)) {
      directives.push({ line: idx + 1, client: 'mysql', command: trimmed.split(/\s/)[0].toUpperCase() });
      inferredDialect ??= 'mysql';
    } else if (/^\.[a-z]+\b/i.test(trimmed)) {
      directives.push({ line: idx + 1, client: 'sqlite-cli', command: trimmed.split(/\s/)[0] });
      inferredDialect ??= 'sqlite';
    } else if (/^GO(?:\s+\d+)?\s*;?$/i.test(trimmed)) {
      directives.push({ line: idx + 1, client: 'sqlserver', command: 'GO' });
      inferredDialect ??= 'sqlserver';
    }
  });

  if (!inferredDialect) {
    if (/\[dbo\]|\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)|\bNVARCHAR\b|\bDATETIME2\b/i.test(sqlText)) {
      inferredDialect = 'sqlserver';
    } else if (/\bTIMESTAMPTZ\b|\bJSONB\b|\bSERIAL\b|\bBIGSERIAL\b|GENERATED\s+(?:BY\s+DEFAULT|ALWAYS)\s+AS\s+IDENTITY/i.test(sqlText)) {
      inferredDialect = 'postgresql';
    } else if (/`[^`]+`|\bAUTO_INCREMENT\b|\bENGINE\s*=\s*InnoDB\b/i.test(sqlText)) {
      inferredDialect = 'mysql';
    } else if (/\bAUTOINCREMENT\b|\bsqlite_schema\b/i.test(sqlText)) {
      inferredDialect = 'sqlite';
    }
  }

  for (const dir of directives) {
    if (dir.client !== 'sqlserver') {
      warnings.push(
        `Riga ${dir.line}: direttiva client "${dir.command}" (${dir.client}) ignorata dall'importatore DDL.`,
      );
    }
  }

  return {
    inferredDialect,
    directives,
    warnings,
  };
}

interface DdlToken {
  raw: string;
  kind: 'word' | 'identifier' | 'string' | 'symbol';
  line: number;
  offset: number;
}

function preprocessScriptBatches(source: string): string {
  // Replace standalone T-SQL `GO` batch lines and client meta-commands with `;` while preserving line count
  return source
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (/^GO(?:\s+\d+)?\s*;?$/i.test(trimmed)) return ';';
      if (/^\\[a-z!?.]/i.test(trimmed) || /^\.[a-z]+\b/i.test(trimmed)) return '';
      return line;
    })
    .join('\n');
}

function tokenizeDdl(source: string, dialect: SqlDialect): DdlToken[] {
  const cleaned = preprocessScriptBatches(source);
  const matcher =
    /\s+|--[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|N?'(?:[^'\\]|''|\\[\s\S])*'|[\p{L}\p{N}_$]+|./gsu;
  const isMysqlFamily = dialect === 'mysql' || dialect === 'mariadb';
  const tokens: DdlToken[] = [];
  let line = 1;

  for (const match of cleaned.matchAll(matcher)) {
    const raw = match[0];
    const tokenLine = line;
    line += raw.split('\n').length - 1;
    if (
      /^\s/.test(raw) ||
      raw.startsWith('--') ||
      raw.startsWith('/*') ||
      (isMysqlFamily && raw.startsWith('#'))
    ) {
      continue;
    }
    const first = raw[0];
    let kind: DdlToken['kind'] = 'symbol';
    if ((first === "'" && raw.length > 1) || ((first === 'N' || first === 'n') && raw[1] === "'")) {
      kind = 'string';
    } else if ('"`['.includes(first) && raw.length > 1) {
      kind = 'identifier';
    } else if (/^[\p{L}\p{N}_$]/u.test(raw)) {
      kind = 'word';
    }
    tokens.push({ raw, kind, line: tokenLine, offset: match.index ?? 0 });
  }
  return tokens;
}

function splitTokensTopLevel(tokens: DdlToken[], separator: string): DdlToken[][] {
  const sections: DdlToken[][] = [];
  let current: DdlToken[] = [];
  let depth = 0;
  for (const tok of tokens) {
    if (tok.kind === 'symbol' && tok.raw === '(') depth++;
    else if (tok.kind === 'symbol' && tok.raw === ')') depth = Math.max(0, depth - 1);

    if (depth === 0 && tok.kind === 'symbol' && tok.raw === separator) {
      sections.push(current);
      current = [];
    } else {
      current.push(tok);
    }
  }
  if (current.length > 0) {
    sections.push(current);
  }
  return sections;
}

function reconstructTokensText(tokens: DdlToken[]): string {
  return tokens
    .map((tok, idx) => {
      const prev = tokens[idx - 1];
      const needSpace = prev && prev.offset + prev.raw.length !== tok.offset;
      return (needSpace ? ' ' : '') + tok.raw;
    })
    .join('')
    .trim();
}

const COLUMN_CONSTRAINT_STOP_WORDS = new Set([
  'NOT',
  'NULL',
  'PRIMARY',
  'UNIQUE',
  'DEFAULT',
  'REFERENCES',
  'CHECK',
  'CONSTRAINT',
  'COLLATE',
  'GENERATED',
  'AUTOINCREMENT',
  'AUTO_INCREMENT',
  'IDENTITY',
  'COMMENT',
  'ON',
]);

class DdlReader {
  public pos = 0;

  constructor(
    public readonly tokens: DdlToken[],
    public readonly dialect: SqlDialect,
    public readonly defaultSchema?: string,
  ) {}

  peek(offset = 0): DdlToken | undefined {
    return this.tokens[this.pos + offset];
  }

  takeWordOrSymbol(upperExpected: string): boolean {
    const tok = this.peek();
    if (
      tok &&
      (tok.kind === 'word' || tok.kind === 'symbol') &&
      tok.raw.toUpperCase() === upperExpected
    ) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(upperExpected: string): void {
    if (!this.takeWordOrSymbol(upperExpected)) {
      const got = this.peek()?.raw ?? 'fine istruzione';
      throw new Error(`Era previsto "${upperExpected}" (trovato "${got}").`);
    }
  }

  readIdentifier(): string {
    const tok = this.tokens[this.pos++];
    if (!tok) throw new Error('Era previsto un identificatore.');
    if (tok.kind === 'identifier') {
      const open = tok.raw[0];
      const close = open === '[' ? ']' : open;
      return tok.raw.slice(1, -1).split(close + close).join(close);
    }
    if (tok.kind === 'word') {
      return this.dialect === 'postgresql' ? tok.raw.toLowerCase() : tok.raw;
    }
    throw new Error(`Identificatore non valido vicino a "${tok.raw}".`);
  }

  readObjectRef(): { schema?: string; name: string } {
    const first = this.readIdentifier();
    if (!this.takeWordOrSymbol('.')) {
      return { schema: resolveEffectiveSchema(this.dialect, this.defaultSchema), name: first };
    }
    const second = this.readIdentifier();
    if (this.dialect === 'sqlite' && first.toLowerCase() === 'main') {
      return { name: second };
    }
    return { schema: resolveEffectiveSchema(this.dialect, first), name: second };
  }

  readEnclosed(): DdlToken[] {
    this.expect('(');
    const start = this.pos;
    let depth = 1;
    while (this.peek()) {
      if (this.takeWordOrSymbol('(')) depth++;
      else if (this.takeWordOrSymbol(')')) {
        depth--;
        if (depth === 0) {
          return this.tokens.slice(start, this.pos - 1);
        }
      } else {
        this.pos++;
      }
    }
    throw new Error('Parentesi "(" non chiusa.');
  }

  readIdentifierList(): string[] {
    const inner = this.readEnclosed();
    return splitTokensTopLevel(inner, ',').map((part) => {
      const sub = new DdlReader(part, this.dialect, this.defaultSchema);
      const id = sub.readIdentifier();
      // Ignore optional ASC/DESC or prefix length in index column lists
      return id;
    });
  }
}

function readReferentialActions(reader: DdlReader): {
  onDelete?: SqlReferentialAction;
  onUpdate?: SqlReferentialAction;
} {
  let onDelete: SqlReferentialAction | undefined;
  let onUpdate: SqlReferentialAction | undefined;

  const parseAction = (): SqlReferentialAction => {
    if (reader.takeWordOrSymbol('CASCADE')) return 'CASCADE';
    if (reader.takeWordOrSymbol('RESTRICT')) return 'RESTRICT';
    if (reader.takeWordOrSymbol('NO')) {
      reader.expect('ACTION');
      return 'NO ACTION';
    }
    if (reader.takeWordOrSymbol('SET')) {
      if (reader.takeWordOrSymbol('NULL')) return 'SET NULL';
      if (reader.takeWordOrSymbol('DEFAULT')) return 'SET DEFAULT';
    }
    return 'NO ACTION';
  };

  while (reader.peek()?.raw.toUpperCase() === 'ON') {
    const nextUpper = reader.peek(1)?.raw.toUpperCase();
    if (nextUpper === 'DELETE') {
      reader.pos += 2;
      onDelete = parseAction();
    } else if (nextUpper === 'UPDATE') {
      reader.pos += 2;
      onUpdate = parseAction();
    } else {
      break;
    }
  }

  return { onDelete, onUpdate };
}

function readDataTypeExpression(reader: DdlReader): string {
  const start = reader.pos;
  let depth = 0;
  while (reader.peek()) {
    const tok = reader.peek()!;
    if (
      depth === 0 &&
      reader.pos > start &&
      tok.kind === 'word' &&
      COLUMN_CONSTRAINT_STOP_WORDS.has(tok.raw.toUpperCase())
    ) {
      break;
    }
    if (tok.kind === 'symbol' && tok.raw === '(') depth++;
    else if (tok.kind === 'symbol' && tok.raw === ')') depth = Math.max(0, depth - 1);
    reader.pos++;
  }
  return reconstructTokensText(reader.tokens.slice(start, reader.pos));
}

function readDefaultExpression(reader: DdlReader): string {
  if (reader.peek()?.raw === '(') {
    const inner = reader.readEnclosed();
    const innerText = reconstructTokensText(inner);
    // Unwrap T-SQL double parens like ((1)) or (('standard'))
    if (innerText.startsWith('(') && innerText.endsWith(')')) {
      return innerText.slice(1, -1).trim();
    }
    return innerText;
  }
  const start = reader.pos;
  let depth = 0;
  while (reader.peek()) {
    const tok = reader.peek()!;
    if (
      depth === 0 &&
      reader.pos > start &&
      tok.kind === 'word' &&
      COLUMN_CONSTRAINT_STOP_WORDS.has(tok.raw.toUpperCase())
    ) {
      break;
    }
    if (tok.kind === 'symbol' && tok.raw === '(') depth++;
    else if (tok.kind === 'symbol' && tok.raw === ')') depth = Math.max(0, depth - 1);
    reader.pos++;
  }
  return reconstructTokensText(reader.tokens.slice(start, reader.pos));
}

let importIdSeq = 0;
function nextImportId(prefix: string): string {
  importIdSeq = (importIdSeq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${importIdSeq.toString(36)}`;
}

function parseCreateTableStatement(
  reader: DdlReader,
  tableIndex: number,
): SqlTableDef {
  const owner = reader.readObjectRef();
  const bodyTokens = reader.readEnclosed();
  // Consume optional trailing table options (ENGINE=InnoDB, WITHOUT ROWID, STRICT, ON [PRIMARY], etc.)
  const items = splitTokensTopLevel(bodyTokens, ',');

  const columns: SqlColumnDef[] = [];
  const foreignKeys: SqlForeignKeyDef[] = [];
  const indexes: SqlIndexDef[] = [];
  const checks: SqlCheckConstraintDef[] = [];
  let tablePrimaryKeys: string[] = [];

  for (const rawItem of items) {
    if (rawItem.length === 0) continue;
    const item = new DdlReader(rawItem, reader.dialect, reader.defaultSchema);

    let constraintName: string | undefined;
    if (item.takeWordOrSymbol('CONSTRAINT')) {
      constraintName = item.readIdentifier();
    }

    if (item.takeWordOrSymbol('PRIMARY')) {
      item.expect('KEY');
      // Skip optional CLUSTERED / NONCLUSTERED in T-SQL
      item.takeWordOrSymbol('CLUSTERED');
      item.takeWordOrSymbol('NONCLUSTERED');
      tablePrimaryKeys = item.readIdentifierList();
      continue;
    }

    if (item.takeWordOrSymbol('FOREIGN')) {
      item.expect('KEY');
      const srcCols = item.readIdentifierList();
      item.expect('REFERENCES');
      const refObj = item.readObjectRef();
      const dstCols = item.peek()?.raw === '(' ? item.readIdentifierList() : ['id'];
      const actions = readReferentialActions(item);
      foreignKeys.push({
        id: nextImportId('fk'),
        name: constraintName,
        columns: srcCols,
        referencedSchema: refObj.schema,
        referencedTable: refObj.name,
        referencedColumns: dstCols,
        ...actions,
      });
      continue;
    }

    if (item.takeWordOrSymbol('UNIQUE')) {
      item.takeWordOrSymbol('KEY');
      item.takeWordOrSymbol('INDEX');
      let uqName = constraintName;
      if (item.peek() && item.peek()!.raw !== '(') {
        uqName = item.readIdentifier();
      }
      const cols = item.readIdentifierList();
      if (cols.length === 1) {
        const targetCol = columns.find((c) => equalSqlIdentifiers(reader.dialect, c.name, cols[0]));
        if (targetCol) targetCol.unique = true;
      }
      indexes.push({
        id: nextImportId('idx'),
        name: uqName || `uq_${owner.name}_${indexes.length + 1}`,
        columns: cols,
        unique: true,
      });
      continue;
    }

    if (item.takeWordOrSymbol('KEY') || item.takeWordOrSymbol('INDEX')) {
      const idxName =
        item.peek() && item.peek()!.raw !== '('
          ? item.readIdentifier()
          : `idx_${owner.name}_${indexes.length + 1}`;
      const cols = item.readIdentifierList();
      indexes.push({
        id: nextImportId('idx'),
        name: idxName,
        columns: cols,
        unique: false,
      });
      continue;
    }

    if (item.takeWordOrSymbol('CHECK')) {
      const exprTokens = item.readEnclosed();
      checks.push({
        id: nextImportId('chk'),
        name: constraintName,
        expression: reconstructTokensText(exprTokens),
      });
      continue;
    }

    // Column definition
    const colName = item.readIdentifier();
    const rawType = readDataTypeExpression(item);
    if (!rawType) {
      throw new Error(`Tipo colonna mancante per "${owner.name}.${colName}".`);
    }

    const isSerial = /\b(SMALLSERIAL|SERIAL|BIGSERIAL)\b/i.test(rawType);
    const canonicalType = inferCanonicalType(rawType);
    const dims = parseTypeDimensions(rawType);
    const normalizedNative = isSerial
      ? mapCanonicalToNativeType(canonicalType, reader.dialect, { autoIncrement: true })
      : rawType;

    const col: SqlColumnDef = {
      id: nextImportId('col'),
      name: colName,
      sourceName: colName,
      canonicalType,
      nativeType: normalizedNative,
      ...dims,
      nullable: true,
      primaryKey: false,
      unique: false,
      autoIncrement: isSerial,
    };

    while (item.peek()) {
      if (item.takeWordOrSymbol('CONSTRAINT')) {
        item.readIdentifier();
      } else if (item.takeWordOrSymbol('NOT')) {
        item.expect('NULL');
        col.nullable = false;
      } else if (item.takeWordOrSymbol('NULL')) {
        col.nullable = true;
      } else if (item.takeWordOrSymbol('PRIMARY')) {
        item.expect('KEY');
        item.takeWordOrSymbol('CLUSTERED');
        item.takeWordOrSymbol('NONCLUSTERED');
        item.takeWordOrSymbol('ASC');
        item.takeWordOrSymbol('DESC');
        col.primaryKey = true;
        col.nullable = false;
      } else if (item.takeWordOrSymbol('UNIQUE')) {
        col.unique = true;
      } else if (item.takeWordOrSymbol('AUTOINCREMENT') || item.takeWordOrSymbol('AUTO_INCREMENT')) {
        col.autoIncrement = true;
      } else if (item.takeWordOrSymbol('IDENTITY')) {
        if (item.peek()?.raw === '(') {
          item.readEnclosed();
        }
        col.autoIncrement = true;
      } else if (item.takeWordOrSymbol('GENERATED')) {
        if (item.takeWordOrSymbol('ALWAYS') || (item.takeWordOrSymbol('BY') && item.takeWordOrSymbol('DEFAULT'))) {
          item.expect('AS');
          if (item.takeWordOrSymbol('IDENTITY')) {
            if (item.peek()?.raw === '(') item.readEnclosed();
            col.autoIncrement = true;
          } else if (item.peek()?.raw === '(') {
            item.readEnclosed();
            item.takeWordOrSymbol('STORED');
            item.takeWordOrSymbol('VIRTUAL');
          }
        }
      } else if (item.takeWordOrSymbol('DEFAULT')) {
        col.defaultValue = readDefaultExpression(item);
      } else if (item.takeWordOrSymbol('CHECK')) {
        const chkTokens = item.readEnclosed();
        col.checkExpr = reconstructTokensText(chkTokens);
      } else if (item.takeWordOrSymbol('REFERENCES')) {
        const refObj = item.readObjectRef();
        const dstCols = item.peek()?.raw === '(' ? item.readIdentifierList() : ['id'];
        const actions = readReferentialActions(item);
        foreignKeys.push({
          id: nextImportId('fk'),
          name: `fk_${owner.name}_${colName}`,
          columns: [colName],
          referencedSchema: refObj.schema,
          referencedTable: refObj.name,
          referencedColumns: dstCols,
          ...actions,
        });
      } else if (item.takeWordOrSymbol('COMMENT')) {
        const commentTok = item.tokens[item.pos++];
        if (commentTok?.kind === 'string') {
          col.comment = commentTok.raw.replace(/^N?'|'$/g, '').replace(/''/g, "'");
        }
      } else if (item.takeWordOrSymbol('COLLATE')) {
        item.readIdentifier();
      } else {
        // Advance past vendor-specific column suffix token gracefully
        item.pos++;
      }
    }

    columns.push(col);
  }

  for (const pkName of tablePrimaryKeys) {
    const found = columns.find((c) => equalSqlIdentifiers(reader.dialect, c.name, pkName));
    if (found) {
      found.primaryKey = true;
      found.nullable = false;
    }
  }

  const colIdx = tableIndex % 3;
  const rowIdx = Math.floor(tableIndex / 3);
  const table: SqlTableDef = {
    id: nextImportId('tbl'),
    schema: owner.schema,
    name: owner.name,
    columns,
    foreignKeys,
    indexes,
    checks,
    position: {
      x: 64 + colIdx * 390,
      y: 64 + rowIdx * 340,
    },
  };
  table.baselineSnapshot = createBaselineSnapshotFromTable(table);
  return table;
}

export interface DdlImportResult {
  dialect: SqlDialect;
  tables: SqlTableDef[];
  issues: Array<{ line: number; message: string }>;
  warnings: string[];
}

export function importSqlDdlToTables(
  sqlText: string,
  explicitDialect?: SqlDialect,
): DdlImportResult {
  const analysis = analyzeSqlScript(sqlText);
  const dialect: SqlDialect = explicitDialect ?? analysis.inferredDialect ?? 'sqlite';

  if (sqlText.length > 512 * 1024) {
    return {
      dialect,
      tables: [],
      issues: [{ line: 1, message: 'Lo script SQL supera 512 KiB. Suddividi il dump prima dell\'importazione.' }],
      warnings: analysis.warnings,
    };
  }

  const tables: SqlTableDef[] = [];
  const issues: Array<{ line: number; message: string }> = [];
  const deferredTasks: Array<{ line: number; run: () => void }> = [];
  let activeDefaultSchema = defaultSchemaForDialect(dialect);

  const findImportedTable = (ref: { schema?: string; name: string }): SqlTableDef => {
    const key = tableObjectKey(dialect, ref);
    const exact = tables.find((t) => tableObjectKey(dialect, t) === key);
    if (exact) return exact;
    const byName = tables.find((t) => equalSqlIdentifiers(dialect, t.name, ref.name));
    if (byName) return byName;
    throw new Error(`Tabella "${ref.name}" non trovata nello script importato.`);
  };

  const allTokens = tokenizeDdl(sqlText, dialect);
  const statements = splitTokensTopLevel(allTokens, ';');

  for (const stmtTokens of statements) {
    if (stmtTokens.length === 0) continue;
    const stmtLine = stmtTokens[0].line;
    const reader = new DdlReader(stmtTokens, dialect, activeDefaultSchema);

    try {
      if (reader.takeWordOrSymbol('CREATE')) {
        reader.takeWordOrSymbol('OR');
        reader.takeWordOrSymbol('REPLACE');

        if (reader.takeWordOrSymbol('SCHEMA')) {
          if (reader.takeWordOrSymbol('IF')) {
            reader.expect('NOT');
            reader.expect('EXISTS');
          }
          reader.readIdentifier();
          continue;
        }

        reader.takeWordOrSymbol('TEMP');
        reader.takeWordOrSymbol('TEMPORARY');

        if (reader.takeWordOrSymbol('TABLE')) {
          if (reader.takeWordOrSymbol('IF')) {
            reader.expect('NOT');
            reader.expect('EXISTS');
          }
          const parsedTable = parseCreateTableStatement(reader, tables.length);
          tables.push(parsedTable);
          continue;
        }

        const isUnique = reader.takeWordOrSymbol('UNIQUE');
        reader.takeWordOrSymbol('CLUSTERED');
        reader.takeWordOrSymbol('NONCLUSTERED');
        if (reader.takeWordOrSymbol('INDEX')) {
          if (reader.takeWordOrSymbol('IF')) {
            reader.expect('NOT');
            reader.expect('EXISTS');
          }
          const idxName = reader.readIdentifier();
          reader.expect('ON');
          const targetRef = reader.readObjectRef();
          const cols = reader.readIdentifierList();
          let whereClause: string | undefined;
          if (reader.takeWordOrSymbol('WHERE')) {
            whereClause = reconstructTokensText(reader.tokens.slice(reader.pos));
          }
          deferredTasks.push({
            line: stmtLine,
            run: () => {
              const target = findImportedTable(targetRef);
              target.indexes.push({
                id: nextImportId('idx'),
                name: idxName,
                columns: cols,
                unique: isUnique,
                whereClause,
              });
              target.baselineSnapshot = createBaselineSnapshotFromTable(target);
            },
          });
          continue;
        }
        // Ignore CREATE VIEW / TRIGGER / FUNCTION gracefully without failing table import
        continue;
      }

      if (reader.takeWordOrSymbol('ALTER')) {
        if (!reader.takeWordOrSymbol('TABLE')) continue;
        if (reader.takeWordOrSymbol('ONLY')) {
          // PostgreSQL `ALTER TABLE ONLY ...`
        }
        const ownerRef = reader.readObjectRef();
        // Skip T-SQL `WITH CHECK` / `WITH NOCHECK`
        if (reader.takeWordOrSymbol('WITH')) {
          reader.takeWordOrSymbol('CHECK');
          reader.takeWordOrSymbol('NOCHECK');
        }
        if (!reader.takeWordOrSymbol('ADD')) continue;
        let constraintName: string | undefined;
        if (reader.takeWordOrSymbol('CONSTRAINT')) {
          constraintName = reader.readIdentifier();
        }
        if (reader.takeWordOrSymbol('FOREIGN')) {
          reader.expect('KEY');
          const srcCols = reader.readIdentifierList();
          reader.expect('REFERENCES');
          const dstRef = reader.readObjectRef();
          const dstCols = reader.peek()?.raw === '(' ? reader.readIdentifierList() : ['id'];
          const actions = readReferentialActions(reader);
          deferredTasks.push({
            line: stmtLine,
            run: () => {
              const ownerTbl = findImportedTable(ownerRef);
              ownerTbl.foreignKeys.push({
                id: nextImportId('fk'),
                name: constraintName,
                columns: srcCols,
                referencedSchema: dstRef.schema,
                referencedTable: dstRef.name,
                referencedColumns: dstCols,
                ...actions,
              });
              ownerTbl.baselineSnapshot = createBaselineSnapshotFromTable(ownerTbl);
            },
          });
        }
        continue;
      }

      if (dialect === 'postgresql' && reader.takeWordOrSymbol('SET')) {
        if (reader.takeWordOrSymbol('SEARCH_PATH')) {
          if (!reader.takeWordOrSymbol('TO')) reader.takeWordOrSymbol('=');
          activeDefaultSchema = reader.readIdentifier();
        }
        continue;
      }
    } catch (err) {
      issues.push({
        line: stmtLine,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const task of deferredTasks) {
    try {
      task.run();
    } catch (err) {
      issues.push({
        line: task.line,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    dialect,
    tables,
    issues: issues.sort((a, b) => a.line - b.line),
    warnings: analysis.warnings,
  };
}

export function mergeImportedTablesIntoDocument(
  doc: SqlDesignDocument,
  sqlText: string,
  options?: { replaceExisting?: boolean; overrideDialect?: SqlDialect },
): {
  document: SqlDesignDocument;
  importedCount: number;
  issues: Array<{ line: number; message: string }>;
  warnings: string[];
} {
  const res = importSqlDdlToTables(sqlText, options?.overrideDialect ?? doc.dialect);
  const nextTables = options?.replaceExisting
    ? res.tables
    : [
        ...doc.tables.filter(
          (existing) =>
            !res.tables.some((imp) => equalSqlIdentifiers(res.dialect, imp.name, existing.name)),
        ),
        ...res.tables,
      ];

  return {
    document: {
      ...doc,
      dialect: res.dialect,
      tables: nextTables,
      updatedAt: Date.now(),
    },
    importedCount: res.tables.length,
    issues: res.issues,
    warnings: res.warnings,
  };
}

// ============================================================================
// BOUNDED STATIC MULTI-LANGUAGE SQL QUERY EXTRACTOR (`.js/.ts/.py/.rs/.sql`)
// ============================================================================

const SQL_STATEMENT_HEAD_RE =
  /^\s*(?:--\s*[^\n]*\n\s*)*(?:WITH\s+[a-zA-Z_][\w]*\s+AS\s*\(|SELECT\s+|INSERT\s+(?:OR\s+\w+\s+)?INTO\s+|UPDATE\s+["`[\w]|DELETE\s+FROM\s+|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|SCHEMA)\s+|ALTER\s+TABLE\s+|DROP\s+(?:TABLE|INDEX|VIEW)\s+)/i;

function classifySqlOperationKind(sql: string): ExtractedSqlOperation['kind'] {
  const head = sql.replace(/^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/, '').trim().toUpperCase();
  if (/^(CREATE|ALTER|DROP|TRUNCATE)\b/.test(head)) return 'ddl';
  if (/^(SELECT|WITH)\b/.test(head)) return 'select';
  if (/^INSERT\b/.test(head)) return 'insert';
  if (/^UPDATE\b/.test(head)) return 'update';
  if (/^DELETE\b/.test(head)) return 'delete';
  return 'raw';
}

function extractSqlParametersFromText(sql: string): string[] {
  const params: string[] = [];
  const seen = new Set<string>();
  const matcher =
    /\$\{\s*([^}]+?)\s*\}|\$(\d+)|(?<!:):([a-zA-Z_]\w*)|@([a-zA-Z_]\w*)|%\(([a-zA-Z_]\w*)\)s|\?/g;
  let qCount = 0;
  for (const m of sql.matchAll(matcher)) {
    let name = '';
    if (m[1]) name = m[1].trim();
    else if (m[2]) name = `$${m[2]}`;
    else if (m[3]) name = `:${m[3]}`;
    else if (m[4]) name = `@${m[4]}`;
    else if (m[5]) name = m[5];
    else if (m[0] === '?') name = `?${++qCount}`;
    if (name && !seen.has(name)) {
      seen.add(name);
      params.push(name);
    }
  }
  return params;
}

export function detectFileSourceLanguage(filePath: string): string {
  const ext = filePath.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'sql':
      return 'sql';
    default:
      return 'unknown';
  }
}

function lineNumberAtOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function findEnclosingFunctionName(source: string, offset: number, language: string): string | undefined {
  const prefix = source.slice(Math.max(0, offset - 4000), offset);
  let match: RegExpExecArray | null = null;
  let lastFound: string | undefined;

  const pattern =
    language === 'python'
      ? /\b(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/g
      : language === 'rust'
        ? /\b(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_]\w*)\s*[<(]/g
        : /\b(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(|\b(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;

  while ((match = pattern.exec(prefix)) !== null) {
    lastFound = match[1] || match[2] || lastFound;
  }
  return lastFound;
}

/**
 * Statically scans a `.js`, `.ts`, `.tsx`, `.py`, `.rs`, or `.sql` source file and extracts
 * embedded SQL queries/DDL statements, their parameters, line numbers, and enclosing functions.
 */
export function extractSqlFromSourceCode(
  sourceCode: string,
  filePath: string,
): ExtractedSqlOperation[] {
  if (!sourceCode || sourceCode.length > 512 * 1024) return [];
  const language = detectFileSourceLanguage(filePath);
  if (language === 'unknown') return [];

  if (language === 'sql') {
    const tokens = tokenizeDdl(sourceCode, 'sqlite');
    const stmts = splitTokensTopLevel(tokens, ';');
    return stmts
      .filter((s) => s.length > 0)
      .map((s) => {
        const text = reconstructTokensText(s);
        return {
          filePath,
          line: s[0].line,
          language: 'sql',
          kind: classifySqlOperationKind(text),
          sql: text,
          parameters: extractSqlParametersFromText(text),
        };
      });
  }

  const results: ExtractedSqlOperation[] = [];
  const seenAtOffset = new Set<number>();

  const considerLiteral = (rawBody: string, startOffset: number) => {
    if (seenAtOffset.has(startOffset)) return;
    const unescaped = rawBody
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '')
      .replace(/\\(["'`])/g, '$1')
      .trim();
    if (unescaped.length < 10) return;
    if (!SQL_STATEMENT_HEAD_RE.test(unescaped)) return;

    seenAtOffset.add(startOffset);
    results.push({
      filePath,
      line: lineNumberAtOffset(sourceCode, startOffset),
      language,
      kind: classifySqlOperationKind(unescaped),
      sql: unescaped,
      parameters: extractSqlParametersFromText(unescaped),
      enclosingFn: findEnclosingFunctionName(sourceCode, startOffset, language),
    });
  };

  // Bounded lexical scan over comments & string literals per language
  let i = 0;
  const n = sourceCode.length;

  while (i < n && results.length < 200) {
    const ch = sourceCode[i];

    // Skip single-line comments (`//` in JS/TS/Rust, `#` in Python)
    if (
      (language !== 'python' && ch === '/' && sourceCode[i + 1] === '/') ||
      (language === 'python' && ch === '#')
    ) {
      const nl = sourceCode.indexOf('\n', i + 1);
      i = nl < 0 ? n : nl + 1;
      continue;
    }

    // Skip C-style block comments (`/* ... */`)
    if (language !== 'python' && ch === '/' && sourceCode[i + 1] === '*') {
      const end = sourceCode.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }

    // Rust raw strings: r#"..."# or r"..."
    if (language === 'rust' && ch === 'r' && (sourceCode[i + 1] === '#' || sourceCode[i + 1] === '"')) {
      let hashes = 0;
      let j = i + 1;
      while (sourceCode[j] === '#') {
        hashes++;
        j++;
      }
      if (sourceCode[j] === '"') {
        const bodyStart = j + 1;
        const closingSeq = '"' + '#'.repeat(hashes);
        const end = sourceCode.indexOf(closingSeq, bodyStart);
        if (end >= 0) {
          considerLiteral(sourceCode.slice(bodyStart, end), i);
          i = end + closingSeq.length;
          continue;
        }
      }
    }

    // Python triple-quoted strings (`"""..."""` or `'''...'''`, with optional f/r prefix)
    if (language === 'python') {
      let quoteStart = i;
      if ((ch === 'f' || ch === 'r' || ch === 'F' || ch === 'R') && (sourceCode[i + 1] === '"' || sourceCode[i + 1] === "'")) {
        quoteStart = i + 1;
      }
      const qChar = sourceCode[quoteStart];
      if (
        (qChar === '"' || qChar === "'") &&
        sourceCode[quoteStart + 1] === qChar &&
        sourceCode[quoteStart + 2] === qChar
      ) {
        const triple = qChar.repeat(3);
        const bodyStart = quoteStart + 3;
        const end = sourceCode.indexOf(triple, bodyStart);
        if (end >= 0) {
          considerLiteral(sourceCode.slice(bodyStart, end), i);
          i = end + 3;
          continue;
        }
      }
    }

    // Standard single/double/backtick string literals
    if (ch === '`' || ch === '"' || ch === "'") {
      const quote = ch;
      const startOffset = i;
      i++;
      let body = '';
      while (i < n) {
        const cur = sourceCode[i];
        if (cur === '\\') {
          body += sourceCode.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (quote === '`' && cur === '$' && sourceCode[i + 1] === '{') {
          // Balanced JS/TS template interpolation `${...}`
          let braceDepth = 1;
          let k = i + 2;
          while (k < n && braceDepth > 0) {
            if (sourceCode[k] === '{') braceDepth++;
            else if (sourceCode[k] === '}') braceDepth--;
            k++;
          }
          body += sourceCode.slice(i, k);
          i = k;
          continue;
        }
        if (cur === quote) {
          i++;
          break;
        }
        body += cur;
        i++;
      }
      considerLiteral(body, startOffset);
      continue;
    }

    i++;
  }

  return results;
}
