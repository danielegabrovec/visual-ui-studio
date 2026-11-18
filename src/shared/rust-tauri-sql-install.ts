import type { TargetArtifactBundle } from './ui-ir';

export const RUST_TAURI_SQL_PATHS = {
  manifest: 'src-tauri/Cargo.toml',
  library: 'src-tauri/src/lib.rs',
  rustModule: 'src-tauri/src/studio_sql.rs',
  client: 'src/lib/tauri-db-client.ts',
  schema: 'src-tauri/sql/studio-schema.sql',
} as const;

export const RUST_TAURI_SQL_MODULE_MARKER = '// @studio-tauri-sql-module';
export const RUST_TAURI_SQL_SETUP_MARKER = '// @studio-tauri-sql-setup';

export function planRustTauriSqlInstall(bundle: TargetArtifactBundle, manifest: string, existingLibrary: string) {
  const dependencies = manifest.match(/^\[dependencies\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? '';
  const compatible = ['tauri', 'rusqlite', 'serde'].every((name) => new RegExp(`^\\s*${name}\\s*=`, 'm').test(dependencies));
  if (!compatible) throw new Error('Il progetto deve già includere tauri, rusqlite e serde in Cargo.toml.');

  const paths = [RUST_TAURI_SQL_PATHS.rustModule, RUST_TAURI_SQL_PATHS.client, RUST_TAURI_SQL_PATHS.schema];
  if (bundle.targetId !== 'tauri-v2' || bundle.files.length !== paths.length || bundle.diagnostics.some((d) => d.severity === 'error')) {
    throw new Error('Il modulo Rust/SQLite generato non è valido.');
  }
  const files = paths.map((relativePath) => {
    const file = bundle.files.find((entry) => entry.relativePath === relativePath);
    if (!file || !file.code) throw new Error(`Manca il file generato ${relativePath}.`);
    return { relativePath, content: file.code };
  });
  const moduleSource = files[0].content;
  const commandStart = moduleSource.lastIndexOf('// @studio-tauri-commands:start');
  const commandEnd = moduleSource.lastIndexOf('// @studio-tauri-commands:end');
  const commandRegion = commandStart !== -1 && commandEnd > commandStart ? moduleSource.slice(commandStart, commandEnd) : '';
  const commands = Array.from(commandRegion.matchAll(/^#\[tauri::command\]\r?\npub fn (studio_sql_\w+)\(/gm), ([, command]) => command);
  const commandCount = Array.from(commandRegion.matchAll(/^#\[tauri::command\]/gm)).length;
  if (!commands.length || commands.length !== commandCount || new Set(commands).size !== commands.length) {
    throw new Error('Il modulo Rust/SQLite deve avere comandi Tauri univoci con il prefisso studio_sql_.');
  }

  const newline = existingLibrary.includes('\r\n') ? '\r\n' : '\n';
  const lines = existingLibrary.split(/\r?\n/);
  const uniqueLine = (text: string) => {
    const indices = lines.flatMap((line, index) => line.trim() === text ? [index] : []);
    if (indices.length !== 1) throw new Error(`Punto di integrazione Rust/Tauri non riconosciuto: ${text}`);
    return indices[0];
  };
  const handlerStart = uniqueLine('// @studio-tauri-handlers:start');
  const handlerEnd = uniqueLine('// @studio-tauri-handlers:end');
  if (handlerStart >= handlerEnd || !lines[handlerStart - 1]?.includes('.invoke_handler(tauri::generate_handler![')
      || lines[handlerEnd + 1]?.trim() !== '])') {
    throw new Error('La registrazione dei comandi Tauri è stata modificata e richiede integrazione manuale.');
  }

  const modLine = 'mod studio_sql;';
  const setupLines = [
    '        .setup(|app| {',
    '            let db_path = tauri::Manager::path(app).app_data_dir()?.join("studio_sql.sqlite");',
    '            let sql_state = studio_sql::AppDbState::open_and_migrate(&db_path)?;',
    '            tauri::Manager::manage(app, sql_state);',
    '            Ok(())',
    '        })',
  ];

  const installedHandlers = lines.slice(handlerStart + 1, handlerEnd)
    .filter((line) => line.trim().startsWith('studio_sql::'));
  const handlers = commands.map((command) => `${lines[handlerStart].match(/^\s*/)?.[0] ?? ''}studio_sql::${command},`);
  if (lines.some((line) => line.trim() === modLine) || installedHandlers.length > 0) {
    const installedSetup = setupLines.join(newline);
    if (!lines.includes(modLine) || !existingLibrary.includes(installedSetup) || installedHandlers.join('\n') !== handlers.join('\n')) {
      throw new Error('Il progetto contiene già una diversa integrazione Rust/SQLite. I sorgenti sono stati conservati.');
    }
    return { files, library: existingLibrary };
  }

  if (/\.\s*setup\s*\(/.test(existingLibrary) || existingLibrary.includes('studio_sql::') || lines.slice(handlerStart + 1, handlerEnd)
    .some((line) => /^\s*[\w:]*studio_sql_\w+\s*,?\s*$/.test(line))) {
    throw new Error('Il progetto usa già un avvio Tauri personalizzato o comandi SQLite riservati.');
  }

  const hasModuleMarker = lines.some((line) => line.trim() === RUST_TAURI_SQL_MODULE_MARKER);
  const hasSetupMarker = lines.some((line) => line.trim() === RUST_TAURI_SQL_SETUP_MARKER);
  if (hasModuleMarker !== hasSetupMarker) throw new Error('Manca un marcatore di integrazione Rust/SQLite.');

  const moduleIndex = hasModuleMarker ? uniqueLine(RUST_TAURI_SQL_MODULE_MARKER) : uniqueLine('pub mod models;');
  const builderIndex = uniqueLine('.manage(db_state)');
  const setupIndex = hasSetupMarker ? uniqueLine(RUST_TAURI_SQL_SETUP_MARKER) : builderIndex;
  if (moduleIndex >= builderIndex || setupIndex !== builderIndex + Number(hasSetupMarker) || setupIndex >= handlerStart) {
    throw new Error('Struttura di lib.rs incompatibile con l’installazione automatica.');
  }

  lines.splice(handlerEnd, 0, ...handlers);
  lines.splice(setupIndex + 1, 0, ...setupLines);
  lines.splice(moduleIndex + 1, 0, modLine);
  return { files, library: lines.join(newline) };
}
