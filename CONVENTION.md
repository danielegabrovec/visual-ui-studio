# CONVENZIONI ARCHITETTURALI — Frontend Next (`Visual UI Studio v2.0`)

Questo documento stabilisce i **confini tra moduli**, la **trovabilità** ("un concetto = un posto") e le **regole di consolidamento** per *Frontend Next v2.0*, in conformità alla metodologia aziendale (*Regola Fissa — Costruire tutte le app: trovabilità, confini, consolidamento*).

---

## 1. Mappa dei Confini di Sistema (`src/`)

Il codice sorgente è suddiviso in **5 perimetri rigorosi** con dipendenze unidirezionali:

```text
src/
├── shared/                     # Contratti puri, IR canonici e motori deterministici (ZERO I/O, ZERO DOM, ZERO Electron)
│   ├── ui-ir.ts                # IR Livello-1 (UISheetDocument) + Livello-2 (UIRModule, three-viewport, script/blueprint actions) + 26 TargetDescriptor
│   ├── ui-patch.ts             # Protocollo atomico UIPatchOp, update_sheet_meta, idratazione AICompactNode e inversione esatta Undo/Redo
│   ├── css-sync-engine.ts      # Motore bidirezionale Design <-> CSS (compileSheetToCss + SourceMap + :hover/:active/:focus + parseCssEditsToPatchOps)
│   ├── script-ir.ts            # Estrazione funzioni TS/JS, transpilatore browser-safe TS->ES2024 JS, StudioRuntimeContext e 6 snippet template
│   ├── blueprint-ir.ts         # Grafo visuale stile Unreal Engine (24 card in 5 categorie, cavi Bezier, compileBlueprintToTs/RuntimeJs, simulatore)
│   ├── three-ir.ts             # Scena 3D Three.js (geometrie, luci, materiali PBR, 4 preset, compileThreeSceneToCode per three-ts / r3f-tsx / three-html)
│   ├── wizard-templates.ts     # Contratto ProjectWizardSpec, 6 palette WCAG e generatore multi-file buildWizardProjectSeed
│   ├── ipc-contract.ts         # DTO condivisi (VfsEntryKind esteso, createFromWizard, moveEntry) e StudioPreloadApi
│   ├── worker-protocol.ts      # Proxy/Host RPC tipizzato su MessagePort / process.parentPort
│   ├── default-tokens.ts       # Design Tokens base (Light/Dark), Breakpoint e Starter Demo Sheet
│   ├── icon-catalog.ts         # Catalogo icone SVG vettoriali offline indicizzate in SQLite FTS5
│   ├── markup-importer.ts      # Parser deterministico Code-to-Canvas (HTML, Tailwind, HTMX, JSX, SVG -> UIPatchOp[])
│   ├── a11y-auditor.ts         # Revisore deterministico WCAG 2.2 AA & Layout Responsivo + autoFixPatches
│   └── layout-solver/          # Spatial Layout Solver XY-Cut (opt-in autoSolveFreeform per preservare coordinate assolute Freeform)
│
├── main/                       # Shell / Host Electron (Menu.setApplicationMenu(null), BrowserWindow, supervisione Worker, protocollo asset)
│   ├── index.ts                # Bootstrap finestra nativa, orchestrazione transazioni AI+Checkpoint e openDirectory
│   └── bundle-exporter.ts      # Scrittura sicura multi-file su disco con protezione anti-path-traversal
│
├── preload/                    # Ponte di sicurezza contextBridge (nessuna logica di dominio)
│   └── index.ts                # Espone esclusivamente window.studioApi (contextIsolation: true, sandbox: true)
│
├── workers/                    # Servizi di dominio isolati in utilityProcess Node.js separati
│   ├── db-worker/              # UNICO processo single-writer su SQLite (node:sqlite WAL, Wizard seed multi-file, VFS moveEntry ricorsivo)
│   ├── codegen-worker/         # Pipeline UI-IR -> UIRModule e 26 plugin di generazione codice (Auto-Layout + Freeform absolute + CSS SourceMap)
│   └── ai-worker/              # Gateway LLM locale (Ollama, LM Studio, Offline Synth con posizionamento Freeform nextY) + Unsloth Exporter
│
└── renderer/                   # Interfaccia utente Pro IDE v2.0 (React 19 + Zustand + Three.js)
    └── src/
        ├── api/                # studio-client.ts: ponte Electron + parità completa Browser (createCodegenWorkerService + localStorage v2)
        ├── state/              # Store unificato Zustand (studio-store.ts: Hub, Wizard, 7 Split Modes, Console, Blueprint, Script, Scena 3D)
        ├── components/         # ProjectLaunchHub, GuidedProjectWizard, ApplicationMenuBar (11 menu), LeftPermanentSidebar (Breadcrumb VFS),
        │                       # VisualCanvasView, CssLiveEditorView, LiveCodeView, ScriptWorkbenchView, BlueprintNodeEditorView,
        │                       # ThreeSceneStudioView, ThreeEmbeddedPreview, LiveSandboxPreview, CommandPaletteModal, BottomConsoleDrawer, StatusBar
        ├── utils/              # Catalogo 23 preset palette Freeform/Auto e sandbox-html-builder.ts (runtime JS/TS + Blueprint + 3D isolato)
        └── styles/             # Sistema di token CSS dell'IDE (temi Dark e Light)
```

---

## 2. Regole Inviolabili di Confine e Anti-Duplicazione

1. **Un Concetto = Un Posto**:
   - Tutte le mutazioni dell'albero visuale passano **esclusivamente** per `applyPatchOpsToSheet(sheet, ops)` in `src/shared/ui-patch.ts` (inclusi trascinamenti Freeform `(X, Y)`, modifiche CSS in `CssLiveEditorView`, Inspector, Importer, WCAG Auto-Fix e AI).
   - La sincronizzazione `Design <-> CSS` risiede **solo** in `src/shared/css-sync-engine.ts`.
   - La compilazione e simulazione dei grafi visuali Blueprint risiede **solo** in `src/shared/blueprint-ir.ts`.
   - Il modello scena 3D e i compilatori Three.js / React Three Fiber / HTML5 ES Module risiedono **solo** in `src/shared/three-ir.ts`.
   - Il seed multi-file del Wizard a 5 passi risiede **solo** in `src/shared/wizard-templates.ts` (condiviso tra `db-worker` SQLite e `studio-client.ts` browser mode).

2. **Parità Totale Desktop Electron, Browser & Viste Narrow-Pane**:
   - `src/workers/codegen-worker/service.ts` e tutti i 26 plugin in `targets/` sono puri ES/TypeScript privi di import Node-only (`fs`, `node:sqlite`, `electron`), importati con path relativo esplicito in `src/renderer/src/api/studio-client.ts` per funzionare senza attriti anche su hot-reload Vite e persistiti in `localStorage` (`visual_ui_studio_v2_state`, con reset opzionale `?resetHub=1`).
   - Il Workbench mantiene sempre permanente la barra sinistra VFS (`min-width: 220px` sotto `1080px`, `256px` su desktop) e adatta automaticamente pannello destro e split centrali/3D tramite `ResizeObserver` per garantire piena usabilità anche in side-panel browser stretti (`~670px`).
   - È severamente vietato introdurre stub semplificati che emettano codice fittizio in modalità browser.

3. **Divieto di Accesso Diretto a Disco o Database fuori dai Confini**:
   - Il `renderer` non importa mai `fs`, `path`, `electron` o `node:sqlite`.
   - **Single-Writer SQLite**: solo `src/workers/db-worker/` apre connessioni di scrittura al file `.uistudio` / `.sqlite`.

4. **Purezza dei 26 Target di Codegen & Fedeltà Freeform / Auto-Layout**:
   - I nodi con `positioning === 'absolute'` o figli di contenitori `mode === 'freeform'` preservano le proprie coordinate `(x, y, width, height, zIndex)` lungo `normalizeSheetToUIRModule` a meno che l'utente non invochi esplicitamente `solveFreeformLayout` (`autoSolveFreeform: true`).
   - È vietato generare suffissi casuali nei selettori CSS o istruzioni `void varName;` superflue nei componenti React/TSX.

5. **Sicurezza delle Mutazioni AI**:
   - Nessuna operazione generata da `ai-worker` viene applicata senza aver prima persistito un checkpoint atomico (`reason: 'pre_ai_step'`).

---

## 3. Guida Passo-Passo: Aggiungere un Nuovo Target di Codegen

1. **Dichiarare il Target in `src/shared/ui-ir.ts`** (`BuiltinCodegenTargetId` + `BUILTIN_TARGET_DESCRIPTORS`).
2. **Implementare `CodegenTargetPlugin` in `src/workers/codegen-worker/targets/`**:
   - Gestire sia il layout strutturato (`ROW`, `COLUMN`, `GRID`) sia il posizionamento libero (`FLOATING` / `FREEFORM` con coordinate `(x, y, width, height, zIndex)`), i nodi `ThreeViewport` e gli handler `SCRIPT_CALL` / `BLUEPRINT_EVENT`.
   - Emettere intervalli `CodeSourceMapSpan[]` accurati tramite `CodeBuilder` (e `buildStylesheetWithSourceMap` per i fogli stile secondari).
3. **Registrare il Plugin in `src/workers/codegen-worker/plugin-registry.ts`** e aggiungere i test in `tests/codegen.test.ts`.

---

## 4. Checklist Definition of Done (Prima di ogni Release / Commit)

- [ ] `npm run typecheck` passa con **0 errori** sia su `tsconfig.node.json` sia su `tsconfig.web.json`.
- [ ] `npm test` passa al **100%** su tutte le **7 suite Vitest** (`v2-engines`, `blueprint-script`, `three-studio`, `db-worker`, `codegen`, `ai-worker`, `importer-auditor`).
- [ ] `npm run build` compila pulitamente `out/main`, `out/preload` e `out/renderer`.
- [ ] `npm run test:e2e` passa su Electron reale verificando tutti i 12 punti funzionali v2.0 con **0 `pageerror`** e **0 `console.error`**.
- [ ] Nessun artefatto di build (`out/`, `test-results/`), database `.sqlite`/`.uistudio` o file temporaneo è tracciato da Git (`git status --short`).
