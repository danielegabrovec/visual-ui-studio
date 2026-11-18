# CONTRATTO DI SISTEMA — Frontend Next (`Visual UI Studio v2.0`)

Questo documento definisce il **contratto formale** delle rappresentazioni intermedie (UI 2D, CSS Sync, Script TS/JS, Blueprint Unreal, Scena 3D Three.js), delle mutazioni transazionali `UIPatchOp`, della persistenza SQLite WAL / VFS e del ponte IPC/Sandbox di **Visual UI Studio v2.0**.

---

## 1. Rappresentazioni Intermedie Condivise (`src/shared/`)

### 1.1 Livello 1 — `UISheetDocument` (`src/shared/ui-ir.ts`)
Rappresenta la verità persistita per ciascun foglio visuale `.canvas`:
- **`sheetId` / `projectId` / `name` / `defaultLayoutMode` (`'freeform' | 'auto'`) / `customCss?`**: metadati e stili custom di foglio.
- **`rootIds: NodeId[]` & `nodes: Record<NodeId, UINode>`**: mappa piatta O(1) con invariante bidirezionale `parentId <-> childIds`:
  - `layout: LayoutSpec`: supporta `mode: 'flex' | 'grid' | 'stack' | 'freeform'`, `positioning: 'flow' | 'absolute' | 'fixed' | 'sticky'` e `frame: { x, y, width, height }`;
  - `style: StyleSpec`: riempimenti solidi/gradienti, bordi, raggi, ombre, `backdropBlur`, `zIndex` e `customCss` inline;
  - `content?: NodeContentSpec`: include tutti i controlli standard più `controlType: 'three-viewport'` collegato a `threeSceneId`;
  - `stateOverrides`: varianti per stati interattivi (`hover`, `focus`, `active`, `disabled`, `checked`, `loading`, `dark`);
  - `interactions?: EventActionBinding[]`: supporta azioni dichiarative UI, `call_script_fn` (`vfsEntryId`, `fnName` verso moduli `.ts`/`.js`) e `trigger_blueprint` (`blueprintId`, `eventNodeId` verso grafi `.blueprint.json`);
  - `platform?: PlatformExtensions`: estensioni tipizzate per **HTMX** (`hx-*`), **MVVM** (`OneWay`/`TwoWay`/`ICommand`), **Desktop Window** e **ARIA**.

### 1.2 Livello 2 — `UIRModule` (`src/shared/ui-ir.ts` & `xy-cut-solver.ts`)
`lowerSheetToUIR(...)` trasforma `UISheetDocument` + `DesignTokenEntry[]` in un `UIRModule` normalizzato per i **26 generatori target**:
1. **Preservazione Coordinate Freeform vs Auto-Layout**: i nodi con `positioning === 'absolute'` o figli di contenitori `freeform` mantengono le coordinate esatte `(x, y, width, height, zIndex)` per emettere posizionamento assoluto nativo in ogni target; il solver spaziale XY-Cut interviene solo quando richiesto esplicitamente (`autoSolveFreeform: true`).
2. **SourceMap Multi-File**: sia i file componente primari sia i fogli di stile secondari (`.css`, `.module.css`, `.razor.css`, `.uss`) espongono `CodeSourceMapSpan[]` 1-based per selezione ed evidenziazione bidirezionale `Canvas <-> Codice`.
3. **Abbassamento Eventi & 3D**: traduce `call_script_fn` in `SCRIPT_CALL`, `trigger_blueprint` in `BLUEPRINT_EVENT` e `three-viewport` in contenitori/canvas `data-three-scene`.

### 1.3 Contratto Sync Bidirezionale CSS (`src/shared/css-sync-engine.ts`)
- **`compileSheetToCss(sheet, tokens, activeThemeId, opts)`**: emette foglio CSS completo (con `:root` variables e commenti di ancoraggio `/* @node <id> */`) o singola regola dell'elemento selezionato, incluse pseudo-classi `:hover`, `:active`, `:focus` e `CodeSourceMapSpan[]`.
- **`parseCssEditsToPatchOps(cssText, sheet, fallbackNodeId)`**: converte modifiche testuali CSS (`left`, `top`, `width`, `height`, `z-index`, `display`, `flex-direction`, `gap`, `padding`, `background`, `border`, `border-radius`, `opacity`, `box-shadow`, `backdrop-filter`, tipografia e pseudo-stati) in `UIPatchOp[]` reversibili.

### 1.4 Contratto Script TS/JS, Blueprint Unreal & Studio 3D Three.js
- **`src/shared/script-ir.ts`**: definisce `StudioRuntimeContext` (`state`, `getText`, `setText`, `getValue`, `setValue`, `setStyle`, `setVisible`, `log`, `toast`, `three.rotate/setColor`), `extractScriptFunctions(code)` e `transpileTypeScriptToJs(tsCode)` deterministico browser-safe.
- **`src/shared/blueprint-ir.ts`**: definisce `BlueprintGraphDocument` (`nodes`, `wires`, `variables`, `viewport`), 24 template in `BLUEPRINT_NODE_CATALOG`, validazione pin `canConnectBlueprintPins`, geometria `computeBezierWirePath`, `compileBlueprintToTs(graph)` (con `sourceMap`), `compileBlueprintToRuntimeJs(graph)` e `simulateBlueprintExecution(graph)`.
- **`src/shared/three-ir.ts`**: definisce `ThreeSceneDocument` (`camera`, `environment`, `objects` mesh/luci/particelle con `ThreeMaterialSpec` PBR e `animation`), 4 preset curati e `compileThreeSceneToCode(scene, format)` verso `'three-ts' | 'r3f-tsx' | 'three-html'` con `sourceMap` per singolo oggetto 3D.

---

## 2. Protocollo Atomico di Mutazione (`UIPatchOp` in `src/shared/ui-patch.ts`)

Ogni modifica al foglio è espressa come sequenza ordinata di `UIPatchOp` con generazione automatica di `inverseOps` per Undo/Redo illimitato:

| Operazione (`op`) | Responsabilità | Operazione Inversa (`inverseOps`) |
|---|---|---|
| `insert_node` | Inserisce un nuovo `UINode` (rispettando `positioning: 'absolute'` e coordinate `(x, y)`) | `delete_node` sull'ID generato |
| `update_node` | Aggiorna in deep-merge `layout`, `style`, `typography`, `content`, `stateOverrides`, `interactions` | `update_node` con snapshot precedente |
| `update_sheet_meta` | Aggiorna metadati del foglio (`name`, `customCss`, `defaultLayoutMode`) | `update_sheet_meta` con i valori precedenti |
| `move_node` | Sposta un nodo verso `newParentId` e `index` ricalcolando `sortOrder` | `move_node` verso `oldParentId` e `oldIndex` |
| `wrap_container` | Avvolge `targetNodeIds` in un contenitore Auto-Layout | Ripristino figli + `delete_node` wrapper |
| `delete_node` | Rimuove ricorsivamente nodo e sotto-albero in post-order | Sequenza `insert_node` ricostruttiva |
| `bind_token` | Collega una proprietà puntuale a `{ $token: tokenPath }` | `update_node` coi valori precedenti |
| `convert_auto_layout` | Converte un contenitore in Flex/Grid portando i figli in `flow` | Ripristino `layout` figli e contenitore |
| `set_interaction` | Imposta `interactions` (`call_script_fn`, `trigger_blueprint`, ecc.), `htmx` o `mvvm` | Ripristino `interactions` e `platform` |

---

## 3. Persistenza Single-Writer SQLite WAL & VFS Gerarchico (`src/workers/db-worker/`)

- Configurazione SQLite (`node:sqlite`): `PRAGMA journal_mode = WAL; synchronous = NORMAL; foreign_keys = ON; busy_timeout = 5000;`.
- **Tipi di File VFS (`VfsEntryKind`)**: `'folder' | 'canvas_sheet' | 'style_file' | 'script_file' | 'blueprint_graph' | 'three_scene' | 'component_def' | 'source_file' | 'asset'`.
- **Operazioni VFS Gerarchiche**:
  - `project.createFromWizard(spec)` popola atomicamente cartelle annidate (`/src/screens`, `/src/styles`, `/src/scripts`, `/src/blueprints`, `/src/scenes3d`), fogli `.canvas`, `.css`, `.ts`, `.blueprint.json`, `.scene3d.json` e palette token WCAG.
  - `vfs.moveEntry(entryId, newParentId)` blocca spostamenti circolari (cartella dentro un proprio discendente), disambigua collisioni di nome, ricalcola ricorsivamente `virtual_path` / `disk_rel_path` di tutti i discendenti e sincronizza `renameSync` su disco se collegato.

---

## 4. Contratto IPC `StudioPreloadApi` (`src/shared/ipc-contract.ts`)

1. **`studioApi.project`**: `listRecent`, `create`, `createFromWizard`, `open`, `openDirectory`, `getCurrent`, `linkDiskDirectory`, `updateSettings`, `exportBundleToDisk`.
2. **`studioApi.workspace`**: `loadState`, `saveState`.
3. **`studioApi.vfs`**: `listTree`, `createEntry`, `renameEntry`, `moveEntry`, `deleteEntry`, `readFile`, `writeFile`.
4. **`studioApi.canvas`**: `listSheets`, `loadSheet`, `saveSheetViewport`, `commitPatchBatch`, `undo`, `redo`, `listCheckpoints`, `createCheckpoint`, `restoreCheckpoint`.
5. **`studioApi.tokens`**: `listTokens`, `upsertToken`, `deleteToken`, `listThemes`, `searchIcons`.
6. **`studioApi.codegen`**: `listTargets` (26 descrittori), `compileSheet`, `solveFreeformLayout`, `saveBundleToDisk`.
7. **`studioApi.ai`**: `getHardwareReport`, `listProvidersAndModels`, `configureProvider`, `getUnslothCatalog`, `pullOllamaModel`, `listThreads`, `getThreadMessages`, `runAgentTurn`, `cancelAgentRun`, `recordUnslothPair`, `listUnslothPairs`, `exportUnslothDataset`, `onAgentStreamEvent`.

---

## 5. Invarianti di Sicurezza e Isolamento Sandbox

1. **Electron Hardening (`src/main/index.ts`)**: `Menu.setApplicationMenu(null)` (menu nativo disabilitato in favore della barra a 11 menu integrata), `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
2. **Anti-Path-Traversal (`src/main/bundle-exporter.ts`)**: rifiuta byte nulli, segmenti `..` e path esterni alla root selezionata.
3. **Live Sandbox Preview Isolata (`src/renderer/src/utils/sandbox-html-builder.ts`)**: esecuzione di Script TS/JS transpilati, grafi Blueprint e canvas 3D dentro `<iframe sandbox="allow-scripts">` senza `allow-same-origin` e con CSP `connect-src 'none'`, comunicando con l'IDE unicamente tramite messaggi `postMessage` strutturati.
