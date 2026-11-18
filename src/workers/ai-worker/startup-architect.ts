import { createStarterBlueprintGraph } from '@shared/blueprint-ir';
import { compileSheetToCss } from '@shared/css-sync-engine';
import { createDefaultThemes, createDefaultTokens } from '@shared/default-tokens';
import {
  pickPreferredLocalModel,
  type AgentStreamEvent,
  type GenerateProjectWithAiRequest,
  type LocalAIProviderKind,
  type StartupAssistantChatRequest,
  type StartupAssistantChatResult,
} from '@shared/ipc-contract';
import { createThreeSceneFromPreset } from '@shared/three-ir';
import type {
  CodegenTargetId,
  StylingDialect,
  UIControlSubtype,
  UINode,
  UISheetDocument,
} from '@shared/ui-ir';
import { createDefaultUINode, fractionalOrderAt } from '@shared/ui-patch';
import type { AiGeneratedProjectSeedOutput } from '@shared/worker-protocol';
import {
  WIZARD_PALETTE_PRESETS,
  type GeneratedWizardVfsSeedItem,
  type WizardPaletteId,
  type WizardProjectSeedBundle,
} from '@shared/wizard-templates';
import type { LMStudioProviderClient } from './providers/lmstudio-provider';
import type { OllamaProviderClient } from './providers/ollama-provider';
import type { OpenAICompatProviderClient } from './providers/openai-compat-provider';
import { extractThinkingAndJsonBody } from './providers/types';

// ============================================================================
// STRUCTURED JSON SCHEMA FOR AI PROJECT ARCHITECT (OLLAMA / GBNF SAFE)
// ============================================================================

export interface AiBlueprintKpiSpec {
  label: string;
  value: string;
  trend: string;
}

export interface AiBlueprintFormFieldSpec {
  name: string;
  label: string;
  controlType: 'text-input' | 'select' | 'checkbox' | 'textarea';
  placeholder: string;
}

export interface AiBlueprintScreenSpec {
  name: string;
  title: string;
  subtitle: string;
  navItems: string[];
  kpis: AiBlueprintKpiSpec[];
  formTitle: string;
  formFields: AiBlueprintFormFieldSpec[];
  primaryActionLabel: string;
  primaryHandlerFn: string;
  secondaryActionLabel: string;
  tableTitle: string;
  tableColumns: string[];
  tableRows: string[][];
}

export interface AiProjectArchitectureBlueprint {
  projectName: string;
  paletteId: WizardPaletteId;
  defaultThemeMode: 'dark' | 'light';
  includeThreeScene: boolean;
  summary: string;
  screens: AiBlueprintScreenSpec[];
  handlersTs: string;
}

export const AI_PROJECT_BLUEPRINT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    projectName: { type: 'string' },
    paletteId: {
      type: 'string',
      enum: [
        'dark-pro',
        'clean-light',
        'ocean-blue',
        'emerald-studio',
        'cyberpunk-neon',
        'warm-corporate',
      ],
    },
    defaultThemeMode: { type: 'string', enum: ['dark', 'light'] },
    includeThreeScene: { type: 'boolean' },
    summary: { type: 'string' },
    screens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          navItems: { type: 'array', items: { type: 'string' } },
          kpis: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                trend: { type: 'string' },
              },
              required: ['label', 'value', 'trend'],
            },
          },
          formTitle: { type: 'string' },
          formFields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                label: { type: 'string' },
                controlType: {
                  type: 'string',
                  enum: ['text-input', 'select', 'checkbox', 'textarea'],
                },
                placeholder: { type: 'string' },
              },
              required: ['name', 'label', 'controlType', 'placeholder'],
            },
          },
          primaryActionLabel: { type: 'string' },
          primaryHandlerFn: { type: 'string' },
          secondaryActionLabel: { type: 'string' },
          tableTitle: { type: 'string' },
          tableColumns: { type: 'array', items: { type: 'string' } },
          tableRows: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' } },
          },
        },
        required: [
          'name',
          'title',
          'subtitle',
          'navItems',
          'kpis',
          'formTitle',
          'formFields',
          'primaryActionLabel',
          'primaryHandlerFn',
          'tableTitle',
          'tableColumns',
          'tableRows',
        ],
      },
    },
    handlersTs: { type: 'string' },
  },
  required: ['projectName', 'paletteId', 'summary', 'screens', 'handlersTs'],
};

const VALID_PALETTES = new Set<WizardPaletteId>([
  'dark-pro',
  'clean-light',
  'ocean-blue',
  'emerald-studio',
  'cyberpunk-neon',
  'warm-corporate',
]);

function sanitizeIdentifier(raw: string, fallback: string): string {
  const cleaned = (raw || '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/^[0-9]+/, '');
  return cleaned || fallback;
}

function sanitizeScreenName(raw: string, index: number): string {
  const pascal = (raw || '')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).replace(/[^a-zA-Z0-9]/g, ''))
    .join('');
  return pascal || (index === 0 ? 'MainWorkspace' : `SecondaryScreen${index + 1}`);
}

// ============================================================================
// DOMAIN-SMART DETERMINISTIC FALLBACK ARCHITECT (35s TIMEOUT / OFFLINE SAFETY)
// ============================================================================

export function buildDomainSmartBlueprint(req: GenerateProjectWithAiRequest): AiProjectArchitectureBlueprint {
  const prompt = (req.prompt || '').trim();
  const lower = prompt.toLowerCase();

  const wantsThree =
    lower.includes('3d') ||
    lower.includes('three') ||
    lower.includes('webgl') ||
    lower.includes('prodotto 3d') ||
    lower.includes('configuratore') ||
    lower.includes('showcase');

  const isInvoicesCrm =
    lower.includes('fattur') ||
    lower.includes('client') ||
    lower.includes('gestionale') ||
    lower.includes('preventiv') ||
    lower.includes('crm') ||
    lower.includes('contabil');

  const isHtmxSearch =
    lower.includes('htmx') ||
    lower.includes('ricerca live') ||
    lower.includes('catalogo') ||
    lower.includes('inventario');

  const isKpiOrders =
    lower.includes('kpi') ||
    lower.includes('ordini') ||
    lower.includes('logistica') ||
    lower.includes('magazzino') ||
    lower.includes('telemetria') ||
    lower.includes('analytics');

  let paletteId: WizardPaletteId = 'dark-pro';
  if (wantsThree) paletteId = 'cyberpunk-neon';
  else if (isInvoicesCrm) paletteId = 'ocean-blue';
  else if (isKpiOrders) paletteId = 'emerald-studio';
  else if (lower.includes('chiaro') || lower.includes('light')) paletteId = 'clean-light';
  else if (lower.includes('corporate') || lower.includes('b2b')) paletteId = 'warm-corporate';

  const defaultThemeMode: 'dark' | 'light' = paletteId === 'clean-light' ? 'light' : 'dark';

  if (isInvoicesCrm) {
    const projectName = req.projectName?.trim() || 'Gestionale Clienti & Fatture';
    return {
      projectName,
      paletteId,
      defaultThemeMode,
      includeThreeScene: wantsThree,
      summary: `Architettura gestionale completa per "${projectName}" con cruscotto incassi, emissione rapida fatture elettroniche e anagrafica clienti.`,
      screens: [
        {
          name: 'CruscottoFatturazione',
          title: 'Gestione Clienti & Fatturazione Elettronica',
          subtitle: 'Controllo incassi mensili, scadenziario SDI e creazione rapida documenti fiscali',
          navItems: ['Cruscotto', 'Fatture Attive', 'Anagrafica Clienti', 'Scadenziario'],
          kpis: [
            { label: 'Fatturato Mese Corrente', value: '€ 54.820,00', trend: '+16,4% vs mese scorso' },
            { label: 'Fatture Incassate', value: '142 / 156', trend: '91,0% regolarità' },
            { label: 'Clienti Attivi B2B', value: '98 Aziende', trend: '+7 nuovi contratti' },
          ],
          formTitle: 'Emissione Rapida Fattura / Preventivo',
          formFields: [
            {
              name: 'ragioneSociale',
              label: 'Cliente / Ragione Sociale',
              controlType: 'text-input',
              placeholder: 'Es. Officine Meccaniche Rossi S.r.l.',
            },
            {
              name: 'importoImponibile',
              label: 'Imponibile (€)',
              controlType: 'text-input',
              placeholder: '2.450,00',
            },
            {
              name: 'aliquotaStato',
              label: 'Regime IVA & Stato',
              controlType: 'select',
              placeholder: 'IVA 22% Ordinaria — Da Inviare SDI',
            },
          ],
          primaryActionLabel: 'Genera e Invia Fattura',
          primaryHandlerFn: 'onEmitInvoiceSubmit',
          secondaryActionLabel: 'Esporta XML SDI',
          tableTitle: 'Registro Ultime Fatture Emesse',
          tableColumns: ['N. Doc', 'Ragione Sociale', 'Data', 'Totale IVA Incl.', 'Stato SDI'],
          tableRows: [
            ['FT-2026/201', 'Officine Rossi S.r.l.', '18/11/2026', '€ 2.989,00', 'Consegnata'],
            ['FT-2026/202', 'Studio Associato Bianchi', '17/11/2026', '€ 1.525,00', 'Pagata'],
            ['FT-2026/203', 'Logistica Adriatica S.p.A.', '15/11/2026', '€ 6.344,00', 'In Scadenza'],
            ['FT-2026/204', ' TechNova Sistemi S.r.l.', '14/11/2026', '€ 4.148,00', 'Pagata'],
          ],
        },
        {
          name: 'AnagraficaClienti',
          title: 'Rubrica Clienti & Affidabilità Creditizia',
          subtitle: 'Schede fiscali P.IVA, codice destinatario SDI e storico ordini per cliente',
          navItems: ['Cruscotto', 'Fatture Attive', 'Anagrafica Clienti', 'Report IVA'],
          kpis: [
            { label: 'Valore Medio Cliente', value: '€ 4.890', trend: '+8,2% annuo' },
            { label: 'Tempo Medio Incasso', value: '24 Giorni', trend: '-5 gg miglioramento' },
            { label: 'Insoluti Aperti', value: '€ 1.840', trend: 'Solo 2 pratiche' },
          ],
          formTitle: 'Nuova Scheda Cliente B2B',
          formFields: [
            {
              name: 'denominazione',
              label: 'Denominazione Azienda',
              controlType: 'text-input',
              placeholder: 'Es. Delta Automazione S.r.l.',
            },
            {
              name: 'partitaIva',
              label: 'Partita IVA & Codice SDI',
              controlType: 'text-input',
              placeholder: 'IT01234567890 — M5UXCR1',
            },
            {
              name: 'listino',
              label: 'Listino Associato',
              controlType: 'select',
              placeholder: 'Listino Partner Enterprise (-15%)',
            },
          ],
          primaryActionLabel: 'Salva Anagrafica Cliente',
          primaryHandlerFn: 'onSaveClientRecord',
          secondaryActionLabel: 'Importa CSV',
          tableTitle: 'Elenco Clienti Principali',
          tableColumns: ['Codice', 'Azienda', 'P.IVA', 'Fatturato Anno', 'Rating'],
          tableRows: [
            ['CLI-001', 'Officine Rossi S.r.l.', 'IT02948100123', '€ 38.400', 'AAA Ottimo'],
            ['CLI-002', 'Logistica Adriatica S.p.A.', 'IT08819200451', '€ 64.200', 'AA Solido'],
            ['CLI-003', 'TechNova Sistemi S.r.l.', 'IT04412900918', '€ 29.750', 'AAA Ottimo'],
          ],
        },
      ],
      handlersTs: `// Handler operativi TypeScript generati per ${projectName}
export interface InvoiceDraft {
  ragioneSociale: string;
  importoImponibile: number;
  ivaPercent: number;
}

export function onEmitInvoiceSubmit(draft?: Partial<InvoiceDraft>): { numero: string; totale: number; stato: string } {
  const imponibile = Number(draft?.importoImponibile ?? 2450);
  const iva = Math.round(imponibile * 0.22 * 100) / 100;
  const totale = Math.round((imponibile + iva) * 100) / 100;
  const numero = \`FT-2026/\${Math.floor(205 + Math.random() * 80)}\`;
  console.log(\`[Fatturazione] Emessa \${numero} per \${draft?.ragioneSociale ?? 'Cliente B2B'} — Totale € \${totale}\`);
  return { numero, totale, stato: 'Inviata a SDI' };
}

export function onSaveClientRecord(payload?: Record<string, unknown>): boolean {
  console.log('[Anagrafica] Nuovo cliente registrato:', payload ?? { status: 'ok' });
  return true;
}

export function onPrimaryActionClick(): void {
  onEmitInvoiceSubmit();
}
`,
    };
  }

  if (wantsThree) {
    const projectName = req.projectName?.trim() || 'Showcase Prodotto 3D Studio';
    return {
      projectName,
      paletteId,
      defaultThemeMode: 'dark',
      includeThreeScene: true,
      summary: `Esperienza interattiva 3D PBR + pannello configuratore parametri real-time per "${projectName}".`,
      screens: [
        {
          name: 'Configuratore3DMain',
          title: 'Configuratore Prodotto 3D & Materiali PBR',
          subtitle: 'Ispezione orbitale WebGL in tempo reale, varianti finitura e preventivo istantaneo',
          navItems: ['Vista 3D', 'Materiali PBR', 'Illuminazione HDRI', 'Preventivo'],
          kpis: [
            { label: 'Frame Rate Viewport', value: '60 FPS', trend: 'WebGL2 PBR Attivo' },
            { label: 'Variante Selezionata', value: 'Titanio Anodizzato', trend: 'Disponibilità immediata' },
            { label: 'Prezzo Configurato', value: '€ 1.890,00', trend: 'Consegna 48h' },
          ],
          formTitle: 'Parametri Configurazione & Ordine',
          formFields: [
            {
              name: 'finituraScocca',
              label: 'Finitura Materiale 3D',
              controlType: 'select',
              placeholder: 'Titanio Spazzolato | Carbonio Opaco | Ciano Cromo',
            },
            {
              name: 'incisioneCustom',
              label: 'Incisione Laser Personalizzata',
              controlType: 'text-input',
              placeholder: 'Es. STUDIO EDITION 01',
            },
          ],
          primaryActionLabel: 'Applica & Salva Configurazione',
          primaryHandlerFn: 'onApplyThreeConfig',
          secondaryActionLabel: 'Esporta GLTF',
          tableTitle: 'Specifiche Componenti 3D',
          tableColumns: ['Modulo', 'Materiale', 'Roughness', 'Prezzo'],
          tableRows: [
            ['Telaio Unibody', 'Titanio Grado 5', '0.24', '€ 1.190'],
            ['Ottica Frontale', 'Vetro Zaffiro AR', '0.05', '€ 420'],
            ['Modulo Sensore', 'Alluminio CNC', '0.32', '€ 280'],
          ],
        },
      ],
      handlersTs: `// Logica Configuratore 3D & Sincronizzazione Scena Three.js
export function onApplyThreeConfig(options?: Record<string, unknown>) {
  console.log('[Configuratore 3D] Materiale e parametri aggiornati:', options ?? { preset: 'Titanio' });
  return { applied: true, timestamp: Date.now() };
}

export function onPrimaryActionClick(): void {
  onApplyThreeConfig();
}
`,
    };
  }

  if (isHtmxSearch) {
    const projectName = req.projectName?.trim() || 'Catalogo Live Ricerca HTMX';
    return {
      projectName,
      paletteId: 'ocean-blue',
      defaultThemeMode: 'dark',
      includeThreeScene: false,
      summary: `Applicazione hypermedia reattiva "${projectName}" con filtri istantanei, metriche inventario e inserimento rapido.`,
      screens: [
        {
          name: 'CatalogoRicercaLive',
          title: 'Ricerca Live & Inventario Hypermedia',
          subtitle: 'Aggiornamento parziale DOM ad altissima velocità con filtri multi-criterio e stato giacenze',
          navItems: ['Catalogo Live', 'Giacenze Critiche', 'Fornitori', 'Movimenti'],
          kpis: [
            { label: 'Articoli Indicizzati', value: '12.480 SKU', trend: 'Latenza media 6ms' },
            { label: 'Disponibilità Pronta', value: '96,4%', trend: '+2,1% riassortimento' },
            { label: 'Ordini Evasi Oggi', value: '318 Spedizioni', trend: '100% in orario' },
          ],
          formTitle: 'Filtro Rapido & Nuovo Articolo SKU',
          formFields: [
            {
              name: 'queryRicerca',
              label: 'Cerca Codice SKU o Descrizione',
              controlType: 'text-input',
              placeholder: 'Digita codice, categoria o marca...',
            },
            {
              name: 'magazzino',
              label: 'Deposito Logistico',
              controlType: 'select',
              placeholder: 'Hub Milano Nord | Hub Bologna | Tutti',
            },
            {
              name: 'prezzoUnitario',
              label: 'Prezzo Listino (€)',
              controlType: 'text-input',
              placeholder: '149,00',
            },
          ],
          primaryActionLabel: 'Filtra / Registra SKU',
          primaryHandlerFn: 'onFilterOrSaveSku',
          secondaryActionLabel: 'Sincronizza Giacenze',
          tableTitle: 'Risultati Inventario in Tempo Reale',
          tableColumns: ['SKU', 'Articolo', 'Reparto', 'Giacenza', 'Prezzo'],
          tableRows: [
            ['SKU-9041', 'Sensore Ottico Industriale M18', 'Automazione', '142 pz', '€ 189,00'],
            ['SKU-4420', 'Controller PLC Ethernet Din-Rail', 'Quadri Elettrici', '38 pz', '€ 410,00'],
            ['SKU-7712', 'Alimentatore Stabilizzato 24V 10A', 'Energia', '95 pz', '€ 78,50'],
            ['SKU-3109', 'Pannello Operatore Touch 7"', 'HMI', '19 pz', '€ 329,00'],
          ],
        },
      ],
      handlersTs: `// Handler ricerca live e aggiornamento SKU
export function onFilterOrSaveSku(query?: Record<string, unknown>) {
  console.log('[Catalogo HTMX] Filtro / aggiornamento inventario eseguito:', query ?? {});
  return { matched: 4, updatedAt: new Date().toISOString() };
}

export function onPrimaryActionClick(): void {
  onFilterOrSaveSku();
}
`,
    };
  }

  // General / KPI / Custom Prompt Synthesis
  const inferredTitle =
    req.projectName?.trim() ||
    (prompt.length > 3
      ? prompt
          .replace(/^(crea|genera|costruisci|realizza|fai)\s+(un|una|un'|il|lo|la)?\s*/i, '')
          .split(/[.,;:\n]/)[0]
          .trim()
          .slice(0, 42)
          .replace(/^\w/, (c) => c.toUpperCase())
      : 'Dashboard Operativa KPI & Ordini');

  const projectName = inferredTitle || 'Dashboard Operativa Studio';

  return {
    projectName,
    paletteId,
    defaultThemeMode,
    includeThreeScene: false,
    summary: `Progetto applicativo "${projectName}" progettato sui requisiti richiesti: "${prompt.slice(0, 140) || 'Dashboard operativa con metriche, modulo inserimento e tabella dati'}".`,
    screens: [
      {
        name: 'DashboardPrincipale',
        title: projectName,
        subtitle: prompt.slice(0, 110) || 'Pannello operativo con indicatori KPI in tempo reale, azioni rapide e registro attività',
        navItems: ['Panoramica', 'Operatività', 'Anagrafiche', 'Impostazioni'],
        kpis: [
          { label: 'Operazioni Completate', value: '1.284', trend: '+18,5% questa settimana' },
          { label: 'Valore Operativo Netto', value: '€ 82.450', trend: '+11,2% su obiettivo' },
          { label: 'Efficienza Flusso SLA', value: '98,7%', trend: 'Ottimo — 0 blocchi' },
        ],
        formTitle: 'Nuova Operazione / Inserimento Rapido',
        formFields: [
          {
            name: 'titoloVoce',
            label: 'Titolo / Riferimento Operazione',
            controlType: 'text-input',
            placeholder: 'Inserisci riferimento o cliente...',
          },
          {
            name: 'prioritaCategoria',
            label: 'Categoria & Priorità',
            controlType: 'select',
            placeholder: 'Alta Priorità | Standard | Programmata',
          },
          {
            name: 'valoreStimato',
            label: 'Importo / Quantità',
            controlType: 'text-input',
            placeholder: '1.200,00',
          },
        ],
        primaryActionLabel: 'Registra Operazione',
        primaryHandlerFn: 'onRegisterOperation',
        secondaryActionLabel: 'Esporta Report',
        tableTitle: 'Elenco Operazioni & Attività Recenti',
        tableColumns: ['ID', 'Descrizione', 'Responsabile', 'Valore', 'Stato'],
        tableRows: [
          ['OP-1042', 'Fornitura Enterprise Lotto A', 'M. Ferri', '€ 12.400', 'Completato'],
          ['OP-1043', 'Rinnovo Contratto Assistenza', 'L. Conti', '€ 4.800', 'In Corso'],
          ['OP-1044', 'Spedizione Urgente Magazzino 2', 'G. Riva', '€ 2.190', 'Verificato'],
          ['OP-1045', 'Collaudo Modulo Produzione', 'E. Galli', '€ 7.650', 'Completato'],
        ],
      },
      {
        name: 'DettaglioAnalisi',
        title: `${projectName} — Analisi & Configurazione`,
        subtitle: 'Parametri avanzati di filtraggio, soglie di notifica e riepilogo mensile',
        navItems: ['Panoramica', 'Operatività', 'Analisi Storica', 'Impostazioni'],
        kpis: [
          { label: 'Media Giornaliera', value: '64 Pratiche', trend: '+6,4% trend 30gg' },
          { label: 'Tempo Medio Gestione', value: '14 min', trend: '-3 min ottimizzato' },
          { label: 'Utenti Operativi', value: '18 Operatori', trend: 'Tutti sincronizzati' },
        ],
        formTitle: 'Configurazione Regole & Soglie',
        formFields: [
          {
            name: 'sogliaAvviso',
            label: 'Soglia Notifica Automatica',
            controlType: 'text-input',
            placeholder: 'Es. € 5.000,00',
          },
          {
            name: 'canaleReport',
            label: 'Frequenza Esportazione',
            controlType: 'select',
            placeholder: 'Giornaliera Automatica | Settimanale',
          },
        ],
        primaryActionLabel: 'Salva Configurazione',
        primaryHandlerFn: 'onSaveConfigRules',
        secondaryActionLabel: 'Ripristina Default',
        tableTitle: 'Storico Esportazioni & Audit',
        tableColumns: ['Data', 'Operatore', 'Azione', 'Esito'],
        tableRows: [
          ['18/11/2026 08:15', 'Sistema AI', 'Inizializzazione architettura progetto', 'OK'],
          ['17/11/2026 18:30', 'Amministratore', 'Verifica regole e permessi', 'OK'],
        ],
      },
    ],
    handlersTs: `// Modulo TypeScript generato per ${projectName}
export function onRegisterOperation(data?: Record<string, unknown>) {
  const id = \`OP-\${Math.floor(1050 + Math.random() * 900)}\`;
  console.log(\`[\${id}] Nuova operazione registrata:\`, data ?? {});
  return { id, status: 'Completato', createdAt: Date.now() };
}

export function onSaveConfigRules(rules?: Record<string, unknown>): boolean {
  console.log('[Configurazione] Soglie aggiornate:', rules ?? {});
  return true;
}

export function onPrimaryActionClick(): void {
  onRegisterOperation();
}
`,
  };
}

export function sanitizeAiBlueprint(
  raw: unknown,
  req: GenerateProjectWithAiRequest,
): AiProjectArchitectureBlueprint {
  const fallback = buildDomainSmartBlueprint(req);
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, any>;

  const projectName =
    req.projectName?.trim() ||
    (typeof obj.projectName === 'string' && obj.projectName.trim() ? obj.projectName.trim().slice(0, 64) : fallback.projectName);

  const paletteId: WizardPaletteId =
    typeof obj.paletteId === 'string' && VALID_PALETTES.has(obj.paletteId as WizardPaletteId)
      ? (obj.paletteId as WizardPaletteId)
      : fallback.paletteId;

  const defaultThemeMode: 'dark' | 'light' =
    obj.defaultThemeMode === 'light' || paletteId === 'clean-light' ? 'light' : 'dark';

  const includeThreeScene =
    typeof obj.includeThreeScene === 'boolean' ? obj.includeThreeScene : fallback.includeThreeScene;

  const rawScreens = Array.isArray(obj.screens) ? obj.screens.slice(0, 3) : [];
  const screens: AiBlueprintScreenSpec[] =
    rawScreens.length > 0
      ? rawScreens.map((s: any, idx: number) => {
          const fbScreen = fallback.screens[idx % fallback.screens.length];
          const kpis: AiBlueprintKpiSpec[] =
            Array.isArray(s?.kpis) && s.kpis.length > 0
              ? s.kpis.slice(0, 3).map((k: any, kIdx: number) => ({
                  label: String(k?.label || fbScreen.kpis[kIdx % fbScreen.kpis.length].label),
                  value: String(k?.value || fbScreen.kpis[kIdx % fbScreen.kpis.length].value),
                  trend: String(k?.trend || fbScreen.kpis[kIdx % fbScreen.kpis.length].trend),
                }))
              : fbScreen.kpis;

          while (kpis.length < 3) {
            kpis.push(fbScreen.kpis[kpis.length % fbScreen.kpis.length]);
          }

          const formFields: AiBlueprintFormFieldSpec[] =
            Array.isArray(s?.formFields) && s.formFields.length > 0
              ? s.formFields.slice(0, 4).map((f: any, fIdx: number) => {
                  const ct = f?.controlType;
                  const validCt =
                    ct === 'text-input' || ct === 'select' || ct === 'checkbox' || ct === 'textarea'
                      ? ct
                      : 'text-input';
                  return {
                    name: sanitizeIdentifier(String(f?.name || ''), `field_${fIdx + 1}`),
                    label: String(f?.label || `Campo ${fIdx + 1}`),
                    controlType: validCt,
                    placeholder: String(f?.placeholder || 'Inserisci valore...'),
                  };
                })
              : fbScreen.formFields;

          const tableColumns: string[] =
            Array.isArray(s?.tableColumns) && s.tableColumns.length >= 2
              ? s.tableColumns.slice(0, 5).map((c: any) => String(c))
              : fbScreen.tableColumns;

          const tableRows: string[][] =
            Array.isArray(s?.tableRows) && s.tableRows.length > 0
              ? s.tableRows.slice(0, 5).map((r: any) =>
                  Array.isArray(r) ? r.slice(0, tableColumns.length).map((cell: any) => String(cell)) : fbScreen.tableRows[0],
                )
              : fbScreen.tableRows;

          return {
            name: sanitizeScreenName(String(s?.name || ''), idx),
            title: String(s?.title || projectName),
            subtitle: String(s?.subtitle || fbScreen.subtitle),
            navItems:
              Array.isArray(s?.navItems) && s.navItems.length > 0
                ? s.navItems.slice(0, 5).map((n: any) => String(n))
                : fbScreen.navItems,
            kpis,
            formTitle: String(s?.formTitle || fbScreen.formTitle),
            formFields,
            primaryActionLabel: String(s?.primaryActionLabel || fbScreen.primaryActionLabel),
            primaryHandlerFn: sanitizeIdentifier(String(s?.primaryHandlerFn || ''), fbScreen.primaryHandlerFn),
            secondaryActionLabel: String(s?.secondaryActionLabel || fbScreen.secondaryActionLabel),
            tableTitle: String(s?.tableTitle || fbScreen.tableTitle),
            tableColumns,
            tableRows,
          };
        })
      : fallback.screens;

  // Ensure handlersTs exports every screen's primaryHandlerFn + onPrimaryActionClick
  let handlersTs =
    typeof obj.handlersTs === 'string' && obj.handlersTs.trim().length > 20
      ? obj.handlersTs.trim() + '\n'
      : fallback.handlersTs;

  for (const sc of screens) {
    if (!handlersTs.includes(`function ${sc.primaryHandlerFn}`) && !handlersTs.includes(`const ${sc.primaryHandlerFn}`)) {
      handlersTs += `\nexport function ${sc.primaryHandlerFn}(payload?: Record<string, unknown>) {\n  console.log('[${sc.name}] ${sc.primaryActionLabel}:', payload ?? {});\n  return { ok: true, timestamp: Date.now() };\n}\n`;
    }
  }
  if (!handlersTs.includes('onPrimaryActionClick')) {
    handlersTs += `\nexport function onPrimaryActionClick(): void {\n  ${screens[0].primaryHandlerFn}();\n}\n`;
  }

  return {
    projectName,
    paletteId,
    defaultThemeMode,
    includeThreeScene,
    summary: typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : fallback.summary,
    screens,
    handlersTs,
  };
}

// ============================================================================
// UI-IR MULTI-SCREEN COMPILER (NON-OVERLAPPING FREEFORM (X,Y) OR AUTO-LAYOUT)
// ============================================================================

function buildScreenSheetFromSpec(params: {
  projectId: string;
  sheetId: string;
  spec: AiBlueprintScreenSpec;
  layoutMode: 'freeform' | 'auto';
  primaryTarget: CodegenTargetId;
  isDark: boolean;
  primaryColor: string;
  accentColor: string;
  canvasBg: string;
  surfaceBg: string;
  threeSceneId?: string;
  blueprintId?: string;
}): UISheetDocument {
  const {
    projectId,
    sheetId,
    spec,
    layoutMode,
    primaryTarget,
    isDark,
    primaryColor,
    accentColor,
    canvasBg,
    surfaceBg,
    threeSceneId,
    blueprintId,
  } = params;

  const isFreeform = layoutMode === 'freeform';
  const textPrimary = isDark ? '#f8fafc' : '#0f172a';
  const textSecondary = isDark ? '#94a3b8' : '#475569';
  const borderSubtle = isDark ? '#1e293b' : '#e2e8f0';
  const inputBg = isDark ? '#0b1220' : '#f8fafc';

  const nodes: Record<string, UINode> = {};
  const registerNode = (node: UINode): string => {
    nodes[node.id] = node;
    return node.id;
  };

  type RelaxedNodeInput = Omit<Partial<UINode>, 'layout' | 'typography' | 'name' | 'kind'> &
    Pick<UINode, 'name' | 'kind'> & {
      layout?: Partial<UINode['layout']>;
      typography?: Partial<NonNullable<UINode['typography']>>;
    };

  const makeNode = (partial: RelaxedNodeInput, sid: string): UINode => {
    const base = createDefaultUINode({ name: partial.name, kind: partial.kind }, sid);
    return createDefaultUINode(
      {
        ...partial,
        layout: partial.layout
          ? {
              ...base.layout,
              ...partial.layout,
              frame: partial.layout.frame ?? base.layout.frame,
              width: partial.layout.width ?? base.layout.width,
              height: partial.layout.height ?? base.layout.height,
              padding: partial.layout.padding ?? base.layout.padding,
            }
          : undefined,
        typography: partial.typography
          ? {
              fontFamily: { $token: 'font.sans' },
              fontSize: 14,
              fontWeight: 400,
              color: textPrimary,
              ...partial.typography,
            }
          : undefined,
      },
      sid,
    );
  };

  const artId = `art_${sheetId}`;
  const navId = `nd_nav_${sheetId}`;
  const brandId = `nd_brand_${sheetId}`;
  const navPillsRowId = `nd_nav_pills_${sheetId}`;
  const secBtnId = `nd_sec_btn_${sheetId}`;
  const headingId = `nd_h1_${sheetId}`;
  const subtitleId = `nd_sub_${sheetId}`;
  const formCardId = `nd_form_${sheetId}`;
  const formTitleId = `nd_form_title_${sheetId}`;
  const ctaBtnId = `nd_cta_${sheetId}`;
  const dataCardId = `nd_data_${sheetId}`;
  const dataTitleId = `nd_data_title_${sheetId}`;
  const dataRowsColId = `nd_data_rows_${sheetId}`;
  const threeNodeId = `nd_three_${sheetId}`;

  // 1. Navbar children
  const navPillIds: string[] = spec.navItems.slice(0, 4).map((item, idx) =>
    registerNode(
      makeNode(
        {
          id: `nd_nav_item_${sheetId}_${idx}`,
          parentId: navPillsRowId,
          kind: 'control',
          name: `NavTab_${idx + 1}`,
          semanticTag: 'button',
          sortOrder: fractionalOrderAt(idx),
          layout: {
            mode: 'flex',
            positioning: 'flow',
            width: { mode: 'hug', value: 110 },
            height: { mode: 'fixed', value: 32 },
            padding: { top: 6, right: 14, bottom: 6, left: 14 },
          },
          style: {
            fills: [{ type: 'solid', color: idx === 0 ? primaryColor : 'transparent' }],
            border: idx === 0 ? undefined : { width: 1, style: 'solid', color: borderSubtle },
            radius: 8,
          },
          typography: {
            fontFamily: { $token: 'font.sans' },
            fontSize: 12,
            fontWeight: idx === 0 ? 600 : 500,
            color: idx === 0 ? '#ffffff' : textSecondary,
          },
          content: { controlType: 'button', text: item },
        },
        sheetId,
      ),
    ),
  );

  registerNode(
    makeNode(
      {
        id: brandId,
        parentId: navId,
        kind: 'text',
        name: 'NavbarBrandTitle',
        semanticTag: 'h3',
        layout: {
          mode: 'flex',
          positioning: 'flow',
          width: { mode: 'hug', value: 240 },
          height: { mode: 'hug', value: 24 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 15,
          fontWeight: 700,
          color: textPrimary,
        },
        content: { text: spec.title.slice(0, 34) },
      },
      sheetId,
    ),
  );

  registerNode(
    makeNode(
      {
        id: navPillsRowId,
        parentId: navId,
        kind: 'container',
        name: 'NavbarLinksGroup',
        semanticTag: 'nav',
        childIds: navPillIds,
        layout: {
          mode: 'flex',
          positioning: 'flow',
          direction: 'row',
          gap: 8,
          align: 'center',
          width: { mode: 'hug', value: 460 },
          height: { mode: 'hug', value: 34 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: { fills: [] },
      },
      sheetId,
    ),
  );

  registerNode(
    makeNode(
      {
        id: secBtnId,
        parentId: navId,
        kind: 'control',
        name: 'SecondaryToolbarAction',
        semanticTag: 'button',
        layout: {
          mode: 'flex',
          positioning: 'flow',
          width: { mode: 'hug', value: 148 },
          height: { mode: 'fixed', value: 34 },
          padding: { top: 6, right: 14, bottom: 6, left: 14 },
        },
        style: {
          fills: [{ type: 'solid', color: inputBg }],
          border: { width: 1, style: 'solid', color: borderSubtle },
          radius: 8,
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 12,
          fontWeight: 600,
          color: textPrimary,
        },
        content: { controlType: 'button', text: spec.secondaryActionLabel },
      },
      sheetId,
    ),
  );

  registerNode(
    makeNode(
      {
        id: navId,
        parentId: artId,
        kind: 'container',
        name: 'TopNavigationHeader',
        semanticTag: 'header',
        childIds: [brandId, navPillsRowId, secBtnId],
        layout: {
          mode: 'flex',
          positioning: isFreeform ? 'absolute' : 'flow',
          direction: 'row',
          justify: 'space-between',
          align: 'center',
          gap: 16,
          frame: { x: 32, y: 24, width: 1176, height: 58 },
          width: isFreeform ? { mode: 'fixed', value: 1176 } : { mode: 'fill' },
          height: { mode: 'fixed', value: 58 },
          padding: { top: 10, right: 20, bottom: 10, left: 20 },
        },
        style: {
          fills: [{ type: 'solid', color: surfaceBg }],
          border: { width: 1, style: 'solid', color: borderSubtle },
          radius: 12,
          zIndex: 1,
        },
      },
      sheetId,
    ),
  );

  // 2. Hero Heading & Subtitle
  registerNode(
    makeNode(
      {
        id: headingId,
        parentId: artId,
        kind: 'text',
        name: 'ScreenMainHeading',
        semanticTag: 'h1',
        layout: {
          mode: 'flex',
          positioning: isFreeform ? 'absolute' : 'flow',
          frame: { x: 32, y: 100, width: 920, height: 36 },
          width: isFreeform ? { mode: 'fixed', value: 920 } : { mode: 'fill' },
          height: { mode: 'hug', value: 36 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 24,
          fontWeight: 700,
          color: textPrimary,
        },
        content: { text: spec.title },
      },
      sheetId,
    ),
  );

  registerNode(
    makeNode(
      {
        id: subtitleId,
        parentId: artId,
        kind: 'text',
        name: 'ScreenSubtitle',
        semanticTag: 'p',
        layout: {
          mode: 'flex',
          positioning: isFreeform ? 'absolute' : 'flow',
          frame: { x: 32, y: 140, width: 960, height: 24 },
          width: isFreeform ? { mode: 'fixed', value: 960 } : { mode: 'fill' },
          height: { mode: 'hug', value: 24 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        typography: {
          fontFamily: { $token: 'font.sans' },
          fontSize: 14,
          fontWeight: 400,
          color: textSecondary,
        },
        content: { text: spec.subtitle },
      },
      sheetId,
    ),
  );

  // 3. Three KPI Metric Cards
  const kpiRowId = `nd_kpi_row_${sheetId}`;
  const kpiCardIds: string[] = spec.kpis.slice(0, 3).map((kpi, idx) => {
    const cardId = `nd_kpi_${sheetId}_${idx}`;
    const lblId = `nd_kpi_lbl_${sheetId}_${idx}`;
    const valId = `nd_kpi_val_${sheetId}_${idx}`;
    const trdId = `nd_kpi_trd_${sheetId}_${idx}`;

    registerNode(
      makeNode(
        {
          id: lblId,
          parentId: cardId,
          kind: 'text',
          name: `KpiLabel_${idx + 1}`,
          semanticTag: 'span',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            width: { mode: 'fill' },
            height: { mode: 'hug', value: 18 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          typography: { fontSize: 12, fontWeight: 500, color: textSecondary },
          content: { text: kpi.label },
        },
        sheetId,
      ),
    );

    registerNode(
      makeNode(
        {
          id: valId,
          parentId: cardId,
          kind: 'text',
          name: `KpiValue_${idx + 1}`,
          semanticTag: 'h2',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            width: { mode: 'fill' },
            height: { mode: 'hug', value: 30 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          typography: { fontSize: 22, fontWeight: 700, color: textPrimary },
          content: { text: kpi.value },
        },
        sheetId,
      ),
    );

    registerNode(
      makeNode(
        {
          id: trdId,
          parentId: cardId,
          kind: 'control',
          name: `KpiTrend_${idx + 1}`,
          semanticTag: 'span',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            width: { mode: 'hug', value: 140 },
            height: { mode: 'hug', value: 22 },
            padding: { top: 3, right: 8, bottom: 3, left: 8 },
          },
          style: {
            fills: [{ type: 'solid', color: `${accentColor}22` }],
            radius: 6,
          },
          typography: { fontSize: 11, fontWeight: 600, color: accentColor },
          content: { controlType: 'badge', text: kpi.trend },
        },
        sheetId,
      ),
    );

    return registerNode(
      makeNode(
        {
          id: cardId,
          parentId: isFreeform ? artId : kpiRowId,
          kind: 'container',
          name: `KpiMetricCard_${idx + 1}`,
          semanticTag: 'article',
          childIds: [lblId, valId, trdId],
          layout: {
            mode: 'flex',
            positioning: isFreeform ? 'absolute' : 'flow',
            direction: 'column',
            gap: 6,
            frame: { x: 32 + idx * 400, y: 182, width: 376, height: 116 },
            width: isFreeform ? { mode: 'fixed', value: 376 } : { mode: 'fill' },
            height: { mode: 'fixed', value: 116 },
            padding: { top: 16, right: 18, bottom: 16, left: 18 },
          },
          style: {
            fills: [{ type: 'solid', color: surfaceBg }],
            border: { width: 1, style: 'solid', color: borderSubtle },
            radius: 12,
            zIndex: 2,
          },
        },
        sheetId,
      ),
    );
  });

  if (!isFreeform) {
    registerNode(
      makeNode(
        {
          id: kpiRowId,
          parentId: artId,
          kind: 'container',
          name: 'KpiMetricsRow',
          semanticTag: 'section',
          childIds: kpiCardIds,
          layout: {
            mode: 'flex',
            positioning: 'flow',
            direction: 'row',
            gap: 16,
            width: { mode: 'fill' },
            height: { mode: 'hug', value: 116 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: { fills: [] },
        },
        sheetId,
      ),
    );
  }

  // 4. Domain Form Card (Inputs + Primary CTA wired to Script & HTMX)
  const splitMainRowId = `nd_main_split_${sheetId}`;
  const formChildIds: string[] = [formTitleId];

  registerNode(
    makeNode(
      {
        id: formTitleId,
        parentId: formCardId,
        kind: 'text',
        name: 'FormSectionHeading',
        semanticTag: 'h3',
        layout: {
          mode: 'flex',
          positioning: 'flow',
          width: { mode: 'fill' },
          height: { mode: 'hug', value: 24 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        typography: { fontSize: 16, fontWeight: 700, color: textPrimary },
        content: { text: spec.formTitle },
      },
      sheetId,
    ),
  );

  spec.formFields.slice(0, 4).forEach((field, fIdx) => {
    const fldWrapId = `nd_fld_wrap_${sheetId}_${fIdx}`;
    const fldLblId = `nd_fld_lbl_${sheetId}_${fIdx}`;
    const fldCtrlId = `nd_fld_ctrl_${sheetId}_${fIdx}`;

    registerNode(
      makeNode(
        {
          id: fldLblId,
          parentId: fldWrapId,
          kind: 'text',
          name: `${field.name}Label`,
          semanticTag: 'label',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            width: { mode: 'fill' },
            height: { mode: 'hug', value: 18 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          typography: { fontSize: 12, fontWeight: 600, color: textSecondary },
          content: { text: field.label },
        },
        sheetId,
      ),
    );

    const ctrlSubtype: UIControlSubtype = field.controlType;
    registerNode(
      makeNode(
        {
          id: fldCtrlId,
          parentId: fldWrapId,
          kind: 'control',
          name: `${field.name}Control`,
          semanticTag: field.controlType === 'select' ? 'select' : field.controlType === 'textarea' ? 'textarea' : 'input',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            width: { mode: 'fill' },
            height: { mode: 'fixed', value: field.controlType === 'textarea' ? 68 : 38 },
            padding: { top: 8, right: 12, bottom: 8, left: 12 },
          },
          style: {
            fills: [{ type: 'solid', color: inputBg }],
            border: { width: 1, style: 'solid', color: borderSubtle },
            radius: 8,
          },
          typography: { fontSize: 13, fontWeight: 400, color: textPrimary },
          content: {
            controlType: ctrlSubtype,
            placeholder: field.placeholder,
            text: field.controlType === 'checkbox' ? field.placeholder : undefined,
          },
          platform:
            primaryTarget === 'htmx' && fIdx === 0
              ? {
                  htmx: {
                    method: 'hx-get',
                    endpoint: `/api/${spec.name.toLowerCase()}/search`,
                    targetNodeId: dataRowsColId,
                    hxSwap: 'innerHTML',
                    hxTrigger: 'keyup changed delay:250ms',
                  },
                }
              : undefined,
        },
        sheetId,
      ),
    );

    registerNode(
      makeNode(
        {
          id: fldWrapId,
          parentId: formCardId,
          kind: 'container',
          name: `${field.name}FieldGroup`,
          semanticTag: 'div',
          childIds: [fldLblId, fldCtrlId],
          layout: {
            mode: 'flex',
            positioning: 'flow',
            direction: 'column',
            gap: 5,
            width: { mode: 'fill' },
            height: { mode: 'hug', value: 62 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: { fills: [] },
        },
        sheetId,
      ),
    );
    formChildIds.push(fldWrapId);
  });

  registerNode(
    makeNode(
      {
        id: ctaBtnId,
        parentId: formCardId,
        kind: 'control',
        name: 'PrimarySubmitButton',
        semanticTag: 'button',
        layout: {
          mode: 'flex',
          positioning: 'flow',
          width: { mode: 'fill' },
          height: { mode: 'fixed', value: 42 },
          padding: { top: 10, right: 18, bottom: 10, left: 18 },
        },
        style: {
          fills: [{ type: 'solid', color: primaryColor }],
          radius: 10,
        },
        typography: {
          fontSize: 14,
          fontWeight: 600,
          color: '#ffffff',
          textAlign: 'center',
        },
        content: {
          controlType: 'button',
          text: spec.primaryActionLabel,
          iconName: 'sparkles',
          blueprintId,
        },
        interactions: [
          {
            trigger: 'onClick',
            action: { kind: 'call_script_fn', fnName: spec.primaryHandlerFn },
          },
          ...(blueprintId
            ? [
                {
                  trigger: 'onClick' as const,
                  action: { kind: 'trigger_blueprint' as const, blueprintId, eventName: 'event_ui_click' },
                },
              ]
            : []),
        ],
        platform:
          primaryTarget === 'htmx'
            ? {
                htmx: {
                  method: 'hx-post',
                  endpoint: `/api/${spec.name.toLowerCase()}/submit`,
                  targetNodeId: dataRowsColId,
                  hxSwap: 'afterbegin',
                },
              }
            : undefined,
      },
      sheetId,
    ),
  );
  formChildIds.push(ctaBtnId);

  registerNode(
    makeNode(
      {
        id: formCardId,
        parentId: isFreeform ? artId : splitMainRowId,
        kind: 'container',
        name: 'OperationalFormCard',
        semanticTag: 'form',
        childIds: formChildIds,
        layout: {
          mode: 'flex',
          positioning: isFreeform ? 'absolute' : 'flow',
          direction: 'column',
          gap: 14,
          frame: { x: 32, y: 320, width: 496, height: 472 },
          width: isFreeform ? { mode: 'fixed', value: 496 } : { mode: 'fixed', value: 440 },
          height: isFreeform ? { mode: 'fixed', value: 472 } : { mode: 'hug', value: 440 },
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
        },
        style: {
          fills: [{ type: 'solid', color: surfaceBg }],
          border: { width: 1, style: 'solid', color: borderSubtle },
          radius: 14,
          zIndex: 3,
        },
      },
      sheetId,
    ),
  );

  // 5. Right Column: Data Table / Records Card (+ Optional 3D Viewport)
  const hasThreeOnScreen = Boolean(threeSceneId);
  const dataTableHeight = hasThreeOnScreen ? 228 : 472;
  const dataTableY = hasThreeOnScreen ? 564 : 320;

  if (hasThreeOnScreen && threeSceneId) {
    registerNode(
      makeNode(
        {
          id: threeNodeId,
          parentId: isFreeform ? artId : splitMainRowId,
          kind: 'control',
          name: 'InteractiveThreeViewport',
          semanticTag: 'div',
          layout: {
            mode: 'freeform',
            positioning: isFreeform ? 'absolute' : 'flow',
            frame: { x: 552, y: 320, width: 656, height: 228 },
            width: isFreeform ? { mode: 'fixed', value: 656 } : { mode: 'fill' },
            height: { mode: 'fixed', value: 228 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: {
            fills: [{ type: 'solid', color: '#090d16' }],
            border: { width: 1, style: 'solid', color: primaryColor },
            radius: 14,
            zIndex: 3,
          },
          content: {
            controlType: 'three-viewport',
            text: 'Viewport 3D Interattivo Three.js',
            threeSceneId,
          },
        },
        sheetId,
      ),
    );
  }

  // Table header + rows inside Data Card
  const headerRowId = `nd_tbl_hdr_${sheetId}`;
  const headerCellIds = spec.tableColumns.map((colText, cIdx) =>
    registerNode(
      makeNode(
        {
          id: `nd_tbl_hcell_${sheetId}_${cIdx}`,
          parentId: headerRowId,
          kind: 'text',
          name: `ColHeader_${cIdx + 1}`,
          semanticTag: 'span',
          layout: {
            mode: 'flex',
            positioning: 'flow',
            width: { mode: 'fill' },
            height: { mode: 'hug', value: 18 },
            padding: { top: 0, right: 4, bottom: 0, left: 4 },
          },
          typography: { fontSize: 11, fontWeight: 700, color: textSecondary },
          content: { text: colText.toUpperCase() },
        },
        sheetId,
      ),
    ),
  );

  registerNode(
    makeNode(
      {
        id: headerRowId,
        parentId: dataCardId,
        kind: 'container',
        name: 'DataTableHeaderRow',
        semanticTag: 'div',
        childIds: headerCellIds,
        layout: {
          mode: 'flex',
          positioning: 'flow',
          direction: 'row',
          justify: 'space-between',
          align: 'center',
          gap: 8,
          width: { mode: 'fill' },
          height: { mode: 'fixed', value: 32 },
          padding: { top: 6, right: 10, bottom: 6, left: 10 },
        },
        style: {
          fills: [{ type: 'solid', color: inputBg }],
          radius: 8,
        },
      },
      sheetId,
    ),
  );

  const maxRows = hasThreeOnScreen ? 2 : 4;
  const rowNodeIds = spec.tableRows.slice(0, maxRows).map((rowCells, rIdx) => {
    const rId = `nd_tbl_row_${sheetId}_${rIdx}`;
    const cellIds = spec.tableColumns.map((_, cIdx) => {
      const val = rowCells[cIdx] ?? '—';
      const isLastCol = cIdx === spec.tableColumns.length - 1;
      return registerNode(
        makeNode(
          {
            id: `nd_tbl_cell_${sheetId}_${rIdx}_${cIdx}`,
            parentId: rId,
            kind: isLastCol ? 'control' : 'text',
            name: `Cell_${rIdx + 1}_${cIdx + 1}`,
            semanticTag: 'span',
            layout: {
              mode: 'flex',
              positioning: 'flow',
              width: isLastCol ? { mode: 'hug', value: 96 } : { mode: 'fill' },
              height: { mode: 'hug', value: 22 },
              padding: isLastCol
                ? { top: 2, right: 8, bottom: 2, left: 8 }
                : { top: 0, right: 4, bottom: 0, left: 4 },
            },
            style: isLastCol
              ? {
                  fills: [{ type: 'solid', color: `${primaryColor}22` }],
                  radius: 6,
                }
              : { fills: [] },
            typography: {
              fontSize: 12,
              fontWeight: cIdx === 0 || isLastCol ? 600 : 400,
              color: isLastCol ? primaryColor : textPrimary,
            },
            content: isLastCol ? { controlType: 'badge', text: val } : { text: val },
          },
          sheetId,
        ),
      );
    });

    return registerNode(
      makeNode(
        {
          id: rId,
          parentId: dataRowsColId,
          kind: 'container',
          name: `DataRecordRow_${rIdx + 1}`,
          semanticTag: 'div',
          childIds: cellIds,
          layout: {
            mode: 'flex',
            positioning: 'flow',
            direction: 'row',
            justify: 'space-between',
            align: 'center',
            gap: 8,
            width: { mode: 'fill' },
            height: { mode: 'fixed', value: 40 },
            padding: { top: 8, right: 10, bottom: 8, left: 10 },
          },
          style: {
            fills: [{ type: 'solid', color: inputBg }],
            border: { width: 1, style: 'solid', color: borderSubtle },
            radius: 8,
          },
        },
        sheetId,
      ),
    );
  });

  registerNode(
    makeNode(
      {
        id: dataTitleId,
        parentId: dataCardId,
        kind: 'text',
        name: 'DataTableHeading',
        semanticTag: 'h3',
        layout: {
          mode: 'flex',
          positioning: 'flow',
          width: { mode: 'fill' },
          height: { mode: 'hug', value: 24 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        typography: { fontSize: 16, fontWeight: 700, color: textPrimary },
        content: { text: spec.tableTitle },
      },
      sheetId,
    ),
  );

  registerNode(
    makeNode(
      {
        id: dataRowsColId,
        parentId: dataCardId,
        kind: 'collection',
        name: 'DataTableRecordsRegion',
        semanticTag: 'div',
        childIds: rowNodeIds,
        layout: {
          mode: 'flex',
          positioning: 'flow',
          direction: 'column',
          gap: 8,
          width: { mode: 'fill' },
          height: { mode: 'fill' },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        style: { fills: [] },
      },
      sheetId,
    ),
  );

  registerNode(
    makeNode(
      {
        id: dataCardId,
        parentId: isFreeform ? artId : splitMainRowId,
        kind: 'container',
        name: 'DataRecordsTableCard',
        semanticTag: 'section',
        childIds: [dataTitleId, headerRowId, dataRowsColId],
        layout: {
          mode: 'flex',
          positioning: isFreeform ? 'absolute' : 'flow',
          direction: 'column',
          gap: 12,
          frame: { x: 552, y: dataTableY, width: 656, height: dataTableHeight },
          width: isFreeform ? { mode: 'fixed', value: 656 } : { mode: 'fill' },
          height: isFreeform ? { mode: 'fixed', value: dataTableHeight } : { mode: 'hug', value: 440 },
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
        },
        style: {
          fills: [{ type: 'solid', color: surfaceBg }],
          border: { width: 1, style: 'solid', color: borderSubtle },
          radius: 14,
          zIndex: 3,
        },
      },
      sheetId,
    ),
  );

  let artChildIds: string[];
  if (isFreeform) {
    artChildIds = [
      navId,
      headingId,
      subtitleId,
      ...kpiCardIds,
      formCardId,
      ...(hasThreeOnScreen ? [threeNodeId] : []),
      dataCardId,
    ];
  } else {
    const rightSideChildren = hasThreeOnScreen
      ? [formCardId, threeNodeId, dataCardId]
      : [formCardId, dataCardId];
    registerNode(
      makeNode(
        {
          id: splitMainRowId,
          parentId: artId,
          kind: 'container',
          name: 'WorkspaceOperationalSplit',
          semanticTag: 'section',
          childIds: rightSideChildren,
          layout: {
            mode: 'flex',
            positioning: 'flow',
            direction: 'row',
            align: 'stretch',
            gap: 20,
            width: { mode: 'fill' },
            height: { mode: 'hug', value: 460 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          style: { fills: [] },
        },
        sheetId,
      ),
    );
    artChildIds = [navId, headingId, subtitleId, kpiRowId, splitMainRowId];
  }

  registerNode(
    makeNode(
      {
        id: artId,
        kind: 'artboard',
        name: `${spec.name}Artboard`,
        semanticTag: 'main',
        childIds: artChildIds,
        layout: {
          mode: isFreeform ? 'freeform' : 'flex',
          positioning: 'flow',
          direction: 'column',
          gap: 18,
          justify: 'start',
          align: 'stretch',
          frame: { x: 40, y: 40, width: 1240, height: 824 },
          width: { mode: 'fixed', value: 1240 },
          height: { mode: 'fixed', value: 824 },
          padding: isFreeform
            ? { top: 0, right: 0, bottom: 0, left: 0 }
            : { top: 24, right: 28, bottom: 28, left: 28 },
        },
        style: {
          fills: [{ type: 'solid', color: canvasBg }],
          radius: 14,
        },
      },
      sheetId,
    ),
  );

  return {
    sheetId,
    projectId,
    name: spec.name,
    rootIds: [artId],
    nodes,
    defaultLayoutMode: isFreeform ? 'freeform' : 'flex',
    stateSchema: [{ name: 'recordsCount', type: 'number', initialValue: spec.tableRows.length }],
    propsSchema: [],
    ipcSchema: [],
  };
}

export function compileAiBlueprintToWizardSeed(
  blueprint: AiProjectArchitectureBlueprint,
  req: GenerateProjectWithAiRequest,
  explicitProjectId?: string,
): WizardProjectSeedBundle {
  const projectId =
    explicitProjectId ?? `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const primaryTarget: CodegenTargetId = req.primaryTarget ?? 'react-tsx';
  const stylingPreset: StylingDialect = req.stylingPreset ?? 'tailwind';
  const layoutMode: 'freeform' | 'auto' = req.layoutMode ?? 'freeform';

  const palette =
    WIZARD_PALETTE_PRESETS.find((p) => p.id === blueprint.paletteId) ?? WIZARD_PALETTE_PRESETS[0];
  const isDark = blueprint.defaultThemeMode !== 'light';

  const { lightTheme, darkTheme, all: themes } = createDefaultThemes(projectId);
  const activeThemeId = isDark ? darkTheme.id : lightTheme.id;

  const tokens = createDefaultTokens(projectId, darkTheme.id).map((tok) => {
    const tokIsDark = tok.themeId === darkTheme.id;
    if (tok.tokenPath === 'color.bg.canvas') {
      return { ...tok, rawValue: tokIsDark ? palette.colors.canvasDark : palette.colors.canvasLight };
    }
    if (tok.tokenPath === 'color.bg.surface') {
      return { ...tok, rawValue: tokIsDark ? palette.colors.surfaceDark : palette.colors.surfaceLight };
    }
    if (tok.tokenPath === 'color.primary.500') {
      return { ...tok, rawValue: palette.colors.primary500 };
    }
    if (tok.tokenPath === 'color.primary.600') {
      return { ...tok, rawValue: palette.colors.primary600 };
    }
    if (tok.tokenPath === 'color.accent.500') {
      return { ...tok, rawValue: palette.colors.accent500 };
    }
    return tok;
  });

  const threeSceneDoc = blueprint.includeThreeScene
    ? createThreeSceneFromPreset(projectId, 'pbr-product-showcase')
    : undefined;

  const firstSheetId = `sheet_ai_${projectId.slice(-5)}_0`;
  const blueprintDoc = createStarterBlueprintGraph(
    projectId,
    firstSheetId,
    `nd_cta_${firstSheetId}`,
    `nd_h1_${firstSheetId}`,
  );

  const sheets: UISheetDocument[] = blueprint.screens.map((screenSpec, idx) => {
    const sheetId = idx === 0 ? firstSheetId : `sheet_ai_${projectId.slice(-5)}_${idx}`;
    return buildScreenSheetFromSpec({
      projectId,
      sheetId,
      spec: screenSpec,
      layoutMode,
      primaryTarget,
      isDark,
      primaryColor: palette.colors.primary500,
      accentColor: palette.colors.accent500,
      canvasBg: isDark ? palette.colors.canvasDark : palette.colors.canvasLight,
      surfaceBg: isDark ? palette.colors.surfaceDark : palette.colors.surfaceLight,
      threeSceneId: idx === 0 ? threeSceneDoc?.id : undefined,
      blueprintId: idx === 0 ? blueprintDoc.id : undefined,
    });
  });

  const vfsItems: GeneratedWizardVfsSeedItem[] = [
    { key: 'dir_src', parentKey: null, name: 'src', virtualPath: '/src', entryKind: 'folder' },
    { key: 'dir_screens', parentKey: 'dir_src', name: 'screens', virtualPath: '/src/screens', entryKind: 'folder' },
    { key: 'dir_styles', parentKey: 'dir_src', name: 'styles', virtualPath: '/src/styles', entryKind: 'folder' },
    { key: 'dir_scripts', parentKey: 'dir_src', name: 'scripts', virtualPath: '/src/scripts', entryKind: 'folder' },
    {
      key: 'dir_blueprints',
      parentKey: 'dir_src',
      name: 'blueprints',
      virtualPath: '/src/blueprints',
      entryKind: 'folder',
    },
    { key: 'dir_scenes3d', parentKey: 'dir_src', name: 'scenes3d', virtualPath: '/src/scenes3d', entryKind: 'folder' },
  ];

  for (const sh of sheets) {
    vfsItems.push({
      key: `sheet_${sh.sheetId}`,
      parentKey: 'dir_screens',
      name: `${sh.name}.canvas`,
      virtualPath: `/src/screens/${sh.name}.canvas`,
      entryKind: 'canvas_sheet',
      sheetId: sh.sheetId,
    });
  }

  const firstCss = compileSheetToCss(sheets[0], tokens, activeThemeId).css;
  vfsItems.push({
    key: 'file_main_css',
    parentKey: 'dir_styles',
    name: 'theme-and-sheet.css',
    virtualPath: '/src/styles/theme-and-sheet.css',
    entryKind: 'style_file',
    contentText: firstCss,
  });

  vfsItems.push({
    key: 'file_handlers_ts',
    parentKey: 'dir_scripts',
    name: 'handlers.ts',
    virtualPath: '/src/scripts/handlers.ts',
    entryKind: 'script_file',
    contentText: blueprint.handlersTs,
  });

  vfsItems.push({
    key: 'file_main_bp',
    parentKey: 'dir_blueprints',
    name: `${blueprintDoc.name}.blueprint.json`,
    virtualPath: `/src/blueprints/${blueprintDoc.name}.blueprint.json`,
    entryKind: 'blueprint_graph',
    contentText: JSON.stringify(blueprintDoc, null, 2),
  });

  if (threeSceneDoc) {
    vfsItems.push({
      key: 'file_main_3d',
      parentKey: 'dir_scenes3d',
      name: `${threeSceneDoc.name}.scene3d.json`,
      virtualPath: `/src/scenes3d/${threeSceneDoc.name}.scene3d.json`,
      entryKind: 'three_scene',
      contentText: JSON.stringify(threeSceneDoc, null, 2),
    });
  }

  vfsItems.push({
    key: 'file_readme',
    parentKey: null,
    name: 'README.md',
    virtualPath: '/README.md',
    entryKind: 'source_file',
    contentText: `# ${blueprint.projectName}\n\n${blueprint.summary}\n\n- **Target**: \`${primaryTarget}\` (\`${stylingPreset}\`)\n- **Layout**: \`${layoutMode}\`\n- **Schermate generate**: ${sheets.map((s) => `\`${s.name}\``).join(', ')}\n`,
  });

  return {
    projectId,
    projectName: blueprint.projectName,
    primaryTarget,
    stylingPreset,
    activeThemeId,
    themes,
    tokens,
    sheets,
    blueprintDoc,
    threeSceneDoc,
    vfsItems,
  };
}

// ============================================================================
// STARTUP ASSISTANT CHAT & AI PROJECT GENERATOR EXECUTION
// ============================================================================

const STARTUP_CHAT_SYSTEM_PROMPT = `Sei l'Architetto Software & UI di Visual UI Studio (IDE Visuale Desktop & AI Locale).
Rispondi sempre in italiano chiaro, tecnico, concreto e sintetico.
Aiuti lo sviluppatore nella schermata iniziale a:
1. Progettare l'architettura di nuove applicazioni (schermate, componenti, tabelle dati, form, KPI, navigazione, API, database).
2. Scegliere il miglior target tra i 26 supportati (React + TS, Next.js, HTML5/CSS3, HTMX 2.x, Svelte 5, Vue 3, Angular, Tauri v2, Electron, .NET MAUI, WinUI 3, WPF, Qt6 QML, Flutter, React Native, SwiftUI, Jetpack Compose, Python NiceGUI/PyQt6, Three.js WebGL).
3. Scrivere snippet puliti di codice, CSS, handler TypeScript o logiche Blueprint.
Chiudi sempre suggerendo in 1 riga come trasformare l'idea in un progetto pronto cliccando "Crea Progetto da questa Conversazione".`;

const PROJECT_ARCHITECT_SYSTEM_PROMPT = `Sei l'Architetto UI di Visual UI Studio.
Progetta un'applicazione su misura in italiano basata esattamente sulla richiesta dell'utente.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido conforme allo schema richiesto:
- "projectName": nome professionale e specifico del progetto (se non già imposto dall'utente)
- "paletteId": scegli tra "dark-pro", "clean-light", "ocean-blue", "emerald-studio", "cyberpunk-neon", "warm-corporate"
- "defaultThemeMode": "dark" oppure "light"
- "includeThreeScene": true solo se la richiesta riguarda 3D, WebGL, Three.js, configuratori 3D o showcase prodotto
- "summary": sintesi tecnica in italiano (1-2 frasi)
- "screens": da 1 a 2 schermate operative complete. Ogni schermata DEVE avere:
  - "name": PascalCase senza spazi (es. "CruscottoFatture", "AnagraficaClienti")
  - "title" e "subtitle" realistici in italiano
  - "navItems": 4 voci di menu coerenti col dominio
  - "kpis": esattamente 3 metriche KPI realistiche in italiano (label, value numerico/valuta realistico, trend)
  - "formTitle" e "formFields" (3 campi specifici del dominio con label e placeholder realistici in italiano)
  - "primaryActionLabel" e "primaryHandlerFn" (identificatore camelCase valido, es. "onSaveInvoice")
  - "secondaryActionLabel"
  - "tableTitle", "tableColumns" (4-5 colonne) e "tableRows" (3-4 righe di dati realistici italiani coerenti col dominio)
- "handlersTs": codice TypeScript valido che esporta ("export function ...") le funzioni handler indicate in primaryHandlerFn con logica realistica.`;

export async function runStartupAssistantChat(params: {
  req: StartupAssistantChatRequest;
  ollamaClient: OllamaProviderClient;
  lmStudioClient: LMStudioProviderClient;
  openAiCompatClient: OpenAICompatProviderClient;
  fetchFn: typeof fetch;
  emitStream: (ev: AgentStreamEvent) => void;
}): Promise<StartupAssistantChatResult> {
  const { req, ollamaClient, fetchFn, emitStream } = params;
  const started = Date.now();
  const runId = req.runId || 'startup-chat';
  const provider: LocalAIProviderKind = req.provider ?? 'ollama';

  emitStream({
    type: 'run_started',
    runId,
    threadId: 'startup-assistant',
    preCheckpointId: '',
  });

  let modelName = (req.modelName || '').trim();
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: STARTUP_CHAT_SYSTEM_PROMPT },
    ...(req.history ?? [])
      .filter((m) => m.role !== 'system' && m.content.trim().length > 0)
      .slice(-8),
    { role: 'user', content: req.prompt },
  ];

  if (provider !== 'builtin_offline') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      if (provider === 'ollama') {
        if (!modelName) {
          const st = await ollamaClient.getStatus(1800);
          modelName = pickPreferredLocalModel(st.models) ?? '';
        }
        if (modelName) {
          const out = await ollamaClient.streamChat({
            modelName,
            messages,
            temperature: 0.35,
            abortSignal: controller.signal,
            onTokenDelta: (delta, isThinking) => {
              emitStream({ type: 'token_delta', runId, delta, isThinking });
            },
          });
          emitStream({ type: 'run_completed', runId });
          return {
            runId,
            reply: out.content || 'Sono pronto ad aiutarti a progettare la tua applicazione.',
            thinkingText: out.thinking,
            provider: 'ollama',
            modelName,
            usedFallbackOffline: false,
            suggestedProjectPrompt: req.prompt,
            tokensIn: out.tokensIn,
            tokensOut: out.tokensOut,
            latencyMs: Date.now() - started,
          };
        }
      } else {
        const cfg =
          provider === 'lmstudio'
            ? params.lmStudioClient.getConfig()
            : params.openAiCompatClient.getConfig();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
        const resp = await fetchFn(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelName || 'local-model',
            stream: false,
            temperature: 0.35,
            messages,
          }),
          signal: controller.signal,
        });
        if (resp.ok) {
          const json = (await resp.json()) as {
            choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
          };
          const replyText = (json.choices?.[0]?.message?.content ?? '').trim();
          if (replyText) {
            emitStream({ type: 'token_delta', runId, delta: replyText, isThinking: false });
            emitStream({ type: 'run_completed', runId });
            return {
              runId,
              reply: replyText,
              thinkingText: json.choices?.[0]?.message?.reasoning_content,
              provider,
              modelName: modelName || 'local-model',
              usedFallbackOffline: false,
              suggestedProjectPrompt: req.prompt,
              latencyMs: Date.now() - started,
            };
          }
        }
      }
    } catch {
      // Fall through cleanly to offline architectural reply
    } finally {
      clearTimeout(timer);
    }
  }

  // Helpful deterministic offline architectural response
  const bp = buildDomainSmartBlueprint({
    prompt: req.prompt,
    primaryTarget: req.primaryTarget ?? 'react-tsx',
  });
  const offlineReply = [
    `### Proposta Architetturale: **${bp.projectName}**`,
    bp.summary,
    '',
    '**Schermate consigliate:**',
    ...bp.screens.map(
      (s, i) =>
        `${i + 1}. **${s.title}** (\`${s.name}.canvas\`) — 3 KPI (${s.kpis.map((k) => `*${k.label}*`).join(', ')}), form *${s.formTitle}* e tabella *${s.tableTitle}*.`,
    ),
    '',
    `**Stack suggerito:** \`${req.primaryTarget ?? 'react-tsx'}\` + handler TypeScript (\`src/scripts/handlers.ts\`) + CSS bidirezionale.`,
    '_Nota: Ollama locale non ha risposto in tempo o è offline; clicca **"Avvia Ollama"** o genera subito il progetto completo in modalità deterministica._',
  ].join('\n');

  emitStream({ type: 'token_delta', runId, delta: offlineReply, isThinking: false });
  emitStream({ type: 'run_completed', runId });

  return {
    runId,
    reply: offlineReply,
    provider: 'builtin_offline',
    modelName: modelName || 'offline-studio-architect-v1',
    usedFallbackOffline: true,
    suggestedProjectPrompt: req.prompt,
    latencyMs: Date.now() - started,
  };
}

export async function runGenerateProjectSeedWithAi(params: {
  req: GenerateProjectWithAiRequest;
  ollamaClient: OllamaProviderClient;
  emitStream: (ev: AgentStreamEvent) => void;
}): Promise<AiGeneratedProjectSeedOutput> {
  const { req, ollamaClient, emitStream } = params;
  const started = Date.now();
  const runId = req.runId || `projgen_${Date.now().toString(36)}`;
  const requestedProvider: LocalAIProviderKind = req.provider ?? 'ollama';

  emitStream({
    type: 'run_started',
    runId,
    threadId: 'startup-project-gen',
    preCheckpointId: '',
  });
  emitStream({
    type: 'project_gen_status',
    runId,
    status: 'Analisi requisiti con Ollama...',
    completedPercent: 15,
  });

  let resolvedModel = (req.modelName || '').trim();
  let blueprint: AiProjectArchitectureBlueprint | null = null;
  let usedFallbackOffline = true;
  let usedProvider: LocalAIProviderKind = 'builtin_offline';

  if (requestedProvider === 'ollama') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      if (!resolvedModel) {
        const st = await ollamaClient.getStatus(1800);
        resolvedModel = pickPreferredLocalModel(st.models) ?? '';
      }

      if (resolvedModel) {
        const userMessage = [
          `Richiesta applicazione: ${req.prompt}`,
          req.projectName?.trim() ? `Nome progetto richiesto: ${req.projectName.trim()}` : 'Deduci un nome progetto appropriato.',
          `Target framework: ${req.primaryTarget ?? 'react-tsx'} (${req.stylingPreset ?? 'tailwind'})`,
          `Modalità layout: ${req.layoutMode ?? 'freeform'}`,
        ].join('\n');

        const chatOut = await ollamaClient.streamChat({
          modelName: resolvedModel,
          messages: [
            { role: 'system', content: PROJECT_ARCHITECT_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          format: AI_PROJECT_BLUEPRINT_JSON_SCHEMA,
          temperature: 0.25,
          numCtx: 16384,
          abortSignal: controller.signal,
          onTokenDelta: (delta, isThinking) => {
            emitStream({ type: 'token_delta', runId, delta, isThinking });
          },
        });

        const { cleanedBody } = extractThinkingAndJsonBody(chatOut.content);
        const parsed = JSON.parse(cleanedBody) as unknown;
        blueprint = sanitizeAiBlueprint(parsed, req);
        usedFallbackOffline = false;
        usedProvider = 'ollama';
      }
    } catch {
      // Graceful 35s timeout or offline fallback
      blueprint = null;
    } finally {
      clearTimeout(timer);
    }
  }

  if (!blueprint) {
    blueprint = buildDomainSmartBlueprint(req);
    usedFallbackOffline = true;
    usedProvider = 'builtin_offline';
    if (!resolvedModel) {
      resolvedModel = 'offline-studio-architect-v1';
    }
  }

  emitStream({
    type: 'project_gen_status',
    runId,
    status: 'Costruzione schermate, componenti e script...',
    completedPercent: 80,
  });

  const seed = compileAiBlueprintToWizardSeed(blueprint, req);

  return {
    runId,
    seed,
    paletteId: blueprint.paletteId,
    defaultThemeMode: blueprint.defaultThemeMode,
    provider: usedProvider,
    modelName: resolvedModel,
    assistantSummary: blueprint.summary,
    usedFallbackOffline,
    latencyMs: Date.now() - started,
  };
}
