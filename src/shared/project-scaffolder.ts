import {
  getProjectStackDescriptor,
  resolveDefaultAutomationsPath,
  type DiskProjectInitSpec,
  type PrimaryCodeLanguage,
  type ProjectStackId,
  type PythonCompanionKind,
} from './project-stacks';
import type { CodegenTargetId, StylingDialect } from './ui-ir';
import { RUST_TAURI_SQL_MODULE_MARKER, RUST_TAURI_SQL_SETUP_MARKER } from './rust-tauri-sql-install';
import { WIZARD_PALETTE_PRESETS, type WizardPaletteId } from './wizard-templates';

/**
 * Deterministic 11-Stack Real Disk Project Scaffolder (v3.0).
 *
 * Pure TypeScript with zero Node.js imports so it runs identically in Electron Main,
 * Utility Workers, Browser Fallback Mode (`tsconfig.web.json`), and Vitest suites.
 */

export interface ScaffoldGeneratedFile {
  relativePath: string;
  content: string;
  binaryData?: Uint8Array;
  isBinary?: boolean;
}

export interface ScaffoldTaskCommandSpec {
  label: string;
  cmd: string;
  args: string[];
  cwdRel?: string;
}

export interface DiskProjectScaffoldBundle {
  slug: string;
  crateSnakeName: string;
  projectName: string;
  stackId: ProjectStackId;
  codegenTargetId: CodegenTargetId;
  primaryLanguage: PrimaryCodeLanguage;
  pythonCompanion: PythonCompanionKind;
  stylingPreset: StylingDialect;
  entryUiRelPath: string;
  automationsRelPath: string;
  devCommand: {
    cmd: string;
    args: string[];
    port: number;
    label: string;
  };
  initSteps: ScaffoldTaskCommandSpec[];
  files: ScaffoldGeneratedFile[];
}

export function slugifyProjectName(rawName: string): string {
  const clean = (rawName || 'studio-app')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = clean.slice(0, 100).replace(/-+$/g, '') || 'studio-app';
  return /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(slug) ? `studio-${slug}` : slug;
}

function escapeMarkupText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/`/g, '&#96;')
    .replace(/\$/g, '&#36;');
}

function toRustSnakeIdentifier(slug: string): string {
  const base = slug.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'studio_app';
  return /^[0-9]/.test(base) ? `app_${base}` : base;
}

// ============================================================================
// PURE-TS VALID RGBA PNG & WINDOWS ICO GENERATOR (FOR TAURI CARGO CHECK)
// ============================================================================

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Bytes(chunks: Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const buf of chunks) {
    for (let i = 0; i < buf.length; i++) {
      crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32Bytes(data: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function writeUint32BE(out: Uint8Array, offset: number, val: number): void {
  out[offset] = (val >>> 24) & 0xff;
  out[offset + 1] = (val >>> 16) & 0xff;
  out[offset + 2] = (val >>> 8) & 0xff;
  out[offset + 3] = val & 0xff;
}

function makePngChunk(typeAscii: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = typeAscii.charCodeAt(i) & 0xff;
  const out = new Uint8Array(4 + 4 + data.length + 4);
  writeUint32BE(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crc = crc32Bytes([typeBytes, data]);
  writeUint32BE(out, 8 + data.length, crc);
  return out;
}

/**
 * Generates a 100% spec-compliant 8-bit RGBA (`colorType = 6`) PNG image
 * with gradient brand fill so `tauri_build::build()` passes icon validation.
 */
export function createValidRgbaPngBytes(
  width = 32,
  height = 32,
  primaryRgb: [number, number, number] = [59, 130, 246],
): Uint8Array {
  const rowStride = 1 + width * 4;
  const raw = new Uint8Array(height * rowStride);
  const [pr, pg, pb] = primaryRgb;

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride;
    raw[rowStart] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const t = (x + y) / Math.max(1, width + height - 2);
      raw[px] = Math.round(pr * (1 - t * 0.35) + 139 * (t * 0.35));
      raw[px + 1] = Math.round(pg * (1 - t * 0.35) + 92 * (t * 0.35));
      raw[px + 2] = Math.round(pb * (1 - t * 0.15) + 246 * (t * 0.15));
      raw[px + 3] = 255; // Opaque alpha channel (RGBA)
    }
  }

  // Wrap raw scanlines in RFC 1950 zlib + RFC 1951 stored DEFLATE blocks (<= 32768 bytes each)
  const maxBlock = 32768;
  const blockCount = Math.max(1, Math.ceil(raw.length / maxBlock));
  const zlibOut = new Uint8Array(2 + blockCount * 5 + raw.length + 4);
  zlibOut[0] = 0x78;
  zlibOut[1] = 0x01;
  let zOff = 2;

  for (let b = 0; b < blockCount; b++) {
    const start = b * maxBlock;
    const end = Math.min(raw.length, start + maxBlock);
    const len = end - start;
    const isFinal = b === blockCount - 1 ? 1 : 0;
    const nlen = (~len) & 0xffff;
    zlibOut[zOff++] = isFinal;
    zlibOut[zOff++] = len & 0xff;
    zlibOut[zOff++] = (len >>> 8) & 0xff;
    zlibOut[zOff++] = nlen & 0xff;
    zlibOut[zOff++] = (nlen >>> 8) & 0xff;
    zlibOut.set(raw.subarray(start, end), zOff);
    zOff += len;
  }

  const adler = adler32Bytes(raw);
  writeUint32BE(zlibOut, zOff, adler);

  const pngSig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', zlibOut);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const full = new Uint8Array(
    pngSig.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let pos = 0;
  full.set(pngSig, pos);
  pos += pngSig.length;
  full.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  full.set(idatChunk, pos);
  pos += idatChunk.length;
  full.set(iendChunk, pos);
  return full;
}

/**
 * Wraps a 32x32 RGBA PNG payload into a valid Windows `.ico` container.
 */
export function createValidRgbaIcoBytes(png32Bytes: Uint8Array): Uint8Array {
  const ico = new Uint8Array(6 + 16 + png32Bytes.length);
  // ICONDIR: reserved=0, type=1 (ICO), count=1
  ico[0] = 0;
  ico[1] = 0;
  ico[2] = 1;
  ico[3] = 0;
  ico[4] = 1;
  ico[5] = 0;

  // ICONDIRENTRY (16 bytes)
  ico[6] = 32; // width
  ico[7] = 32; // height
  ico[8] = 0; // palette colors
  ico[9] = 0; // reserved
  ico[10] = 1; // color planes LE
  ico[11] = 0;
  ico[12] = 32; // 32 bpp RGBA LE
  ico[13] = 0;

  const size = png32Bytes.length;
  ico[14] = size & 0xff;
  ico[15] = (size >>> 8) & 0xff;
  ico[16] = (size >>> 16) & 0xff;
  ico[17] = (size >>> 24) & 0xff;

  const offset = 22;
  ico[18] = offset & 0xff;
  ico[19] = 0;
  ico[20] = 0;
  ico[21] = 0;

  ico.set(png32Bytes, offset);
  return ico;
}

// ============================================================================
// SHARED STYLESHEET, GITIGNORE, AUTOMATIONS & PYTHON COMPANION HELPERS
// ============================================================================

function buildBaseStylesheet(projectName: string, paletteId: WizardPaletteId = 'dark-pro', isDark = true): string {
  const pal = WIZARD_PALETTE_PRESETS.find((p) => p.id === paletteId) ?? WIZARD_PALETTE_PRESETS[0];
  const bg = isDark ? pal.colors.canvasDark : pal.colors.canvasLight;
  const surface = isDark ? pal.colors.surfaceDark : pal.colors.surfaceLight;
  const fg = isDark ? '#f8fafc' : '#0f172a';
  const muted = isDark ? '#94a3b8' : '#475569';
  const border = isDark ? '#1e293b' : '#cbd5e1';

  return `/* ${projectName.replace(/\*\//g, '* /')} — Visual UI Studio Design Tokens & Layout Styles */
:root {
  --color-bg-canvas: ${bg};
  --color-bg-surface: ${surface};
  --color-text-primary: ${fg};
  --color-text-secondary: ${muted};
  --color-border-subtle: ${border};
  --color-primary-500: ${pal.colors.primary500};
  --color-primary-600: ${pal.colors.primary600};
  --color-accent-500: ${pal.colors.accent500};
  --radius-card: 14px;
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--color-bg-canvas);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  line-height: 1.5;
}

.studio-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.studio-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-card);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}

.studio-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.studio-input {
  flex: 1;
  min-width: 200px;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-canvas);
  color: var(--color-text-primary);
  font-size: 14px;
}

.studio-btn {
  height: 40px;
  padding: 0 18px;
  border-radius: 9px;
  border: none;
  background: var(--color-primary-500);
  color: #ffffff;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
}

.studio-btn:hover {
  background: var(--color-primary-600);
  transform: translateY(-1px);
}
`;
}

function buildAutomationsScript(projectName: string, lang: 'javascript' | 'typescript', autoBind = false): string {
  if (lang === 'typescript') {
    return `/**
 * ${projectName.replace(/\*\//g, '* /')} — External UI Logic & No-Code Automations Module (TypeScript)
 * Managed regions (@studio-automation) are updated non-destructively by Visual UI Studio.
 */

export interface ActionFeedback {
  ok: boolean;
  message: string;
  timestamp: number;
}

// @studio-automation:start id="auto_primary_cta" checksum="v3seed"
export async function onPrimaryActionClick(inputValue = ''): Promise<ActionFeedback> {
  const label = inputValue.trim() || 'Elemento Standard';
  const statusEl = typeof document !== 'undefined' ? document.querySelector('#studio-status-banner') : null;
  if (statusEl) {
    statusEl.textContent = \`✓ Azione completata per: \${label}\`;
  }
  return {
    ok: true,
    message: \`Operazione eseguita su "\${label}"\`,
    timestamp: Date.now(),
  };
}
// @studio-automation:end id="auto_primary_cta"

export function formatStudioTimestamp(ts: number = Date.now()): string {
  return new Date(ts).toLocaleTimeString('it-IT');
}
`;
  }

  return `/**
 * ${projectName.replace(/\*\//g, '* /')} — External UI Logic & No-Code Automations Module (ES2024 JavaScript)
 * Managed regions (@studio-automation) are updated non-destructively by Visual UI Studio.
 */

// @studio-automation:start id="auto_primary_cta" checksum="v3seed"
export async function onPrimaryActionClick(inputValue = '') {
  const label = String(inputValue || '').trim() || 'Elemento Standard';
  const statusEl = typeof document !== 'undefined' ? document.querySelector('#studio-status-banner') : null;
  if (statusEl) {
    statusEl.textContent = \`✓ Azione completata per: \${label}\`;
  }
  return {
    ok: true,
    message: \`Operazione eseguita su "\${label}"\`,
    timestamp: Date.now(),
  };
}
// @studio-automation:end id="auto_primary_cta"
${autoBind ? `
export function initDomAutomations() {
  if (typeof document === 'undefined') return;
  const btn = document.querySelector('#btn-primary-action');
  const inp = document.querySelector('#inp-record-title');
  if (btn && !btn.hasAttribute('data-studio-bound')) {
    btn.setAttribute('data-studio-bound', 'true');
    btn.addEventListener('click', () => {
      const val = inp && 'value' in inp ? inp.value : '';
      void onPrimaryActionClick(val);
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomAutomations);
  } else {
    initDomAutomations();
  }
}` : ''}
`;
}

function buildStandardGitignore(): string {
  return `node_modules/
dist/
out/
build/
.next/
.angular/
.svelte-kit/
.expo/
target/
.venv/
venv/
__pycache__/
*.pyc
.env
.env.local
.uistudio/*.sqlite-wal
.uistudio/*.sqlite-shm
.uistudio/*.uistudio-wal
.uistudio/*.uistudio-shm
`;
}

function buildPythonCompanionFiles(
  projectName: string,
  slug: string,
  kind: Exclude<PythonCompanionKind, 'none'>,
  atRoot = false,
): ScaffoldGeneratedFile[] {
  const prefix = atRoot ? '' : 'backend/';
  const automationsPy = `"""Python Business Logic & No-Code Automations"""
from datetime import datetime


# @studio-automation:start id="auto_py_process" checksum="v3py"
def process_domain_item(title: str) -> dict:
    clean = (title or "Record").strip() or "Record"
    return {
        "ok": True,
        "title": clean,
        "processed_at": datetime.now().isoformat(timespec="seconds"),
    }
# @studio-automation:end id="auto_py_process"
`;

  if (kind === 'flask') {
    const mainPy = `from html import escape
from flask import Flask, jsonify, request, send_from_directory
from ${atRoot ? 'automations' : 'backend.automations'} import process_domain_item

app = Flask(__name__, static_folder="${atRoot ? 'public' : '../public'}", static_url_path="")

ITEMS = [
    {"id": 1, "title": "Modulo Iniziale", "status": "attivo"},
    {"id": 2, "title": "Sincronizzazione SQL", "status": "pronto"},
]


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "${slug}", "engine": "flask"})


@app.get("/api/items")
def list_items():
    return jsonify({"items": ITEMS})


@app.post("/api/items")
def add_item():
    payload = request.get_json(silent=True) or request.form or {}
    title = str(payload.get("title", "Nuovo Elemento")).strip() or "Nuovo Elemento"
    item = {"id": len(ITEMS) + 1, "title": title, "status": "nuovo"}
    ITEMS.append(item)
    return jsonify({"ok": True, "item": item, "automation": process_domain_item(title)})


@app.get("/hx/stats")
def hx_stats():
    return f"<span>Totale record attivi: <strong>{len(ITEMS)}</strong></span>"


@app.post("/hx/items")
def hx_add_item():
    title = (request.form.get("title") or "Nuovo Record").strip()
    ITEMS.append({"id": len(ITEMS) + 1, "title": title, "status": "nuovo"})
    rows = "".join(f"<li><strong>#{it['id']}</strong> — {escape(it['title'])} ({it['status']})</li>" for it in ITEMS)
    return f"<ul>{rows}</ul>"


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
`;
    return [
      { relativePath: `${prefix}main.py`, content: mainPy },
      { relativePath: `${prefix}automations.py`, content: automationsPy },
      ...(atRoot ? [] : [{ relativePath: 'backend/__init__.py', content: '' }]),
      {
        relativePath: 'requirements.txt',
        content: 'flask>=3.1.0\n',
      },
      {
        relativePath: 'pyproject.toml',
        content: `[project]\nname = "${slug}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = ["flask>=3.1.0"]\n`,
      },
    ];
  }

  if (kind === 'scripts') {
    const scriptPy = `"""Standalone Python Automation Runner"""
from automations import process_domain_item


def main() -> None:
    res = process_domain_item(${JSON.stringify(projectName)})
    print(f"[Python Companion] {res}")


if __name__ == "__main__":
    main()
`;
    return [
      { relativePath: `${prefix}main.py`, content: scriptPy },
      { relativePath: `${prefix}automations.py`, content: automationsPy },
      {
        relativePath: 'pyproject.toml',
        content: `[project]\nname = "${slug}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n`,
      },
    ];
  }

  // Default: FastAPI
  const fastApiPy = `from html import escape
from pathlib import Path
from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from backend.automations import process_domain_item
except ImportError:
    from automations import process_domain_item

app = FastAPI(title=${JSON.stringify(projectName + ' API')}, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ITEMS: list[dict] = [
    {"id": 1, "title": "Architettura FastAPI Pronta", "status": "attivo"},
    {"id": 2, "title": "Automazione Visuale Collegata", "status": "attivo"},
]


class CreateItemPayload(BaseModel):
    title: str


@app.get("/api/health")
def api_health() -> dict:
    return {"ok": True, "service": "${slug}", "engine": "fastapi", "count": len(ITEMS)}


@app.get("/api/items")
def api_list_items() -> dict:
    return {"items": ITEMS}


@app.post("/api/items")
def api_create_item(body: CreateItemPayload) -> dict:
    item = {"id": len(ITEMS) + 1, "title": body.title.strip() or "Elemento", "status": "nuovo"}
    ITEMS.append(item)
    return {"ok": True, "item": item, "automation": process_domain_item(item["title"])}


@app.get("/hx/stats", response_class=HTMLResponse)
def hx_stats() -> str:
    return f"<span> Elementi attivi sul server Python: <strong>{len(ITEMS)}</strong></span>"


@app.post("/hx/items", response_class=HTMLResponse)
def hx_create_item(title: str = Form("Nuovo Elemento")) -> str:
    clean = title.strip() or "Nuovo Elemento"
    ITEMS.append({"id": len(ITEMS) + 1, "title": clean, "status": "inserito"})
    lis = "".join(
        f"<li class='hx-item'><strong>#{row['id']}</strong> {escape(row['title'])} <em>({row['status']})</em></li>"
        for row in ITEMS
    )
    return f"<ul class='hx-list'>{lis}</ul>"


PUBLIC_DIR = Path(__file__).resolve().parent${atRoot ? '' : '.parent'} / "public"
if PUBLIC_DIR.exists():
    @app.get("/")
    def serve_index():
        return FileResponse(PUBLIC_DIR / "index.html")

    app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="public")
`;

  return [
    { relativePath: `${prefix}main.py`, content: fastApiPy },
    { relativePath: `${prefix}automations.py`, content: automationsPy },
    ...(atRoot ? [] : [{ relativePath: 'backend/__init__.py', content: '' }]),
    {
      relativePath: 'requirements.txt',
      content: 'fastapi>=0.115.0\nuvicorn[standard]>=0.34.0\npython-multipart>=0.0.20\njinja2>=3.1.5\n',
    },
    {
      relativePath: 'pyproject.toml',
      content: `[project]
name = "${slug}"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.34.0",
  "python-multipart>=0.0.20",
  "jinja2>=3.1.5",
]
`,
    },
  ];
}

// ============================================================================
// MAIN 11-STACK SCAFFOLDER ENTRY POINT
// ============================================================================

export function buildDiskProjectScaffold(spec: DiskProjectInitSpec): DiskProjectScaffoldBundle {
  const stackMeta = getProjectStackDescriptor(spec.stackId);
  const projectName = (spec.name || 'Studio App').trim() || 'Studio App';
  const markupName = escapeMarkupText(projectName);
  const slug = slugifyProjectName(projectName);
  const crateSnakeName = toRustSnakeIdentifier(slug);

  const primaryLanguage: PrimaryCodeLanguage = stackMeta.supportedLanguages.includes(spec.primaryLanguage)
    ? spec.primaryLanguage
    : stackMeta.defaultLanguage;

  const pythonCompanion: PythonCompanionKind =
    primaryLanguage === 'python'
      ? spec.pythonCompanion === 'flask' ? 'flask' : 'fastapi'
      : spec.pythonCompanion ?? 'none';

  const stylingPreset: StylingDialect = spec.stylingPreset ?? stackMeta.defaultDialect;
  const paletteId: WizardPaletteId = spec.paletteId ?? 'dark-pro';
  const isDark = (spec.defaultThemeMode ?? 'dark') !== 'light';
  const isTs = primaryLanguage === 'typescript';
  const scriptExt = isTs ? 'ts' : 'js';
  const jsxExt = isTs ? 'tsx' : 'jsx';

  const baseCss = buildBaseStylesheet(projectName, paletteId, isDark);
  const autoCode = buildAutomationsScript(projectName, isTs ? 'typescript' : 'javascript');
  const automationsRelPath = resolveDefaultAutomationsPath(spec.stackId, primaryLanguage);
  const automationRuntimeImports = isTs
    ? "import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n"
    : '';
  const automationRuntimeRoute = isTs ? `app.get('/scripts/automations.js', (_req, res) => {
  const source = readFileSync(join(process.cwd(), 'public/scripts/automations.ts'), 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: 'automations.ts',
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  if (transpiled.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    res.status(500).send('Errore di sintassi in automations.ts');
    return;
  }
  res.type('text/javascript').set('Cache-Control', 'no-store').send(transpiled.outputText);
});
` : '';

  const files: ScaffoldGeneratedFile[] = [
    { relativePath: '.gitignore', content: buildStandardGitignore() },
  ];

  let entryUiRelPath = 'index.html';
  let devCommand = {
    cmd: 'npm',
    args: ['run', 'dev'],
    port: stackMeta.defaultDevPort,
    label: stackMeta.devCommandLabel,
  };
  const initSteps: ScaffoldTaskCommandSpec[] = [];

  const viteApiProxySnippet =
    pythonCompanion !== 'none'
      ? `\n    proxy: {\n      '/api': 'http://127.0.0.1:8000',\n      '/hx': 'http://127.0.0.1:8000',\n    },`
      : '';

  switch (spec.stackId) {
    // ========================================================================
    // 1. HTML5 + CSS3 + JS / TS
    // ========================================================================
    case 'html-css-js': {
      entryUiRelPath = 'index.html';
      if (!isTs) {
        files.push(
          {
            relativePath: 'package.json',
            content: JSON.stringify(
              {
                name: slug,
                version: '0.1.0',
                private: true,
                type: 'module',
                scripts: {
                  dev: 'node scripts/dev-server.mjs',
                  start: 'node scripts/dev-server.mjs',
                },
              },
              null,
              2,
            ),
          },
          { relativePath: 'styles/main.css', content: baseCss },
          { relativePath: 'styles/theme-and-sheet.css', content: baseCss },
          { relativePath: 'scripts/automations.js', content: buildAutomationsScript(projectName, 'javascript', true) },
          {
            relativePath: 'scripts/dev-server.mjs',
            content: `import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const PORT = Number(process.env.PORT || 5173);
const ROOT = realpathSync(process.cwd());
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, stack: 'html-css-js' }));
    return;
  }
  const target = resolve(ROOT, urlPath === '/' ? 'index.html' : urlPath.replace(/^\\/+/, ''));
  const topLevel = target.slice(ROOT.length + 1).split(sep)[0];
  if (target.startsWith(ROOT + sep) && (topLevel === 'index.html' || topLevel === 'styles' || topLevel === 'scripts') && existsSync(target) && realpathSync(target).startsWith(ROOT + sep) && statSync(target).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' });
    res.end(readFileSync(target));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(\`Server attivo su http://127.0.0.1:\${server.address().port}\`);
});
`,
          },
          {
            relativePath: 'index.html',
            content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName}</title>
    <link rel="stylesheet" href="./styles/main.css" />
  </head>
  <body>
    <main class="studio-shell">
      <section class="studio-card">
        <h1>${markupName}</h1>
        <p id="studio-status-banner">Applicazione Web Standard HTML5 + CSS3 + ES Modules pronta.</p>
        <div class="studio-row">
          <input id="inp-record-title" class="studio-input" placeholder="Inserisci voce operativa..." />
          <button id="btn-primary-action" class="studio-btn" type="button">Esegui Azione</button>
        </div>
      </section>
    </main>
    <script type="module" src="./scripts/automations.js"></script>
  </body>
</html>
`,
          },
        );
        devCommand = {
          cmd: 'node',
          args: ['scripts/dev-server.mjs'],
          port: 5173,
          label: 'node scripts/dev-server.mjs',
        };
      } else {
        files.push(
          {
            relativePath: 'package.json',
            content: JSON.stringify(
              {
                name: slug,
                version: '0.1.0',
                private: true,
                type: 'module',
                scripts: {
                  dev: 'vite --port 5173',
                  build: 'tsc --noEmit && vite build',
                  preview: 'vite preview',
                },
                devDependencies: {
                  typescript: '^5.8.2',
                  vite: '^6.2.0',
                },
              },
              null,
              2,
            ),
          },
          {
            relativePath: 'tsconfig.json',
            content: JSON.stringify(
              {
                compilerOptions: {
                  target: 'ES2022',
                  module: 'ESNext',
                  moduleResolution: 'bundler',
                  strict: true,
                  noEmit: true,
                  skipLibCheck: true,
                },
                include: ['src', 'scripts'],
              },
              null,
              2,
            ),
          },
          {
            relativePath: 'vite.config.ts',
            content: `import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  server: { port: 5173,${viteApiProxySnippet} },\n});\n`,
          },
          { relativePath: 'styles/main.css', content: baseCss },
          { relativePath: 'scripts/automations.ts', content: autoCode },
          {
            relativePath: 'src/main.ts',
            content: `import '../styles/main.css';
import { onPrimaryActionClick } from '../scripts/automations';

const btn = document.querySelector<HTMLButtonElement>('#btn-primary-action');
const inp = document.querySelector<HTMLInputElement>('#inp-record-title');
btn?.addEventListener('click', () => {
  void onPrimaryActionClick(inp?.value ?? '');
});
`,
          },
          {
            relativePath: 'index.html',
            content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName}</title>
  </head>
  <body>
    <main class="studio-shell">
      <section class="studio-card">
        <h1>${markupName}</h1>
        <p id="studio-status-banner">HTML5 + CSS3 + TypeScript pronto.</p>
        <div class="studio-row">
          <input id="inp-record-title" class="studio-input" placeholder="Inserisci voce..." />
          <button id="btn-primary-action" class="studio-btn" type="button">Esegui Azione</button>
        </div>
      </section>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
          },
        );
        initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      }
      break;
    }

    // ========================================================================
    // 2. REACT 19 (VITE 6 — JSX or TSX)
    // ========================================================================
    case 'react': {
      entryUiRelPath = `src/App.${jsxExt}`;
      const pkg = {
        name: slug,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 5173',
          build: isTs ? 'tsc -b && vite build' : 'vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.3.4',
          vite: '^6.2.0',
          ...(isTs
            ? {
                '@types/react': '^19.0.8',
                '@types/react-dom': '^19.0.3',
                typescript: '^5.8.2',
              }
            : {}),
        },
      };

      files.push(
        { relativePath: 'package.json', content: JSON.stringify(pkg, null, 2) },
        {
          relativePath: `vite.config.${scriptExt}`,
          content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173,${viteApiProxySnippet} },
});
`,
        },
        isTs
          ? {
              relativePath: 'tsconfig.json',
              content: JSON.stringify(
                {
                  compilerOptions: {
                    target: 'ES2022',
                    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    jsx: 'react-jsx',
                    strict: true,
                    noEmit: true,
                    skipLibCheck: true,
                  },
                  include: ['src'],
                },
                null,
                2,
              ),
            }
          : {
              relativePath: 'jsconfig.json',
              content: JSON.stringify(
                {
                  compilerOptions: { jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'bundler' },
                  include: ['src'],
                },
                null,
                2,
              ),
            },
        {
          relativePath: 'index.html',
          content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${jsxExt}"></script>
  </body>
</html>
`,
        },
        { relativePath: 'src/styles/theme-and-sheet.css', content: baseCss },
        { relativePath: `src/scripts/automations.${scriptExt}`, content: autoCode },
        {
          relativePath: `src/main.${jsxExt}`,
          content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme-and-sheet.css';
import App from './App';

createRoot(document.getElementById('root')${isTs ? '!' : ''}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
        },
        {
          relativePath: `src/App.${jsxExt}`,
          content: `import React, { useState } from 'react';
import { onPrimaryActionClick } from './scripts/automations';

export default function App() {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('React 19 + Vite 6 pronto per il Canvas Visuale.');

  const handleAction = async () => {
    const res = await onPrimaryActionClick(title);
    setStatus(res.message);
  };

  return (
    <main className="studio-shell">
      <section className="studio-card">
        <h1>${markupName}</h1>
        <p id="studio-status-banner">{status}</p>
        <div className="studio-row">
          <input
            id="inp-record-title"
            className="studio-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Inserisci elemento..."
          />
          <button id="btn-primary-action" type="button" className="studio-btn" onClick={handleAction}>
            Esegui Automazione
          </button>
        </div>
      </section>
    </main>
  );
}
`,
        },
      );
      initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      break;
    }

    // ========================================================================
    // 3. ANGULAR 19 STANDALONE
    // ========================================================================
    case 'angular': {
      entryUiRelPath = 'src/app/app.component.html';
      const angularJson = {
        $schema: './node_modules/@angular/cli/lib/config/schema.json',
        version: 1,
        newProjectRoot: 'projects',
        projects: {
          [slug]: {
            projectType: 'application',
            root: '',
            sourceRoot: 'src',
            prefix: 'app',
            architect: {
              build: {
                builder: '@angular-devkit/build-angular:application',
                options: {
                  outputPath: `dist/${slug}`,
                  index: 'src/index.html',
                  browser: 'src/main.ts',
                  tsConfig: 'tsconfig.app.json',
                  styles: ['src/styles.css'],
                  scripts: [],
                },
              },
              serve: {
                builder: '@angular-devkit/build-angular:dev-server',
                options: {
                  buildTarget: `${slug}:build`,
                  port: 4200,
                  ...(pythonCompanion !== 'none' ? { proxyConfig: 'proxy.conf.json' } : {}),
                },
              },
            },
          },
        },
      };

      files.push(
        { relativePath: 'angular.json', content: JSON.stringify(angularJson, null, 2) },
        {
          relativePath: 'package.json',
          content: JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              scripts: {
                ng: 'ng',
                dev: 'ng serve --port 4200',
                start: 'ng serve --port 4200',
                build: 'ng build',
              },
              dependencies: {
                '@angular/common': '^19.2.0',
                '@angular/compiler': '^19.2.0',
                '@angular/core': '^19.2.0',
                '@angular/forms': '^19.2.0',
                '@angular/platform-browser': '^19.2.0',
                '@angular/router': '^19.2.0',
                rxjs: '~7.8.0',
                tslib: '^2.8.0',
                'zone.js': '~0.15.0',
              },
              devDependencies: {
                '@angular-devkit/build-angular': '^19.2.0',
                '@angular/cli': '^19.2.0',
                '@angular/compiler-cli': '^19.2.0',
                typescript: '~5.7.2',
              },
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'tsconfig.json',
          content: JSON.stringify(
            {
              compileOnSave: false,
              compilerOptions: {
                strict: true,
                skipLibCheck: true,
                esModuleInterop: true,
                experimentalDecorators: true,
                moduleResolution: 'bundler',
                target: 'ES2022',
                module: 'ES2022',
              },
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'tsconfig.app.json',
          content: JSON.stringify(
            {
              extends: './tsconfig.json',
              compilerOptions: { outDir: './out-tsc/app', types: [] },
              files: ['src/main.ts'],
              include: ['src/**/*.d.ts'],
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'src/index.html',
          content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>${markupName}</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
`,
        },
        { relativePath: 'src/styles.css', content: baseCss },
        { relativePath: 'src/scripts/automations.ts', content: autoCode },
        {
          relativePath: 'src/app/app.config.ts',
          content: `import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [provideZoneChangeDetection({ eventCoalescing: true })],
};
`,
        },
        {
          relativePath: 'src/main.ts',
          content: `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
`,
        },
        {
          relativePath: 'src/app/app.component.ts',
          content: `import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { onPrimaryActionClick } from '../scripts/automations';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = ${JSON.stringify(projectName)};
  recordInput = signal('');
  statusBanner = signal('Angular 19 Standalone + Signals pronto.');

  async runPrimaryAutomation(): Promise<void> {
    const res = await onPrimaryActionClick(this.recordInput());
    this.statusBanner.set(res.message);
  }
}
`,
        },
        {
          relativePath: 'src/app/app.component.html',
          content: `<main class="studio-shell">
  <section class="studio-card">
    <h1>{{ title }}</h1>
    <p id="studio-status-banner">{{ statusBanner() }}</p>
    @if (statusBanner()) {
      <div class="studio-row">
        <input
          id="inp-record-title"
          class="studio-input"
          placeholder="Nuovo record Angular..."
          [ngModel]="recordInput()"
          (ngModelChange)="recordInput.set($event)"
        />
        <button id="btn-primary-action" type="button" class="studio-btn" (click)="runPrimaryAutomation()">
          Esegui Azione
        </button>
      </div>
    }
  </section>
</main>
`,
        },
        {
          relativePath: 'src/app/app.component.css',
          content: `:host { display: block; }\n`,
        },
      );
      if (pythonCompanion !== 'none') {
        files.push({
          relativePath: 'proxy.conf.json',
          content: JSON.stringify(
            { '/api': { target: 'http://127.0.0.1:8000', secure: false } },
            null,
            2,
          ),
        });
      }
      devCommand = {
        cmd: 'npx',
        args: ['ng', 'serve', '--port', '4200'],
        port: 4200,
        label: 'npx ng serve --port 4200',
      };
      initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      break;
    }

    // ========================================================================
    // 4. SVELTE 5 RUNES + VITE 6 (JS or TS)
    // ========================================================================
    case 'svelte': {
      entryUiRelPath = 'src/App.svelte';
      files.push(
        {
          relativePath: 'package.json',
          content: JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              type: 'module',
              scripts: {
                dev: 'vite --port 5173',
                build: 'vite build',
                preview: 'vite preview',
              },
              devDependencies: {
                '@sveltejs/vite-plugin-svelte': '^5.0.0',
                svelte: '^5.20.0',
                vite: '^6.2.0',
                ...(isTs ? { typescript: '^5.8.2', 'svelte-check': '^4.1.4' } : {}),
              },
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'svelte.config.js',
          content: `import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';\n\nexport default {\n  preprocess: vitePreprocess(),\n};\n`,
        },
        {
          relativePath: `vite.config.${scriptExt}`,
          content: `import { defineConfig } from 'vite';\nimport { svelte } from '@sveltejs/vite-plugin-svelte';\n\nexport default defineConfig({\n  plugins: [svelte()],\n  server: { port: 5173,${viteApiProxySnippet} },\n});\n`,
        },
        ...(isTs
          ? [
              {
                relativePath: 'tsconfig.json',
                content: JSON.stringify(
                  {
                    compilerOptions: {
                      target: 'ES2022',
                      module: 'ESNext',
                      moduleResolution: 'bundler',
                      strict: true,
                      checkJs: true,
                      skipLibCheck: true,
                    },
                    include: ['src/**/*.ts', 'src/**/*.js', 'src/**/*.svelte'],
                  },
                  null,
                  2,
                ),
              },
            ]
          : []),
        {
          relativePath: 'index.html',
          content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.${scriptExt}"></script>
  </body>
</html>
`,
        },
        { relativePath: 'src/styles/theme-and-sheet.css', content: baseCss },
        { relativePath: `src/scripts/automations.${scriptExt}`, content: autoCode },
        {
          relativePath: `src/main.${scriptExt}`,
          content: `import { mount } from 'svelte';
import './styles/theme-and-sheet.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')${isTs ? '!' : ''},
});

export default app;
`,
        },
        {
          relativePath: 'src/App.svelte',
          content: `<script${isTs ? ' lang="ts"' : ''}>
  import { onPrimaryActionClick } from './scripts/automations';

  let recordTitle = $state('');
  let statusMessage = $state('Svelte 5 Runes ($state) attivo e sincronizzato.');

  async function handleRun() {
    const res = await onPrimaryActionClick(recordTitle);
    statusMessage = res.message;
  }
</script>

<main class="studio-shell">
  <section class="studio-card">
    <h1>${markupName}</h1>
    {#if statusMessage}
      <p id="studio-status-banner">{statusMessage}</p>
    {/if}
    <div class="studio-row">
      <input
        id="inp-record-title"
        class="studio-input"
        bind:value={recordTitle}
        placeholder="Titolo elemento Svelte 5..."
      />
      <button id="btn-primary-action" type="button" class="studio-btn" onclick={handleRun}>
        Esegui Azione
      </button>
    </div>
  </section>
</main>
`,
        },
      );
      initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      break;
    }

    // ========================================================================
    // 5. HTMX 2.x HYPERMEDIA (NODE SERVER.JS/TS OR PYTHON FASTAPI/FLASK)
    // ========================================================================
    case 'htmx': {
      entryUiRelPath = 'public/index.html';
      const htmxAutoExt = primaryLanguage === 'typescript' ? 'ts' : 'js';
      files.push(
        { relativePath: 'public/styles/theme-and-sheet.css', content: baseCss },
        {
          relativePath: `public/scripts/automations.${htmxAutoExt}`,
          content: buildAutomationsScript(projectName, htmxAutoExt === 'ts' ? 'typescript' : 'javascript', !isTs),
        },
        {
          relativePath: 'public/partials/items-list.html',
          content: `<ul class="hx-list">
  <li class="hx-item"><strong>#1</strong> Elemento Iniziale Hypermedia <em>(pronto)</em></li>
</ul>
`,
        },
        {
          relativePath: 'public/index.html',
          content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName} — HTMX 2.x</title>
    <link rel="stylesheet" href="/styles/theme-and-sheet.css" />
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  </head>
  <body>
    <main class="studio-shell">
      <section class="studio-card">
        <div class="studio-row" style="justify-content: space-between;">
          <h1>${markupName}</h1>
          <div id="hx-stats-box" hx-get="/hx/stats" hx-trigger="load, click" hx-swap="innerHTML">
            Caricamento stato server...
          </div>
        </div>
        <p id="studio-status-banner">Applicazione Hypermedia HTMX 2.x pronta.</p>
        <form class="studio-row" hx-post="/hx/items" hx-target="#hx-items-container" hx-swap="innerHTML">
          <input id="inp-record-title" name="title" class="studio-input" placeholder="Aggiungi elemento via hx-post..." required />
          <button id="btn-primary-action" type="submit" class="studio-btn">Aggiungi con HTMX</button>
        </form>
        <div id="hx-items-container">
          <ul class="hx-list">
            <li><strong>#1</strong> Modulo HTMX collegato al backend</li>
          </ul>
        </div>
      </section>
    </main>
    ${isTs ? `<script type="module">
      import { onPrimaryActionClick } from '/scripts/automations.js';
      const input = document.querySelector('#inp-record-title');
      document.querySelector('#btn-primary-action').addEventListener('click', () => {
        void onPrimaryActionClick(input.value);
      });
    </script>` : '<script type="module" src="/scripts/automations.js"></script>'}
  </body>
</html>
`,
        },
      );

      if (primaryLanguage === 'python') {
        const pyEngine: 'fastapi' | 'flask' =
          spec.pythonCompanion === 'flask' ? 'flask' : 'fastapi';
        files.push(...buildPythonCompanionFiles(projectName, slug, pyEngine, true));
        devCommand =
          pyEngine === 'flask'
            ? { cmd: 'python', args: ['main.py'], port: 8000, label: 'python main.py (Flask :8000)' }
            : {
                cmd: 'python',
                args: ['-m', 'uvicorn', 'main:app', '--reload', '--port', '8000'],
                port: 8000,
                label: 'python -m uvicorn main:app --reload --port 8000',
              };
        initSteps.push(
          { label: 'python -m venv .venv', cmd: 'python', args: ['-m', 'venv', '.venv'] },
          { label: 'pip install -r requirements.txt', cmd: 'pip_venv', args: ['install', '-r', 'requirements.txt'] },
        );
      } else {
        const srvFile = isTs ? 'server.ts' : 'server.js';
        files.push(
          {
            relativePath: 'package.json',
            content: JSON.stringify(
              {
                name: slug,
                version: '0.1.0',
                private: true,
                type: 'module',
                scripts: {
                  dev: isTs ? 'tsx watch server.ts' : 'node --watch server.js',
                  start: isTs ? 'tsx server.ts' : 'node server.js',
                },
                dependencies: {
                  express: '^4.21.2',
                },
                devDependencies: isTs
                  ? {
                      '@types/express': '^5.0.0',
                      '@types/node': '^22.13.0',
                      tsx: '^4.19.3',
                      typescript: '^5.8.2',
                    }
                  : {},
              },
              null,
              2,
            ),
          },
          ...(isTs
            ? [
                {
                  relativePath: 'tsconfig.json',
                  content: JSON.stringify(
                    {
                      compilerOptions: {
                        target: 'ES2022',
                        module: 'ESNext',
                        moduleResolution: 'bundler',
                        strict: true,
                        esModuleInterop: true,
                        skipLibCheck: true,
                      },
                    },
                    null,
                    2,
                  ),
                },
              ]
            : []),
          {
            relativePath: srvFile,
            content: `import express${isTs ? ', { type Request, type Response }' : ''} from 'express';
import { join } from 'node:path';
${automationRuntimeImports}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const items${isTs ? ': Array<{ id: number; title: string }>' : ''} = [
  { id: 1, title: 'Primo record Hypermedia HTMX' },
];

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
${automationRuntimeRoute}app.use(express.static(join(process.cwd(), 'public')));

app.get('/api/health', (_req${isTs ? ': Request' : ''}, res${isTs ? ': Response' : ''}) => {
  res.json({ ok: true, stack: 'htmx-node', count: items.length });
});

app.get('/hx/stats', (_req${isTs ? ': Request' : ''}, res${isTs ? ': Response' : ''}) => {
  res.send(\`<span>Record attivi: <strong>\${items.length}</strong></span>\`);
});

app.post('/hx/items', (req${isTs ? ': Request' : ''}, res${isTs ? ': Response' : ''}) => {
  const title = String(req.body?.title || 'Nuovo Elemento').trim() || 'Nuovo Elemento';
  items.push({ id: items.length + 1, title });
  const listHtml = items.map((it) => {
    const text = it.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return \`<li><strong>#\${it.id}</strong> \${text}</li>\`;
  }).join('');
  res.send(\`<ul class="hx-list">\${listHtml}</ul>\`);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(\`HTMX Server attivo su http://localhost:\${PORT}\`);
});
`,
          },
        );
        devCommand = {
          cmd: 'npm',
          args: ['run', 'dev'],
          port: 3000,
          label: isTs ? 'npx tsx watch server.ts' : 'node --watch server.js',
        };
        initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      }
      break;
    }

    // ========================================================================
    // 6. REACT NATIVE (EXPO SDK 52 — App.js or App.tsx)
    // ========================================================================
    case 'react-native': {
      const rnExt = isTs ? 'tsx' : 'js';
      entryUiRelPath = `App.${rnExt}`;
      files.push(
        {
          relativePath: 'app.json',
          content: JSON.stringify(
            {
              expo: {
                name: projectName,
                slug,
                version: '1.0.0',
                orientation: 'portrait',
                userInterfaceStyle: isDark ? 'dark' : 'light',
                ios: { supportsTablet: true },
                android: { package: `com.uistudio.${crateSnakeName}` },
                web: { bundler: 'metro' },
              },
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'package.json',
          content: JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              main: `App.${rnExt}`,
              scripts: {
                dev: 'expo start --web',
                start: 'expo start',
                web: 'expo start --web',
                android: 'expo start --android',
                ios: 'expo start --ios',
              },
              dependencies: {
                expo: '~52.0.0',
                'expo-status-bar': '~2.0.0',
                react: '18.3.1',
                'react-dom': '18.3.1',
                'react-native': '0.76.7',
                'react-native-web': '~0.19.13',
              },
              devDependencies: {
                '@babel/core': '^7.25.2',
                ...(isTs
                  ? {
                      '@types/react': '~18.3.12',
                      typescript: '~5.3.3',
                    }
                  : {}),
              },
            },
            null,
            2,
          ),
        },
        ...(isTs
          ? [
              {
                relativePath: 'tsconfig.json',
                content: JSON.stringify(
                  {
                    compilerOptions: {
                      strict: true,
                      jsx: 'react-jsx',
                      target: 'ESNext',
                      module: 'ESNext',
                      moduleResolution: 'bundler',
                      skipLibCheck: true,
                    },
                  },
                  null,
                  2,
                ),
              },
            ]
          : []),
        { relativePath: `scripts/automations.${scriptExt}`, content: autoCode },
        { relativePath: `src/scripts/automations.${scriptExt}`, content: autoCode },
        {
          relativePath: `components/ActionCard.${rnExt}`,
          content: `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function ActionCard({ title, subtitle }${isTs ? ': { title: string; subtitle: string }' : ''}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 6,
  },
  title: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  sub: { color: '#94a3b8', fontSize: 13 },
});
`,
        },
        {
          relativePath: `App.${rnExt}`,
          content: `import React, { useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { ActionCard } from './components/ActionCard';
import { onPrimaryActionClick } from './scripts/automations';

export default function App() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('Expo SDK 52 Mobile + Web pronto.');

  const onPress = async () => {
    const res = await onPrimaryActionClick(text);
    setStatus(res.message);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <ActionCard title={${JSON.stringify(projectName)}} subtitle={status} />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Nuovo elemento mobile..."
          placeholderTextColor="#64748b"
        />
        <Pressable style={styles.button} onPress={onPress}>
          <Text style={styles.buttonText}>Esegui Automazione</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1120' },
  container: { flex: 1, padding: 24, gap: 14, maxWidth: 680, width: '100%', alignSelf: 'center' },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 14,
  },
  button: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
});
`,
        },
      );
      devCommand = {
        cmd: 'npx',
        args: ['expo', 'start', '--web'],
        port: 8081,
        label: 'npx expo start --web',
      };
      initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      break;
    }

    // ========================================================================
    // 7. NEXT.JS 15 APP ROUTER (JS or TS)
    // ========================================================================
    case 'nextjs': {
      entryUiRelPath = `src/app/page.${jsxExt}`;
      files.push(
        {
          relativePath: 'package.json',
          content: JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              scripts: {
                dev: 'next dev --port 3000',
                build: 'next build',
                start: 'next start --port 3000',
              },
              dependencies: {
                next: '^15.2.0',
                react: '^19.0.0',
                'react-dom': '^19.0.0',
              },
              devDependencies: isTs
                ? {
                    '@types/node': '^22.13.0',
                    '@types/react': '^19.0.8',
                    '@types/react-dom': '^19.0.3',
                    typescript: '^5.8.2',
                  }
                : {},
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'next.config.mjs',
          content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,${
    pythonCompanion !== 'none'
      ? `\n  async rewrites() {\n    return [{ source: '/api/py/:path*', destination: 'http://127.0.0.1:8000/api/:path*' }];\n  },`
      : ''
  }
};

export default nextConfig;
`,
        },
        isTs
          ? {
              relativePath: 'tsconfig.json',
              content: JSON.stringify(
                {
                  compilerOptions: {
                    target: 'ES2022',
                    lib: ['dom', 'dom.iterable', 'esnext'],
                    allowJs: true,
                    skipLibCheck: true,
                    strict: true,
                    noEmit: true,
                    esModuleInterop: true,
                    module: 'esnext',
                    moduleResolution: 'bundler',
                    resolveJsonModule: true,
                    isolatedModules: true,
                    jsx: 'preserve',
                    incremental: true,
                    plugins: [{ name: 'next' }],
                  },
                  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
                  exclude: ['node_modules'],
                },
                null,
                2,
              ),
            }
          : {
              relativePath: 'jsconfig.json',
              content: JSON.stringify(
                { compilerOptions: { moduleResolution: 'bundler' }, include: ['src'] },
                null,
                2,
              ),
            },
        { relativePath: 'src/app/globals.css', content: baseCss },
        { relativePath: `src/scripts/automations.${scriptExt}`, content: autoCode },
        {
          relativePath: `src/app/layout.${jsxExt}`,
          content: `import React from 'react';
import './globals.css';

export const metadata = {
  title: ${JSON.stringify(projectName)},
  description: 'Generato con Visual UI Studio (Next.js 15 App Router)',
};

export default function RootLayout({ children }${isTs ? ': { children: React.ReactNode }' : ''}) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
`,
        },
        {
          relativePath: `src/app/page.${jsxExt}`,
          content: `'use client';

import React, { useState } from 'react';
import { onPrimaryActionClick } from '../scripts/automations';

export default function HomePage() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState('Next.js 15 App Router attivo.');

  const runAction = async () => {
    const res = await onPrimaryActionClick(value);
    setStatus(res.message);
  };

  return (
    <main className="studio-shell">
      <section className="studio-card">
        <h1>${markupName}</h1>
        <p id="studio-status-banner">{status}</p>
        <div className="studio-row">
          <input
            id="inp-record-title"
            className="studio-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Inserisci parametro..."
          />
          <button id="btn-primary-action" type="button" className="studio-btn" onClick={runAction}>
            Esegui Server/UI Action
          </button>
        </div>
      </section>
    </main>
  );
}
`,
        },
        {
          relativePath: `src/app/api/health/route.${scriptExt}`,
          content: `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    stack: 'nextjs-15',
    project: '${slug}',
    timestamp: Date.now(),
  });
}
`,
        },
      );
      devCommand = { cmd: 'npm', args: ['run', 'dev'], port: 3000, label: 'npm run dev' };
      initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      break;
    }

    // ========================================================================
    // 8. VITE 6 MODULAR VANILLA SPA (JS or TS)
    // ========================================================================
    case 'vite': {
      entryUiRelPath = 'index.html';
      files.push(
        {
          relativePath: 'package.json',
          content: JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              type: 'module',
              scripts: {
                dev: 'vite --port 5173',
                build: isTs ? 'tsc --noEmit && vite build' : 'vite build',
                preview: 'vite preview',
              },
              devDependencies: {
                vite: '^6.2.0',
                ...(isTs ? { typescript: '^5.8.2' } : {}),
              },
            },
            null,
            2,
          ),
        },
        {
          relativePath: `vite.config.${scriptExt}`,
          content: `import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  server: { port: 5173,${viteApiProxySnippet} },\n});\n`,
        },
        ...(isTs
          ? [
              {
                relativePath: 'tsconfig.json',
                content: JSON.stringify(
                  {
                    compilerOptions: {
                      target: 'ES2022',
                      module: 'ESNext',
                      moduleResolution: 'bundler',
                      strict: true,
                      noEmit: true,
                      skipLibCheck: true,
                    },
                    include: ['src'],
                  },
                  null,
                  2,
                ),
              },
            ]
          : []),
        { relativePath: 'src/styles/theme-and-sheet.css', content: baseCss },
        { relativePath: `src/scripts/automations.${scriptExt}`, content: autoCode },
        {
          relativePath: `src/main.${scriptExt}`,
          content: `import './styles/theme-and-sheet.css';
import { onPrimaryActionClick } from './scripts/automations';

const appRoot = document.querySelector${isTs ? '<HTMLDivElement>' : ''}('#app');
if (appRoot) {
  appRoot.innerHTML = \`
    <main class="studio-shell">
      <section class="studio-card">
        <h1>${markupName}</h1>
        <p id="studio-status-banner">Vite 6 Modular SPA pronta.</p>
        <div class="studio-row">
          <input id="inp-record-title" class="studio-input" placeholder="Titolo voce..." />
          <button id="btn-primary-action" type="button" class="studio-btn">Esegui Azione</button>
        </div>
      </section>
    </main>
  \`;
  const btn = document.querySelector${isTs ? '<HTMLButtonElement>' : ''}('#btn-primary-action');
  const inp = document.querySelector${isTs ? '<HTMLInputElement>' : ''}('#inp-record-title');
  btn?.addEventListener('click', () => {
    void onPrimaryActionClick(inp?.value ?? '');
  });
}
`,
        },
        {
          relativePath: 'index.html',
          content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.${scriptExt}"></script>
  </body>
</html>
`,
        },
      );
      initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      break;
    }

    // ========================================================================
    // 9. NODE.JS 24 FULL-STACK + REST/SQL API (node:sqlite)
    // ========================================================================
    case 'nodejs': {
      entryUiRelPath = 'public/index.html';
      files.push(
        {
          relativePath: 'package.json',
          content: JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              type: 'module',
              scripts: {
                dev: isTs ? 'tsx watch src/server.ts' : 'node --watch src/server.js',
                start: isTs ? 'tsx src/server.ts' : 'node src/server.js',
              },
              dependencies: {
                cors: '^2.8.5',
                express: '^4.21.2',
              },
              devDependencies: isTs
                ? {
                    '@types/cors': '^2.8.17',
                    '@types/express': '^5.0.0',
                    '@types/node': '^22.13.0',
                    tsx: '^4.19.3',
                    typescript: '^5.8.2',
                  }
                : {},
            },
            null,
            2,
          ),
        },
        ...(isTs
          ? [
              {
                relativePath: 'tsconfig.json',
                content: JSON.stringify(
                  {
                    compilerOptions: {
                      target: 'ES2022',
                      module: 'ESNext',
                      moduleResolution: 'bundler',
                      strict: true,
                      esModuleInterop: true,
                      skipLibCheck: true,
                    },
                    include: ['src'],
                  },
                  null,
                  2,
                ),
              },
            ]
          : []),
        {
          relativePath: `src/db.${scriptExt}`,
          content: `import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(join(dataDir, 'app.sqlite'));

db.exec(\`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
\`);

export function listItems()${isTs ? ': Array<{ id: number; title: string; created_at: number }>' : ''} {
  return db.prepare('SELECT id, title, created_at FROM items ORDER BY id DESC').all()${isTs ? ' as any' : ''};
}

export function insertItem(title${isTs ? ': string' : ''}) {
  const clean = String(title || '').trim() || 'Nuovo Record';
  const now = Date.now();
  const res = db.prepare('INSERT INTO items (title, created_at) VALUES (?, ?)').run(clean, now);
  return { id: Number(res.lastInsertRowid), title: clean, created_at: now };
}
`,
        },
        {
          relativePath: `src/server.${scriptExt}`,
          content: `import cors from 'cors';
import express${isTs ? ', { type Request, type Response }' : ''} from 'express';
import { join } from 'node:path';
${automationRuntimeImports}import { insertItem, listItems } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
${automationRuntimeRoute}app.use(express.static(join(process.cwd(), 'public')));

app.get('/api/health', (_req${isTs ? ': Request' : ''}, res${isTs ? ': Response' : ''}) => {
  res.json({ ok: true, stack: 'nodejs-24-sqlite', itemsCount: listItems().length });
});

app.get('/api/items', (_req${isTs ? ': Request' : ''}, res${isTs ? ': Response' : ''}) => {
  res.json({ items: listItems() });
});

app.post('/api/items', (req${isTs ? ': Request' : ''}, res${isTs ? ': Response' : ''}) => {
  const created = insertItem(req.body?.title ?? 'Record');
  res.status(201).json({ ok: true, item: created });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(\`Node.js 24 + SQLite API attiva su http://localhost:\${PORT}\`);
});
`,
        },
        { relativePath: 'public/styles/theme-and-sheet.css', content: baseCss },
        {
          relativePath: `public/scripts/automations.${scriptExt}`,
          content: autoCode,
        },
        {
          relativePath: 'public/scripts/app.js',
          content: `import { onPrimaryActionClick } from './automations.js';

async function refreshItems() {
  const resp = await fetch('/api/items');
  const data = await resp.json();
  const ul = document.querySelector('#sql-items-list');
  if (ul && Array.isArray(data.items)) {
    ul.replaceChildren(...data.items.map((it) => {
      const row = document.createElement('li');
      const id = document.createElement('strong');
      id.textContent = \`#\${it.id}\`;
      row.append(id, ' ', it.title);
      return row;
    }));
  }
}

document.querySelector('#btn-primary-action')?.addEventListener('click', async () => {
  const inp = document.querySelector('#inp-record-title');
  const title = inp && 'value' in inp ? inp.value : '';
  await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  await onPrimaryActionClick(title);
  await refreshItems();
});

void refreshItems();
`,
        },
        {
          relativePath: 'public/index.html',
          content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName} — Node.js 24 + SQLite</title>
    <link rel="stylesheet" href="/styles/theme-and-sheet.css" />
  </head>
  <body>
    <main class="studio-shell">
      <section class="studio-card">
        <h1>${markupName}</h1>
        <p id="studio-status-banner">Server Node.js 24 + REST API + node:sqlite attivo.</p>
        <div class="studio-row">
          <input id="inp-record-title" class="studio-input" placeholder="Nuovo record SQLite..." />
          <button id="btn-primary-action" type="button" class="studio-btn">Salva nel DB</button>
        </div>
        <ul id="sql-items-list"></ul>
      </section>
    </main>
    <script type="module" src="/scripts/app.js"></script>
  </body>
</html>
`,
        },
      );
      devCommand = {
        cmd: 'npm',
        args: ['run', 'dev'],
        port: 3000,
        label: isTs ? 'npx tsx watch src/server.ts' : 'node --watch src/server.js',
      };
      initSteps.push({ label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] });
      break;
    }

    // ========================================================================
    // 10. TAURI v2 DESKTOP & 11. RUST + TAURI v2 FULL-STACK
    // ========================================================================
    case 'tauri':
    case 'rust-tauri': {
      const isFullRust = spec.stackId === 'rust-tauri';
      entryUiRelPath = `src/App.${jsxExt}`;

      const png32 = createValidRgbaPngBytes(32, 32);
      const png128 = createValidRgbaPngBytes(128, 128);
      const icoBytes = createValidRgbaIcoBytes(png32);

      files.push(
        {
          relativePath: 'package.json',
          content: JSON.stringify(
            {
              name: slug,
              version: '0.1.0',
              private: true,
              type: 'module',
              scripts: {
                dev: 'vite --port 1420',
                build: isTs ? 'tsc && vite build' : 'vite build',
                tauri: 'tauri',
                'tauri:dev': 'tauri dev',
                'tauri:build': 'tauri build',
              },
              dependencies: {
                '@tauri-apps/api': '^2.3.0',
                react: '^19.0.0',
                'react-dom': '^19.0.0',
              },
              devDependencies: {
                '@tauri-apps/cli': '^2.3.0',
                '@vitejs/plugin-react': '^4.3.4',
                vite: '^6.2.0',
                ...(isTs
                  ? {
                      '@types/react': '^19.0.8',
                      '@types/react-dom': '^19.0.3',
                      typescript: '^5.8.2',
                    }
                  : {}),
              },
            },
            null,
            2,
          ),
        },
        {
          relativePath: `vite.config.${scriptExt}`,
          content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,${viteApiProxySnippet}
  },
});
`,
        },
        ...(isTs
          ? [
              {
                relativePath: 'tsconfig.json',
                content: JSON.stringify(
                  {
                    compilerOptions: {
                      target: 'ES2022',
                      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
                      module: 'ESNext',
                      moduleResolution: 'bundler',
                      jsx: 'react-jsx',
                      strict: true,
                      noEmit: true,
                      skipLibCheck: true,
                    },
                    include: ['src'],
                  },
                  null,
                  2,
                ),
              },
            ]
          : []),
        {
          relativePath: 'index.html',
          content: `<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${markupName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${jsxExt}"></script>
  </body>
</html>
`,
        },
        { relativePath: 'src/styles/theme-and-sheet.css', content: baseCss },
        { relativePath: `src/scripts/automations.${scriptExt}`, content: autoCode },
        {
          relativePath: `src/lib/tauri-bridge.${scriptExt}`,
          content: `import { invoke } from '@tauri-apps/api/core';

${
  isTs
    ? `export interface TauriRecordItem {\n  id: number;\n  title: string;\n  status: string;\n}\n`
    : ''
}
export async function invokeGreetCommand(name${isTs ? ': string' : ''})${isTs ? ': Promise<string>' : ''} {
  try {
    return await invoke${isTs ? '<string>' : ''}('greet_studio', { name });
  } catch {
    return \`[Simulazione Web] Ciao \${name} da \${${JSON.stringify(projectName)}}!\`;
  }
}
${
  isFullRust
    ? `
export async function invokeListRecords()${isTs ? ': Promise<TauriRecordItem[]>' : ''} {
  try {
    return await invoke${isTs ? '<TauriRecordItem[]>' : ''}('list_records');
  } catch {
    return [{ id: 1, title: 'Record Rust Locale', status: 'pronto' }];
  }
}

export async function invokeCreateRecord(title${isTs ? ': string' : ''})${isTs ? ': Promise<TauriRecordItem>' : ''} {
  try {
    return await invoke${isTs ? '<TauriRecordItem>' : ''}('create_record', { input: { title } });
  } catch {
    return { id: Date.now(), title, status: 'locale' };
  }
}
`
    : ''
}`,
        },
        {
          relativePath: `src/main.${jsxExt}`,
          content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme-and-sheet.css';
import App from './App';

createRoot(document.getElementById('root')${isTs ? '!' : ''}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
        },
        {
          relativePath: `src/App.${jsxExt}`,
          content: `import React, { useState } from 'react';
import { invokeGreetCommand${isFullRust ? ', invokeCreateRecord' : ''} } from './lib/tauri-bridge';
import { onPrimaryActionClick } from './scripts/automations';

export default function App() {
  const [name, setName] = useState('');
  const [reply, setReply] = useState('${isFullRust ? 'Rust + Tauri v2 Full-Stack pronto.' : 'Tauri v2 Desktop pronto.'}');

  const handleInvoke = async () => {
    const msg = await invokeGreetCommand(name || 'Utente');
    ${isFullRust ? `if (name.trim()) await invokeCreateRecord(name.trim());\n    ` : ''}await onPrimaryActionClick(name);
    setReply(msg);
  };

  return (
    <main className="studio-shell">
      <section className="studio-card">
        <h1>${markupName}</h1>
        <p id="studio-status-banner">{reply}</p>
        <div className="studio-row">
          <input
            id="inp-record-title"
            className="studio-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Parametro per comando Rust #[tauri::command]..."
          />
          <button id="btn-primary-action" type="button" className="studio-btn" onClick={handleInvoke}>
            Invoca Comando Rust
          </button>
        </div>
      </section>
    </main>
  );
}
`,
        },
        // Tauri v2 Crate Files
        {
          relativePath: 'src-tauri/Cargo.toml',
          content: `[package]
name = "${slug}"
version = "0.1.0"
description = ${JSON.stringify(projectName + ' — Tauri v2 Desktop Application')}
authors = ["Visual UI Studio"]
edition = "2021"

[lib]
name = "${crateSnakeName}_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
${isFullRust ? 'rusqlite = { version = "0.32", features = ["bundled"] }\nthiserror = "2"\n' : ''}`,
        },
        {
          relativePath: 'src-tauri/build.rs',
          content: `fn main() {\n    tauri_build::build()\n}\n`,
        },
        {
          relativePath: 'src-tauri/tauri.conf.json',
          content: JSON.stringify(
            {
              $schema: 'https://schema.tauri.app/config/2',
              productName: projectName,
              version: '0.1.0',
              identifier: `com.uistudio.${slug.replace(/[^a-z0-9-]/g, '')}`,
              build: {
                beforeDevCommand: 'npm run dev',
                devUrl: 'http://localhost:1420',
                beforeBuildCommand: 'npm run build',
                frontendDist: '../dist',
              },
              app: {
                windows: [
                  {
                    title: projectName,
                    width: 1200,
                    height: 800,
                    resizable: true,
                  },
                ],
                security: {
                  csp: null,
                },
              },
              bundle: {
                active: true,
                targets: 'all',
                icon: [
                  'icons/32x32.png',
                  'icons/128x128.png',
                  'icons/icon.png',
                  'icons/icon.ico',
                ],
              },
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'src-tauri/capabilities/default.json',
          content: JSON.stringify(
            {
              $schema: '../gen/schemas/desktop-schema.json',
              identifier: 'default',
              description: 'Default desktop capabilities for Tauri v2 window',
              windows: ['main'],
              permissions: ['core:default'],
            },
            null,
            2,
          ),
        },
        {
          relativePath: 'src-tauri/src/main.rs',
          content: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ${crateSnakeName}_lib::run()
}
`,
        },
        // Binary RGBA Icons required by `tauri_build::build()`
        { relativePath: 'src-tauri/icons/32x32.png', content: '', binaryData: png32, isBinary: true },
        { relativePath: 'src-tauri/icons/128x128.png', content: '', binaryData: png128, isBinary: true },
        { relativePath: 'src-tauri/icons/icon.png', content: '', binaryData: png128, isBinary: true },
        { relativePath: 'src-tauri/icons/icon.ico', content: '', binaryData: icoBytes, isBinary: true },
      );

      if (!isFullRust) {
        files.push(
          {
            relativePath: 'src-tauri/src/commands.rs',
            content: `// @studio-tauri-commands:start
#[tauri::command]
pub fn greet_studio(name: String) -> String {
    let clean = if name.trim().is_empty() { "Utente" } else { name.trim() };
    format!("Ciao {}, Tauri v2 risponde dal processo nativo Rust!", clean)
}
// @studio-tauri-commands:end
`,
          },
          {
            relativePath: 'src-tauri/src/lib.rs',
            content: `pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // @studio-tauri-handlers:start
            commands::greet_studio,
            // @studio-tauri-handlers:end
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`,
          },
        );
      } else {
        files.push(
          {
            relativePath: 'src-tauri/src/models.rs',
            content: `use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordItem {
    pub id: i64,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecordInput {
    pub title: String,
}
`,
          },
          {
            relativePath: 'src-tauri/src/db.rs',
            content: `use rusqlite::{params, Connection, Result};
use std::sync::Mutex;

use crate::models::RecordItem;

pub struct AppDbState {
    pub conn: Mutex<Connection>,
}

impl AppDbState {
    pub fn new_in_memory_or_file(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'attivo'
            );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_all(&self) -> Result<Vec<RecordItem>> {
        let guard = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = guard.prepare("SELECT id, title, status FROM records ORDER BY id DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(RecordItem {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn insert(&self, title: &str) -> Result<RecordItem> {
        let guard = self.conn.lock().expect("db mutex poisoned");
        let clean = if title.trim().is_empty() { "Nuovo Record" } else { title.trim() };
        guard.execute("INSERT INTO records (title, status) VALUES (?1, 'attivo')", params![clean])?;
        let id = guard.last_insert_rowid();
        Ok(RecordItem {
            id,
            title: clean.to_string(),
            status: "attivo".to_string(),
        })
    }
}
`,
          },
          {
            relativePath: 'src-tauri/src/commands.rs',
            content: `use tauri::State;

use crate::db::AppDbState;
use crate::models::{CreateRecordInput, RecordItem};

// @studio-tauri-commands:start
#[tauri::command]
pub fn greet_studio(name: String) -> String {
    let clean = if name.trim().is_empty() { "Sviluppatore" } else { name.trim() };
    format!("Rust + Tauri v2 Full-Stack attivo per {}!", clean)
}

#[tauri::command]
pub fn list_records(state: State<'_, AppDbState>) -> Result<Vec<RecordItem>, String> {
    state.list_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_record(
    state: State<'_, AppDbState>,
    input: CreateRecordInput,
) -> Result<RecordItem, String> {
    state.insert(&input.title).map_err(|e| e.to_string())
}
// @studio-tauri-commands:end
`,
          },
          {
            relativePath: 'src-tauri/src/lib.rs',
            content: `pub mod commands;
pub mod db;
pub mod models;
${RUST_TAURI_SQL_MODULE_MARKER}

use db::AppDbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_state = AppDbState::new_in_memory_or_file("studio_app.sqlite")
        .expect("impossibile inizializzare database SQLite locale");

    tauri::Builder::default()
        .manage(db_state)
        ${RUST_TAURI_SQL_SETUP_MARKER}
        .invoke_handler(tauri::generate_handler![
            // @studio-tauri-handlers:start
            commands::greet_studio,
            commands::list_records,
            commands::create_record,
            // @studio-tauri-handlers:end
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`,
          },
        );
      }

      devCommand = { cmd: 'npx', args: ['tauri', 'dev'], port: 1420, label: 'npx tauri dev' };
      initSteps.push(
        { label: 'npm install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] },
        {
          label: 'cargo check (Tauri Rust)',
          cmd: 'cargo',
          args: ['check', '--manifest-path', 'src-tauri/Cargo.toml'],
        },
      );
      break;
    }
  }

  // Optional Python Companion on any non-Python-primary stack
  if (primaryLanguage !== 'python' && pythonCompanion !== 'none') {
    files.push(...buildPythonCompanionFiles(projectName, slug, pythonCompanion, false));
    if (pythonCompanion === 'fastapi' || pythonCompanion === 'flask') {
      initSteps.push(
        { label: 'python -m venv .venv', cmd: 'python', args: ['-m', 'venv', '.venv'] },
        { label: 'pip install -r requirements.txt', cmd: 'pip_venv', args: ['install', '-r', 'requirements.txt'] },
      );
    }
  }

  if (spec.initGitRepo) {
    initSteps.push({ label: 'git init', cmd: 'git', args: ['init'] });
  }

  // Project README.md
  files.push({
    relativePath: 'README.md',
    content: `# ${projectName}

Progetto generato con **Visual UI Studio**.

- **Stack**: \`${spec.stackId}\` (${stackMeta.label})
- **Linguaggio Primario**: \`${primaryLanguage}\`${pythonCompanion !== 'none' ? ` + Companion Python (\`${pythonCompanion}\`)` : ''}
- **Dialetto Stili**: \`${stylingPreset}\`
- **Comando Avvio Sviluppo**: \`${devCommand.label}\` (porta \`:${devCommand.port}\`)
`,
  });

  // Deduplicate relativePaths (last write wins if companion overlapped)
  const dedupMap = new Map<string, ScaffoldGeneratedFile>();
  for (const f of files) {
    dedupMap.set(f.relativePath.replace(/\\/g, '/'), {
      ...f,
      relativePath: f.relativePath.replace(/\\/g, '/'),
    });
  }

  return {
    slug,
    crateSnakeName,
    projectName,
    stackId: spec.stackId,
    codegenTargetId: stackMeta.codegenTargetId,
    primaryLanguage,
    pythonCompanion,
    stylingPreset,
    entryUiRelPath,
    automationsRelPath,
    devCommand,
    initSteps,
    files: Array.from(dedupMap.values()),
  };
}
