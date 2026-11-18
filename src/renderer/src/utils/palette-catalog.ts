import type { NodeId } from '@shared/ui-ir';
import type { AICompactNode, UIPatchOp } from '@shared/ui-patch';
import { generateNodeId, hydrateCompactNodeToPatches } from '@shared/ui-patch';

export type PaletteCategory = 'Layout' | 'Controlli' | 'Forme' | 'Smart Blocks';

export interface PaletteElementPreset {
  id: string;
  label: string;
  category: PaletteCategory;
  description: string;
  iconHint: string;
  defaultWidth?: number;
  defaultHeight?: number;
  buildPatches: (parentId: NodeId | null, sheetId: string, dropPos?: { x: number; y: number }) => UIPatchOp[];
}

export interface ReusableComponentTemplate {
  id: string;
  name: string;
  badge: string;
  description: string;
  buildPatches: (parentId: NodeId | null, sheetId: string, dropPos?: { x: number; y: number }) => UIPatchOp[];
}

function applyExplicitDropPos(
  ops: UIPatchOp[],
  dropPos?: { x: number; y: number },
  fallbackWidth = 260,
  fallbackHeight = 48,
): UIPatchOp[] {
  if (!dropPos || ops.length === 0) return ops;
  const first = ops[0];
  if (first.op !== 'insert_node' || first.node.kind === 'artboard') return ops;

  const existingLayout = first.node.layout;
  const w = existingLayout?.frame?.width ?? fallbackWidth;
  const h = existingLayout?.frame?.height ?? fallbackHeight;

  const nextFirst: UIPatchOp = {
    ...first,
    node: {
      ...first.node,
      layout: {
        mode: existingLayout?.mode ?? 'freeform',
        positioning: 'absolute',
        frame: {
          x: Math.round(dropPos.x),
          y: Math.round(dropPos.y),
          width: w,
          height: h,
          rotation: existingLayout?.frame?.rotation ?? 0,
        },
        width:
          existingLayout?.width?.mode === 'fill'
            ? { mode: 'fixed', value: Math.max(160, w) }
            : existingLayout?.width ?? { mode: 'fixed', value: w },
        height: existingLayout?.height ?? { mode: 'hug', value: h },
        direction: existingLayout?.direction,
        wrap: existingLayout?.wrap,
        justify: existingLayout?.justify,
        align: existingLayout?.align,
        gap: existingLayout?.gap,
        rowGap: existingLayout?.rowGap,
        columnGap: existingLayout?.columnGap,
        gridCols: existingLayout?.gridCols,
        gridRows: existingLayout?.gridRows,
        gridChild: existingLayout?.gridChild,
        padding: existingLayout?.padding ?? { top: 8, right: 12, bottom: 8, left: 12 },
        overflow: existingLayout?.overflow ?? 'visible',
      },
    },
  };

  return [nextFirst, ...ops.slice(1)];
}

function fromCompact(
  compact: AICompactNode,
  parentId: NodeId | null,
  sheetId: string,
  dropPos?: { x: number; y: number },
  fallbackWidth = 280,
  fallbackHeight = 48,
): UIPatchOp[] {
  const tree: AICompactNode = dropPos
    ? {
        ...compact,
        positioning: 'absolute',
        x: Math.round(dropPos.x),
        y: Math.round(dropPos.y),
        width: compact.width ?? fallbackWidth,
        height: compact.height ?? fallbackHeight,
        widthMode: compact.widthMode === 'fill' ? 'fixed' : compact.widthMode,
      }
    : compact;
  const ops = hydrateCompactNodeToPatches(tree, parentId, sheetId);
  return applyExplicitDropPos(ops, dropPos, compact.width ?? fallbackWidth, compact.height ?? fallbackHeight);
}

export const PALETTE_ELEMENT_PRESETS: PaletteElementPreset[] = [
  // ================= LAYOUT =================
  {
    id: 'layout-row',
    label: 'Row (Flex →)',
    category: 'Layout',
    description: 'Contenitore orizzontale Auto-Layout',
    iconHint: 'layout-row',
    defaultWidth: 420,
    defaultHeight: 88,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'FlexRowContainer',
          tag: 'div',
          layoutMode: 'flex',
          direction: 'row',
          gap: 12,
          padding: 16,
          align: 'center',
          width: 420,
          height: 88,
          widthMode: 'fill',
          heightMode: 'hug',
          bg: '#1e293b22',
          radius: 10,
          borderColor: '#334155',
        },
        parentId,
        sheetId,
        pos,
        420,
        88,
      ),
  },
  {
    id: 'layout-column',
    label: 'Column (Flex ↓)',
    category: 'Layout',
    description: 'Contenitore verticale Auto-Layout',
    iconHint: 'layout-col',
    defaultWidth: 340,
    defaultHeight: 160,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'FlexColumnStack',
          tag: 'section',
          layoutMode: 'flex',
          direction: 'column',
          gap: 12,
          padding: 16,
          width: 340,
          height: 160,
          widthMode: 'fill',
          heightMode: 'hug',
          bg: '#1e293b22',
          radius: 10,
          borderColor: '#334155',
        },
        parentId,
        sheetId,
        pos,
        340,
        160,
      ),
  },
  {
    id: 'layout-grid',
    label: 'Grid 2×2',
    category: 'Layout',
    description: 'Griglia CSS responsiva multi-colonna',
    iconHint: 'layout-grid',
    defaultWidth: 520,
    defaultHeight: 140,
    buildPatches: (parentId, sheetId, pos) => {
      const gridId = generateNodeId('grd');
      const ops: UIPatchOp[] = [
        {
          op: 'insert_node',
          parentId,
          node: {
            id: gridId,
            kind: 'container',
            name: 'ResponsiveGrid',
            semanticTag: 'section',
            layout: {
              mode: 'grid',
              positioning: pos ? 'absolute' : 'flow',
              gridCols: [
                { track: 'fr', value: 1 },
                { track: 'fr', value: 1 },
              ],
              gridRows: [{ track: 'auto' }],
              gap: 16,
              frame: { x: pos ? Math.round(pos.x) : 20, y: pos ? Math.round(pos.y) : 20, width: 520, height: 140 },
              width: pos ? { mode: 'fixed', value: 520 } : { mode: 'fill' },
              height: { mode: 'hug', value: 140 },
              padding: { top: 16, right: 16, bottom: 16, left: 16 },
            },
            style: {
              fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
              border: { width: 1, style: 'dashed', color: { $token: 'color.border.subtle' } },
              radius: 10,
            },
          },
        },
        ...hydrateCompactNodeToPatches(
          { kind: 'text', name: 'GridCellA', text: 'Grid Cell 1', bg: '#3b82f61a', padding: 12, radius: 8 },
          gridId,
          sheetId,
        ),
        ...hydrateCompactNodeToPatches(
          { kind: 'text', name: 'GridCellB', text: 'Grid Cell 2', bg: '#8b5cf61a', padding: 12, radius: 8 },
          gridId,
          sheetId,
        ),
      ];
      return applyExplicitDropPos(ops, pos, 520, 140);
    },
  },
  {
    id: 'layout-zstack',
    label: 'Z-Stack',
    category: 'Layout',
    description: 'Livelli sovrapposti (Overlay / Stack)',
    iconHint: 'layers',
    defaultWidth: 320,
    defaultHeight: 160,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'OverlayZStack',
          tag: 'div',
          layoutMode: 'stack',
          padding: 16,
          width: 320,
          height: 160,
          widthMode: 'fixed',
          heightMode: 'fixed',
          bg: '#1e293b44',
          radius: 12,
          borderColor: '#475569',
        },
        parentId,
        sheetId,
        pos,
        320,
        160,
      ),
  },
  {
    id: 'layout-card',
    label: 'Card Surface',
    category: 'Layout',
    description: 'Scheda con bordo, token surface e padding',
    iconHint: 'maximize',
    defaultWidth: 360,
    defaultHeight: 132,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'SurfaceCard',
          tag: 'article',
          layoutMode: 'flex',
          direction: 'column',
          gap: 10,
          padding: 20,
          width: 360,
          height: 132,
          widthMode: 'fill',
          heightMode: 'hug',
          bg: '#162033',
          radius: 12,
          borderColor: '#334155',
          children: [
            { kind: 'text', name: 'CardTitle', tag: 'h3', text: 'Titolo Scheda', fontSize: 17, fontWeight: 700 },
            { kind: 'text', name: 'CardBody', tag: 'p', text: 'Contenuto modulare pronto per il codegen multi-target.', fontSize: 13 },
          ],
        },
        parentId,
        sheetId,
        pos,
        360,
        132,
      ),
  },
  {
    id: 'layout-window-header',
    label: 'Window Header',
    category: 'Layout',
    description: 'Barra finestra desktop Electron / Tauri',
    iconHint: 'panel-left',
    defaultWidth: 560,
    defaultHeight: 48,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'WindowHeaderBar',
          tag: 'header',
          layoutMode: 'flex',
          direction: 'row',
          justify: 'space-between',
          align: 'center',
          padding: 12,
          width: 560,
          height: 48,
          widthMode: 'fill',
          heightMode: 'hug',
          bg: '#0f172a',
          radius: 8,
          borderColor: '#334155',
          children: [
            { kind: 'text', name: 'WindowTitle', tag: 'span', text: 'Desktop Studio App', fontSize: 13, fontWeight: 600 },
            { kind: 'control', controlType: 'badge', name: 'WindowStatusBadge', text: 'v2.0 Local' },
          ],
        },
        parentId,
        sheetId,
        pos,
        560,
        48,
      ),
  },

  // ================= CONTROLLI =================
  {
    id: 'ctrl-button',
    label: 'Button',
    category: 'Controlli',
    description: 'Pulsante primario interattivo',
    iconHint: 'plus',
    defaultWidth: 168,
    defaultHeight: 40,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'control',
          controlType: 'button',
          name: 'ActionButton',
          tag: 'button',
          text: 'Conferma Azione',
          iconName: 'sparkles',
          bg: '#2563eb',
          textColor: '#ffffff',
          radius: 8,
          padding: 10,
          width: 168,
          height: 40,
          widthMode: 'fixed',
          heightMode: 'fixed',
        },
        parentId,
        sheetId,
        pos,
        168,
        40,
      ),
  },
  {
    id: 'ctrl-heading',
    label: 'Text / Heading',
    category: 'Controlli',
    description: 'Titolo o testo tipografico',
    iconHint: 'edit',
    defaultWidth: 280,
    defaultHeight: 40,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'text',
          name: 'SectionHeading',
          tag: 'h2',
          text: 'Nuova Sezione Interfaccia',
          fontSize: 22,
          fontWeight: 700,
          width: 280,
          height: 40,
        },
        parentId,
        sheetId,
        pos,
        280,
        40,
      ),
  },
  {
    id: 'ctrl-input',
    label: 'Input Text',
    category: 'Controlli',
    description: 'Campo di testo con placeholder',
    iconHint: 'search',
    defaultWidth: 280,
    defaultHeight: 40,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'control',
          controlType: 'text-input',
          name: 'TextInputField',
          tag: 'input',
          placeholder: 'Inserisci valore...',
          width: 280,
          height: 40,
          widthMode: 'fill',
          heightMode: 'fixed',
          bg: '#0b101b',
          radius: 8,
          borderColor: '#475569',
        },
        parentId,
        sheetId,
        pos,
        280,
        40,
      ),
  },
  {
    id: 'ctrl-select',
    label: 'Select Dropdown',
    category: 'Controlli',
    description: 'Menu a tendina con opzioni',
    iconHint: 'chevron-down',
    defaultWidth: 220,
    defaultHeight: 40,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'control',
              name: 'CategorySelect',
              semanticTag: 'select',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 24, y: pos ? Math.round(pos.y) : 24, width: 220, height: 40 },
                width: { mode: 'fixed', value: 220 },
                height: { mode: 'fixed', value: 40 },
                padding: { top: 8, right: 12, bottom: 8, left: 12 },
              },
              style: {
                fills: [{ type: 'solid', color: { $token: 'color.bg.muted' } }],
                border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
                radius: 8,
              },
              content: {
                controlType: 'select',
                options: ['Tutti i Prodotti', 'Hardware AI', 'Accessori Studio'],
                value: 'Tutti i Prodotti',
              },
            },
          },
        ],
        pos,
        220,
        40,
      ),
  },
  {
    id: 'ctrl-textarea',
    label: 'Textarea',
    category: 'Controlli',
    description: 'Area di testo multilinea',
    iconHint: 'message-square',
    defaultWidth: 320,
    defaultHeight: 88,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'control',
          controlType: 'textarea',
          name: 'NotesTextarea',
          tag: 'textarea',
          placeholder: 'Scrivi descrizione o note operative...',
          width: 320,
          height: 88,
          widthMode: 'fill',
          heightMode: 'fixed',
          bg: '#0b101b',
          radius: 8,
          borderColor: '#475569',
        },
        parentId,
        sheetId,
        pos,
        320,
        88,
      ),
  },
  {
    id: 'ctrl-checkbox',
    label: 'Checkbox',
    category: 'Controlli',
    description: 'Casella di controllo booleana',
    iconHint: 'check',
    defaultWidth: 230,
    defaultHeight: 34,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'control',
              name: 'TermsCheckbox',
              semanticTag: 'label',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 24, y: pos ? Math.round(pos.y) : 24, width: 230, height: 34 },
                width: pos ? { mode: 'fixed', value: 230 } : { mode: 'hug', value: 230 },
                height: { mode: 'hug', value: 34 },
                padding: { top: 4, right: 8, bottom: 4, left: 8 },
              },
              style: {},
              content: { controlType: 'checkbox', text: 'Abilita sincronizzazione locale', checked: true },
            },
          },
        ],
        pos,
        230,
        34,
      ),
  },
  {
    id: 'ctrl-switch',
    label: 'Switch Toggle',
    category: 'Controlli',
    description: 'Interruttore ON/OFF moderno',
    iconHint: 'settings',
    defaultWidth: 220,
    defaultHeight: 36,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'control',
              name: 'RealtimeSyncSwitch',
              semanticTag: 'button',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 24, y: pos ? Math.round(pos.y) : 24, width: 220, height: 36 },
                width: pos ? { mode: 'fixed', value: 220 } : { mode: 'hug', value: 220 },
                height: { mode: 'hug', value: 36 },
                padding: { top: 6, right: 10, bottom: 6, left: 10 },
              },
              style: {},
              content: { controlType: 'switch', text: 'Modalità Offline Turbo', checked: true },
            },
          },
        ],
        pos,
        220,
        36,
      ),
  },
  {
    id: 'ctrl-badge',
    label: 'Badge Pill',
    category: 'Controlli',
    description: 'Etichetta stato compatta',
    iconHint: 'tag',
    defaultWidth: 124,
    defaultHeight: 28,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'control',
          controlType: 'badge',
          name: 'StatusBadge',
          tag: 'span',
          text: 'Attivo • v2.0',
          bg: '#10b98128',
          textColor: '#10b981',
          radius: 999,
          fontSize: 12,
          fontWeight: 600,
          width: 124,
          height: 28,
        },
        parentId,
        sheetId,
        pos,
        124,
        28,
      ),
  },
  {
    id: 'ctrl-table',
    label: 'Data Table',
    category: 'Controlli',
    description: 'Tabella dati strutturata con colonne e righe',
    iconHint: 'table',
    defaultWidth: 620,
    defaultHeight: 156,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'control',
              name: 'OrdersDataTable',
              semanticTag: 'table',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 24, y: pos ? Math.round(pos.y) : 24, width: 620, height: 156 },
                width: pos ? { mode: 'fixed', value: 620 } : { mode: 'fill' },
                height: { mode: 'hug', value: 156 },
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              style: {
                fills: [{ type: 'solid', color: { $token: 'color.bg.surface' } }],
                border: { width: 1, style: 'solid', color: { $token: 'color.border.subtle' } },
                radius: 10,
              },
              content: {
                controlType: 'table',
                tableColumns: ['Codice', 'Cliente', 'Stato', 'Totale'],
                tableRows: [
                  ['#ORD-901', 'Studio Milano SRL', 'Spedito', '€ 1.420,00'],
                  ['#ORD-902', 'TechLab Torino', 'In lavorazione', '€ 890,00'],
                  ['#ORD-903', 'Alpine Cloud', 'Completato', '€ 3.150,00'],
                ],
              },
            },
          },
        ],
        pos,
        620,
        156,
      ),
  },
  {
    id: 'ctrl-modal',
    label: 'Modal Dialog',
    category: 'Controlli',
    description: 'Finestra di dialogo / conferma',
    iconHint: 'maximize',
    defaultWidth: 420,
    defaultHeight: 190,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'ConfirmModalDialog',
          tag: 'dialog',
          layoutMode: 'flex',
          direction: 'column',
          gap: 12,
          padding: 24,
          width: 420,
          height: 190,
          widthMode: 'fixed',
          heightMode: 'hug',
          bg: '#162033',
          radius: 14,
          borderColor: '#475569',
          children: [
            { kind: 'text', name: 'ModalTitle', tag: 'h3', text: 'Conferma Esportazione', fontSize: 18, fontWeight: 700 },
            { kind: 'text', name: 'ModalDesc', tag: 'p', text: 'Vuoi salvare il bundle multi-file nella cartella collegata?', fontSize: 13 },
            {
              kind: 'control',
              controlType: 'button',
              name: 'ModalConfirmBtn',
              tag: 'button',
              text: 'Procedi Ora',
              bg: '#2563eb',
              textColor: '#ffffff',
            },
          ],
        },
        parentId,
        sheetId,
        pos,
        420,
        190,
      ),
  },
  {
    id: 'ctrl-navbar',
    label: 'Navbar',
    category: 'Controlli',
    description: 'Barra di navigazione orizzontale',
    iconHint: 'menu',
    defaultWidth: 680,
    defaultHeight: 64,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'AppNavbar',
          tag: 'nav',
          layoutMode: 'flex',
          direction: 'row',
          justify: 'space-between',
          align: 'center',
          padding: 14,
          width: 680,
          height: 64,
          widthMode: 'fill',
          heightMode: 'hug',
          bg: '#101726',
          radius: 10,
          borderColor: '#334155',
          children: [
            { kind: 'text', name: 'NavBrand', tag: 'h3', text: 'Acme Platform', fontSize: 16, fontWeight: 700 },
            { kind: 'control', controlType: 'button', name: 'NavActionBtn', tag: 'button', text: 'Accedi', bg: '#2563eb', textColor: '#ffffff' },
          ],
        },
        parentId,
        sheetId,
        pos,
        680,
        64,
      ),
  },
  {
    id: 'ctrl-sidebar',
    label: 'Sidebar Nav',
    category: 'Controlli',
    description: 'Menu laterale verticale',
    iconHint: 'panel-left',
    defaultWidth: 220,
    defaultHeight: 160,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'NavigationSidebar',
          tag: 'aside',
          layoutMode: 'flex',
          direction: 'column',
          gap: 8,
          padding: 16,
          width: 220,
          height: 160,
          widthMode: 'fixed',
          heightMode: 'hug',
          bg: '#101726',
          radius: 12,
          borderColor: '#334155',
          children: [
            { kind: 'text', name: 'NavItemOverview', tag: 'a', text: '🏠 Panoramica', fontSize: 14, fontWeight: 600 },
            { kind: 'text', name: 'NavItemOrders', tag: 'a', text: '📦 Catalogo & Ordini', fontSize: 14 },
            { kind: 'text', name: 'NavItemSettings', tag: 'a', text: '⚙️ Impostazioni', fontSize: 14 },
          ],
        },
        parentId,
        sheetId,
        pos,
        220,
        160,
      ),
  },
  {
    id: 'ctrl-three-viewport',
    label: '🧊 Three.js 3D Viewport',
    category: 'Controlli',
    description: 'Viewport WebGL Three.js 3D interattivo con scena PBR e camera orbitale',
    iconHint: 'globe',
    defaultWidth: 460,
    defaultHeight: 300,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'control',
              name: 'Three3DViewport',
              semanticTag: 'div',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 64, y: pos ? Math.round(pos.y) : 64, width: 460, height: 300 },
                width: pos ? { mode: 'fixed', value: 460 } : { mode: 'fill', value: 460 },
                height: { mode: 'fixed', value: 300 },
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              style: {
                fills: [{ type: 'solid', color: '#0b1120' }],
                border: { width: 1, style: 'solid', color: '#3b82f6' },
                radius: 14,
                zIndex: 4,
              },
              content: {
                controlType: 'three-viewport',
                text: 'Scena 3D Three.js',
              },
            },
          },
        ],
        pos,
        460,
        300,
      ),
  },

  // ================= FORME =================
  {
    id: 'shape-rect',
    label: 'Rectangle',
    category: 'Forme',
    description: 'Rettangolo grafico decorativo',
    iconHint: 'maximize',
    defaultWidth: 180,
    defaultHeight: 96,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'vector',
              name: 'AccentRectangle',
              semanticTag: 'div',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 20, y: pos ? Math.round(pos.y) : 20, width: 180, height: 96 },
                width: { mode: 'fixed', value: 180 },
                height: { mode: 'fixed', value: 96 },
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              style: {
                fills: [{ type: 'solid', color: '#3b82f633' }],
                border: { width: 2, style: 'solid', color: '#3b82f6' },
                radius: 12,
              },
            },
          },
        ],
        pos,
        180,
        96,
      ),
  },
  {
    id: 'shape-circle',
    label: 'Circle',
    category: 'Forme',
    description: 'Cerchio / Avatar / Indicatore',
    iconHint: 'globe',
    defaultWidth: 72,
    defaultHeight: 72,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'vector',
              name: 'CircleShape',
              semanticTag: 'div',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 20, y: pos ? Math.round(pos.y) : 20, width: 72, height: 72 },
                width: { mode: 'fixed', value: 72 },
                height: { mode: 'fixed', value: 72 },
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              style: {
                fills: [{ type: 'solid', color: '#8b5cf644' }],
                border: { width: 2, style: 'solid', color: '#8b5cf6' },
                radius: 9999,
              },
            },
          },
        ],
        pos,
        72,
        72,
      ),
  },
  {
    id: 'shape-divider',
    label: 'Divider',
    category: 'Forme',
    description: 'Separatore orizzontale sottile',
    iconHint: 'menu',
    defaultWidth: 400,
    defaultHeight: 2,
    buildPatches: (parentId, _sheetId, pos) =>
      applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              kind: 'control',
              name: 'HorizontalDivider',
              semanticTag: 'div',
              layout: {
                mode: 'freeform',
                positioning: pos ? 'absolute' : 'flow',
                frame: { x: pos ? Math.round(pos.x) : 24, y: pos ? Math.round(pos.y) : 24, width: 400, height: 2 },
                width: pos ? { mode: 'fixed', value: 400 } : { mode: 'fill' },
                height: { mode: 'fixed', value: 2 },
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              style: {
                fills: [{ type: 'solid', color: { $token: 'color.border.subtle' } }],
              },
              content: { controlType: 'divider' },
            },
          },
        ],
        pos,
        400,
        2,
      ),
  },

  // ================= SMART BLOCKS =================
  {
    id: 'smart-htmx-search',
    label: 'HTMX Live Search',
    category: 'Smart Blocks',
    description: 'Input hx-get collegato a target risultati live',
    iconHint: 'search',
    defaultWidth: 460,
    defaultHeight: 168,
    buildPatches: (parentId, sheetId, pos) => {
      const resultsId = generateNodeId('htmx_res');
      return fromCompact(
        {
          kind: 'container',
          name: 'HtmxLiveSearchWidget',
          tag: 'section',
          layoutMode: 'flex',
          direction: 'column',
          gap: 10,
          padding: 18,
          width: 460,
          height: 168,
          widthMode: 'fill',
          bg: '#101726',
          radius: 12,
          borderColor: '#3b82f666',
          children: [
            { kind: 'text', name: 'HtmxSearchTitle', tag: 'h4', text: '⚡ Ricerca Ipermediale HTMX', fontSize: 15, fontWeight: 700 },
            {
              kind: 'control',
              controlType: 'text-input',
              name: 'HtmxQueryInput',
              tag: 'input',
              placeholder: 'Digita per filtrare via hx-get="/api/customers/search"...',
              widthMode: 'fill',
              height: 40,
              htmx: {
                method: 'hx-get',
                endpoint: '/api/customers/search',
                targetNodeId: resultsId,
                hxSwap: 'innerHTML',
                hxTrigger: 'keyup changed delay:200ms',
              },
            },
            {
              id: resultsId,
              kind: 'collection',
              name: 'HtmxSwapTargetList',
              tag: 'ul',
              layoutMode: 'flex',
              direction: 'column',
              gap: 6,
              padding: 10,
              bg: '#0f172a33',
              radius: 8,
              children: [
                { kind: 'text', name: 'SampleMatch1', tag: 'li', text: 'Cliente #104 — Giulia Conti (Enterprise)' },
              ],
            },
          ],
        },
        parentId,
        sheetId,
        pos,
        460,
        168,
      );
    },
  },
  {
    id: 'smart-htmx-form',
    label: 'HTMX Post Form',
    category: 'Smart Blocks',
    description: 'Form hx-post dichiarativo con swap feedback',
    iconHint: 'send',
    defaultWidth: 420,
    defaultHeight: 196,
    buildPatches: (parentId, sheetId, pos) => {
      const statusTargetId = generateNodeId('htmx_status');
      return fromCompact(
        {
          kind: 'container',
          name: 'HtmxQuickCreateForm',
          tag: 'form',
          layoutMode: 'flex',
          direction: 'column',
          gap: 10,
          padding: 18,
          width: 420,
          height: 196,
          widthMode: 'fill',
          bg: '#101726',
          radius: 12,
          borderColor: '#10b98166',
          htmx: {
            method: 'hx-post',
            endpoint: '/api/leads/create',
            targetNodeId: statusTargetId,
            hxSwap: 'innerHTML',
            hxTrigger: 'submit',
          },
          children: [
            { kind: 'text', name: 'FormHeader', tag: 'h4', text: 'Nuovo Contatto Rapido (hx-post)', fontSize: 15, fontWeight: 700 },
            { kind: 'control', controlType: 'text-input', name: 'LeadEmailInput', tag: 'input', placeholder: 'nome@azienda.it', widthMode: 'fill' },
            {
              kind: 'control',
              controlType: 'button',
              name: 'SubmitHtmxFormBtn',
              tag: 'button',
              text: 'Invia al Server',
              bg: '#10b981',
              textColor: '#ffffff',
            },
            { id: statusTargetId, kind: 'text', name: 'FormSwapBanner', tag: 'div', text: 'Pronto per invio ipermediale.', fontSize: 12 },
          ],
        },
        parentId,
        sheetId,
        pos,
        420,
        196,
      );
    },
  },
  {
    id: 'smart-maui-card',
    label: '.NET MAUI Grid Card',
    category: 'Smart Blocks',
    description: 'Scheda XAML con DataBinding TwoWay e RelayCommand',
    iconHint: 'cpu',
    defaultWidth: 420,
    defaultHeight: 184,
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'MauiMvvmOrderCard',
          tag: 'article',
          layoutMode: 'flex',
          direction: 'column',
          gap: 10,
          padding: 18,
          width: 420,
          height: 184,
          widthMode: 'fill',
          bg: '#101726',
          radius: 12,
          borderColor: '#8b5cf666',
          mvvmBinding: { property: 'Title', path: 'SelectedOrderTitle' },
          children: [
            {
              kind: 'text',
              name: 'MauiHeaderLabel',
              tag: 'h4',
              text: '💜 .NET MAUI MVVM Bound Card',
              fontSize: 16,
              fontWeight: 700,
              mvvmBinding: { property: 'Text', path: 'CustomerDisplayName' },
            },
            {
              kind: 'control',
              controlType: 'text-input',
              name: 'MauiBoundEntry',
              tag: 'input',
              placeholder: 'TwoWay Binding: OrderNotes',
              widthMode: 'fill',
              mvvmBinding: { property: 'Text', path: 'OrderNotes' },
            },
            {
              kind: 'control',
              controlType: 'button',
              name: 'MauiRelayCmdBtn',
              tag: 'button',
              text: 'Execute ApproveOrderCommand',
              bg: '#7c3aed',
              textColor: '#ffffff',
              mvvmBinding: { property: 'CommandParameter', path: 'OrderId', command: 'ApproveOrderCommand' },
            },
          ],
        },
        parentId,
        sheetId,
        pos,
        420,
        184,
      ),
  },
  {
    id: 'smart-desktop-titlebar',
    label: 'Desktop Frameless Titlebar',
    category: 'Smart Blocks',
    description: 'Titlebar frameless Mica/Acrylic con drag-region',
    iconHint: 'terminal',
    defaultWidth: 680,
    defaultHeight: 42,
    buildPatches: (parentId, _sheetId, pos) => {
      const barId = generateNodeId('titlebar');
      const titleId = generateNodeId('tb_txt');
      const closeBtnId = generateNodeId('tb_close');
      return applyExplicitDropPos(
        [
          {
            op: 'insert_node',
            parentId,
            node: {
              id: barId,
              kind: 'container',
              name: 'FramelessDesktopTitlebar',
              semanticTag: 'header',
              layout: {
                mode: 'flex',
                positioning: pos ? 'absolute' : 'flow',
                direction: 'row',
                justify: 'space-between',
                align: 'center',
                gap: 12,
                frame: { x: pos ? Math.round(pos.x) : 0, y: pos ? Math.round(pos.y) : 0, width: 680, height: 42 },
                width: pos ? { mode: 'fixed', value: 680 } : { mode: 'fill' },
                height: { mode: 'fixed', value: 42 },
                padding: { top: 8, right: 14, bottom: 8, left: 14 },
              },
              style: {
                fills: [{ type: 'solid', color: '#0f172a' }],
                border: { width: 1, style: 'solid', color: '#334155' },
                radius: 8,
                backdropBlur: 12,
              },
              platform: {
                desktopWindow: {
                  frameless: true,
                  backdrop: 'mica',
                  dragRegion: 'drag',
                  titlebarStyle: 'customControls',
                },
              },
            },
          },
          {
            op: 'insert_node',
            parentId: barId,
            node: {
              id: titleId,
              kind: 'text',
              name: 'FramelessAppTitle',
              semanticTag: 'span',
              content: { text: '⚡ Native Studio Shell — Mica Drag Region' },
              typography: { fontFamily: { $token: 'font.sans' }, fontSize: 12, fontWeight: 600, color: '#e2e8f0' },
            },
          },
          {
            op: 'insert_node',
            parentId: barId,
            node: {
              id: closeBtnId,
              kind: 'control',
              name: 'WindowControlsPill',
              semanticTag: 'button',
              content: { controlType: 'badge', text: '—  □  ✕' },
              typography: { fontFamily: { $token: 'font.mono' }, fontSize: 11, fontWeight: 600, color: '#94a3b8' },
              platform: { desktopWindow: { dragRegion: 'no-drag' } },
            },
          },
        ],
        pos,
        680,
        42,
      );
    },
  },
];

export const REUSABLE_COMPONENT_TEMPLATES: ReusableComponentTemplate[] = [
  {
    id: 'comp-hero-section',
    name: 'Hero Section',
    badge: 'Marketing / SaaS',
    description: 'Intestazione ad alto impatto con badge, headline H1, sottotitolo e doppia CTA.',
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'SaaSHeroComponent',
          tag: 'section',
          layoutMode: 'flex',
          direction: 'column',
          gap: 14,
          padding: 28,
          width: 680,
          height: 240,
          widthMode: 'fill',
          radius: 16,
          borderColor: '#3b82f655',
          children: [
            { kind: 'control', controlType: 'badge', name: 'HeroReleasePill', text: '✨ Nuova Release 2.0 Local-First', bg: '#3b82f622', textColor: '#60a5fa' },
            { kind: 'text', name: 'HeroMainHeading', tag: 'h1', text: 'Progetta Interfacce Multi-Piattaforma in Tempo Reale', fontSize: 26, fontWeight: 700 },
            { kind: 'text', name: 'HeroLeadCopy', tag: 'p', text: 'Esporta codice pulito e idiomatico per Web, Mobile e Desktop senza riscrivere il layout.', fontSize: 14 },
            {
              kind: 'container',
              name: 'HeroCtaGroup',
              layoutMode: 'flex',
              direction: 'row',
              gap: 12,
              padding: 0,
              children: [
                { kind: 'control', controlType: 'button', name: 'HeroStartBtn', tag: 'button', text: 'Inizia Subito', bg: '#2563eb', textColor: '#ffffff' },
                { kind: 'control', controlType: 'button', name: 'HeroDocsBtn', tag: 'button', text: 'Documentazione SDK', bg: '#334155', textColor: '#f8fafc' },
              ],
            },
          ],
        },
        parentId,
        sheetId,
        pos,
        680,
        240,
      ),
  },
  {
    id: 'comp-login-card',
    name: 'Login Card',
    badge: 'Auth / Security',
    description: 'Modulo di autenticazione completo con email, password e pulsante accesso.',
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'AuthLoginCard',
          tag: 'form',
          layoutMode: 'flex',
          direction: 'column',
          gap: 12,
          padding: 24,
          width: 380,
          height: 230,
          widthMode: 'fixed',
          radius: 14,
          borderColor: '#475569',
          children: [
            { kind: 'text', name: 'LoginTitle', tag: 'h2', text: 'Accedi al Workspace', fontSize: 20, fontWeight: 700 },
            { kind: 'control', controlType: 'text-input', name: 'LoginEmail', tag: 'input', placeholder: 'email@dominio.com', widthMode: 'fill' },
            { kind: 'control', controlType: 'password', name: 'LoginPassword', tag: 'input', placeholder: '••••••••••••', widthMode: 'fill' },
            { kind: 'control', controlType: 'button', name: 'LoginSubmitBtn', tag: 'button', text: 'Entra in Sicurezza', bg: '#2563eb', textColor: '#ffffff', widthMode: 'fill' },
          ],
        },
        parentId,
        sheetId,
        pos,
        380,
        230,
      ),
  },
  {
    id: 'comp-analytics-kpi',
    name: 'Analytics KPI Grid',
    badge: 'Dashboard / BI',
    description: 'Riga di 3 indicatori KPI per metriche finanziarie o telemetria.',
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'AnalyticsKpiRow',
          tag: 'section',
          layoutMode: 'flex',
          direction: 'row',
          gap: 14,
          padding: 4,
          width: 660,
          height: 98,
          widthMode: 'fill',
          children: [
            {
              kind: 'container',
              name: 'KpiUsersBox',
              layoutMode: 'flex',
              direction: 'column',
              gap: 4,
              padding: 16,
              widthMode: 'fill',
              radius: 10,
              borderColor: '#334155',
              children: [
                { kind: 'text', name: 'KpiUsersLabel', text: 'Utenti Attivi', fontSize: 12 },
                { kind: 'text', name: 'KpiUsersNumber', tag: 'h3', text: '24,910 (+14%)', fontSize: 20, fontWeight: 700 },
              ],
            },
            {
              kind: 'container',
              name: 'KpiLatencyBox',
              layoutMode: 'flex',
              direction: 'column',
              gap: 4,
              padding: 16,
              widthMode: 'fill',
              radius: 10,
              borderColor: '#334155',
              children: [
                { kind: 'text', name: 'KpiLatencyLabel', text: 'Latenza Locale P95', fontSize: 12 },
                { kind: 'text', name: 'KpiLatencyNumber', tag: 'h3', text: '11.4 ms', fontSize: 20, fontWeight: 700 },
              ],
            },
            {
              kind: 'container',
              name: 'KpiUptimeBox',
              layoutMode: 'flex',
              direction: 'column',
              gap: 4,
              padding: 16,
              widthMode: 'fill',
              radius: 10,
              borderColor: '#334155',
              children: [
                { kind: 'text', name: 'KpiUptimeLabel', text: 'Affidabilità SLA', fontSize: 12 },
                { kind: 'text', name: 'KpiUptimeNumber', tag: 'h3', text: '99.98%', fontSize: 20, fontWeight: 700 },
              ],
            },
          ],
        },
        parentId,
        sheetId,
        pos,
        660,
        98,
      ),
  },
  {
    id: 'comp-settings-form',
    name: 'Settings Form',
    badge: 'Preferenze App',
    description: 'Pannello configurazione utente con campi input, toggle e salvataggio.',
    buildPatches: (parentId, sheetId, pos) =>
      fromCompact(
        {
          kind: 'container',
          name: 'WorkspaceSettingsForm',
          tag: 'form',
          layoutMode: 'flex',
          direction: 'column',
          gap: 12,
          padding: 22,
          width: 480,
          height: 220,
          widthMode: 'fill',
          radius: 14,
          borderColor: '#334155',
          children: [
            { kind: 'text', name: 'SettingsHeading', tag: 'h3', text: 'Preferenze Progetto & Esportazione', fontSize: 18, fontWeight: 700 },
            { kind: 'control', controlType: 'text-input', name: 'SettingsOrgName', tag: 'input', placeholder: 'Nome Organizzazione / Namespace', widthMode: 'fill' },
            { kind: 'control', controlType: 'switch', name: 'SettingsAutoSaveToggle', text: 'Salvataggio automatico su SQLite WAL' },
            { kind: 'control', controlType: 'button', name: 'SettingsSaveBtn', tag: 'button', text: 'Salva Impostazioni', bg: '#10b981', textColor: '#ffffff' },
          ],
        },
        parentId,
        sheetId,
        pos,
        480,
        220,
      ),
  },
];
