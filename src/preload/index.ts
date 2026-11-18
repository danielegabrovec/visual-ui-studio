import { contextBridge, ipcRenderer } from 'electron';
import type { AgentStreamEvent, StudioPreloadApi } from '../shared/ipc-contract';
import type { ToolchainStreamEvent } from '../shared/project-stacks';

const studioApi: StudioPreloadApi = {
  project: {
    listRecent: () => ipcRenderer.invoke('studio:project:listRecent'),
    removeRecent: (projectId) => ipcRenderer.invoke('studio:project:removeRecent', projectId),
    create: (input) => ipcRenderer.invoke('studio:project:create', input),
    createFromWizard: (spec) => ipcRenderer.invoke('studio:project:createFromWizard', spec),
    createAndInitDiskProject: (spec) => ipcRenderer.invoke('studio:project:createAndInitDiskProject', spec),
    open: (idOrPath) => ipcRenderer.invoke('studio:project:open', idOrPath),
    openDirectory: () => ipcRenderer.invoke('studio:project:openDirectory'),
    openExistingDiskProject: (dirPath) => ipcRenderer.invoke('studio:project:openExistingDiskProject', dirPath),
    pickDirectory: (title) => ipcRenderer.invoke('studio:project:pickDirectory', title),
    inspectDirectory: (dirPath) => ipcRenderer.invoke('studio:project:inspectDirectory', dirPath),
    getCurrent: () => ipcRenderer.invoke('studio:project:getCurrent'),
    linkDiskDirectory: (projectId, dirPath) =>
      ipcRenderer.invoke('studio:project:linkDiskDirectory', projectId, dirPath),
    updateSettings: (projectId, patch) =>
      ipcRenderer.invoke('studio:project:updateSettings', projectId, patch),
    exportBundleToDisk: (input) =>
      ipcRenderer.invoke('studio:project:exportBundleToDisk', input),
  },

  workspace: {
    loadState: (projectId) => ipcRenderer.invoke('studio:workspace:loadState', projectId),
    saveState: (projectId, patch) => ipcRenderer.invoke('studio:workspace:saveState', projectId, patch),
  },

  vfs: {
    listTree: (projectId) => ipcRenderer.invoke('studio:vfs:listTree', projectId),
    createEntry: (input) => ipcRenderer.invoke('studio:vfs:createEntry', input),
    renameEntry: (entryId, newName) => ipcRenderer.invoke('studio:vfs:renameEntry', entryId, newName),
    moveEntry: (entryId, newParentId) => ipcRenderer.invoke('studio:vfs:moveEntry', entryId, newParentId),
    deleteEntry: (entryId, deleteOnDisk) =>
      ipcRenderer.invoke('studio:vfs:deleteEntry', entryId, deleteOnDisk),
    readFile: (entryId) => ipcRenderer.invoke('studio:vfs:readFile', entryId),
    writeFile: (entryId, content, expectedContent) => ipcRenderer.invoke('studio:vfs:writeFile', entryId, content, expectedContent),
  },

  canvas: {
    listSheets: (projectId) => ipcRenderer.invoke('studio:canvas:listSheets', projectId),
    loadSheet: (sheetId) => ipcRenderer.invoke('studio:canvas:loadSheet', sheetId),
    saveSheetViewport: (sheetId, x, y, zoom) =>
      ipcRenderer.invoke('studio:canvas:saveSheetViewport', sheetId, x, y, zoom),
    commitPatchBatch: (batch) => ipcRenderer.invoke('studio:canvas:commitPatchBatch', batch),
    undo: (sheetId) => ipcRenderer.invoke('studio:canvas:undo', sheetId),
    redo: (sheetId) => ipcRenderer.invoke('studio:canvas:redo', sheetId),
    listCheckpoints: (sheetId) => ipcRenderer.invoke('studio:canvas:listCheckpoints', sheetId),
    createCheckpoint: (input) => ipcRenderer.invoke('studio:canvas:createCheckpoint', input),
    restoreCheckpoint: (checkpointId) => ipcRenderer.invoke('studio:canvas:restoreCheckpoint', checkpointId),
  },

  tokens: {
    listTokens: (projectId) => ipcRenderer.invoke('studio:tokens:listTokens', projectId),
    upsertToken: (entry) => ipcRenderer.invoke('studio:tokens:upsertToken', entry),
    deleteToken: (tokenId) => ipcRenderer.invoke('studio:tokens:deleteToken', tokenId),
    listThemes: (projectId) => ipcRenderer.invoke('studio:tokens:listThemes', projectId),
    searchIcons: (query, category) => ipcRenderer.invoke('studio:tokens:searchIcons', query, category),
  },

  codegen: {
    listTargets: () => ipcRenderer.invoke('studio:codegen:listTargets'),
    compileSheet: (req) => ipcRenderer.invoke('studio:codegen:compileSheet', req),
    solveFreeformLayout: (sheetId, rootNodeId) =>
      ipcRenderer.invoke('studio:codegen:solveFreeformLayout', sheetId, rootNodeId),
    saveBundleToDisk: (projectId, bundle) =>
      ipcRenderer.invoke('studio:codegen:saveBundleToDisk', projectId, bundle),
  },

  ai: {
    ensureOllamaRunning: () => ipcRenderer.invoke('studio:ai:ensureOllamaRunning'),
    getHardwareReport: () => ipcRenderer.invoke('studio:ai:getHardwareReport'),
    listProvidersAndModels: () => ipcRenderer.invoke('studio:ai:listProvidersAndModels'),
    configureProvider: (config) => ipcRenderer.invoke('studio:ai:configureProvider', config),
    getUnslothCatalog: () => ipcRenderer.invoke('studio:ai:getUnslothCatalog'),
    pullOllamaModel: (modelRef) => ipcRenderer.invoke('studio:ai:pullOllamaModel', modelRef),
    askStartupAssistant: (req) => ipcRenderer.invoke('studio:ai:askStartupAssistant', req),
    generateProjectWithAi: (req) => ipcRenderer.invoke('studio:ai:generateProjectWithAi', req),
    listThreads: (projectId) => ipcRenderer.invoke('studio:ai:listThreads', projectId),
    getThreadMessages: (threadId) => ipcRenderer.invoke('studio:ai:getThreadMessages', threadId),
    runAgentTurn: (req) => ipcRenderer.invoke('studio:ai:runAgentTurn', req),
    cancelAgentRun: (runId) => ipcRenderer.invoke('studio:ai:cancelAgentRun', runId),
    recordUnslothPair: (input) => ipcRenderer.invoke('studio:ai:recordUnslothPair', input),
    listUnslothPairs: (projectId) => ipcRenderer.invoke('studio:ai:listUnslothPairs', projectId),
    exportUnslothDataset: (req) => ipcRenderer.invoke('studio:ai:exportUnslothDataset', req),
    onAgentStreamEvent: (listener: (event: AgentStreamEvent) => void) => {
      const handler = (_ipcEvent: Electron.IpcRendererEvent, payload: AgentStreamEvent) => {
        listener(payload);
      };
      ipcRenderer.on('studio:ai:stream-event', handler);
      return () => {
        ipcRenderer.removeListener('studio:ai:stream-event', handler);
      };
    },
  },

  toolchain: {
    checkDoctor: () => ipcRenderer.invoke('studio:toolchain:checkDoctor'),
    runTask: (req) => ipcRenderer.invoke('studio:toolchain:runTask', req),
    stopTask: (taskId) => ipcRenderer.invoke('studio:toolchain:stopTask', taskId),
    listActiveTasks: (projectId) => ipcRenderer.invoke('studio:toolchain:listActiveTasks', projectId),
    onEvent: (listener: (event: ToolchainStreamEvent) => void) => {
      const handler = (_ipcEvent: Electron.IpcRendererEvent, payload: ToolchainStreamEvent) => {
        listener(payload);
      };
      ipcRenderer.on('studio:toolchain:stream', handler);
      return () => {
        ipcRenderer.removeListener('studio:toolchain:stream', handler);
      };
    },
    onDiskVfsChanged: (listener: (event: { projectId: string; paths: string[] }) => void) => {
      const handler = (
        _ipcEvent: Electron.IpcRendererEvent,
        payload: { projectId: string; paths: string[] },
      ) => {
        listener(payload);
      };
      ipcRenderer.on('studio:vfs:changed', handler);
      return () => {
        ipcRenderer.removeListener('studio:vfs:changed', handler);
      };
    },
  },

  sql: {
    loadSchema: (projectId) => ipcRenderer.invoke('studio:sql:loadSchema', projectId),
    saveSchema: (projectId, doc) => ipcRenderer.invoke('studio:sql:saveSchema', projectId, doc),
    listConnections: (projectId) => ipcRenderer.invoke('studio:sql:listConnections', projectId),
    saveConnection: (profile, secret) => ipcRenderer.invoke('studio:sql:saveConnection', profile, secret),
    deleteConnection: (connectionId) => ipcRenderer.invoke('studio:sql:deleteConnection', connectionId),
    testConnection: (connectionId, secretOverride) =>
      ipcRenderer.invoke('studio:sql:testConnection', connectionId, secretOverride),
    introspectConnection: (connectionId) => ipcRenderer.invoke('studio:sql:introspectConnection', connectionId),
    executeQuery: (req) => ipcRenderer.invoke('studio:sql:executeQuery', req),
    applyDataChanges: (input) => ipcRenderer.invoke('studio:sql:applyDataChanges', input),
    resetSandbox: (projectId, schemaDoc) =>
      ipcRenderer.invoke('studio:sql:resetSandbox', projectId, schemaDoc),
    compileMigration: (input) => ipcRenderer.invoke('studio:sql:compileMigration', input),
    applyMigration: (input) => ipcRenderer.invoke('studio:sql:applyMigration', input),
    listQueryHistory: (projectId, limit) => ipcRenderer.invoke('studio:sql:listQueryHistory', projectId, limit),
    extractSqlFromProjectFiles: (projectId) =>
      ipcRenderer.invoke('studio:sql:extractSqlFromProjectFiles', projectId),
    generateCodeBundle: (req) => ipcRenderer.invoke('studio:sql:generateCodeBundle', req),
    installRustTauriModule: (projectId, bundle) =>
      ipcRenderer.invoke('studio:sql:installRustTauriModule', projectId, bundle),
  },
};

contextBridge.exposeInMainWorld('studioApi', studioApi);
