import type { OfflineIconEntry } from './ipc-contract';

/**
 * 64 Built-in 100% Offline SVG Icons (24x24 stroke-based clean vector paths)
 * Indexed in SQLite FTS5 (`icon_catalog_fts5`) and directly renderable on Canvas & Codegen.
 */
export const OFFLINE_ICON_CATALOG: OfflineIconEntry[] = [
  // Layout
  { id: 'layout-row', name: 'Layout Row', category: 'layout', tags: ['flex', 'horizontal', 'row', 'stack'], viewBox: '0 0 24 24', svgBody: '<rect x="3" y="5" width="5" height="14" rx="1"/><rect x="10" y="5" width="5" height="14" rx="1"/><rect x="17" y="5" width="4" height="14" rx="1"/>' },
  { id: 'layout-col', name: 'Layout Column', category: 'layout', tags: ['flex', 'vertical', 'column', 'stack'], viewBox: '0 0 24 24', svgBody: '<rect x="4" y="3" width="16" height="5" rx="1"/><rect x="4" y="10" width="16" height="5" rx="1"/><rect x="4" y="17" width="16" height="4" rx="1"/>' },
  { id: 'layout-grid', name: 'Grid 2x2', category: 'layout', tags: ['grid', 'dashboard', 'cards', 'matrix'], viewBox: '0 0 24 24', svgBody: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>' },
  { id: 'panel-left', name: 'Sidebar Left', category: 'layout', tags: ['sidebar', 'drawer', 'navigation', 'split'], viewBox: '0 0 24 24', svgBody: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>' },
  { id: 'panel-right', name: 'Sidebar Right', category: 'layout', tags: ['sidebar', 'inspector', 'panel'], viewBox: '0 0 24 24', svgBody: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>' },
  { id: 'columns-3', name: 'Three Columns', category: 'layout', tags: ['columns', 'split', 'workbench'], viewBox: '0 0 24 24', svgBody: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>' },
  { id: 'maximize', name: 'Maximize Frame', category: 'layout', tags: ['fullscreen', 'expand', 'window'], viewBox: '0 0 24 24', svgBody: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>' },
  { id: 'layers', name: 'Layers Stack', category: 'layout', tags: ['layers', 'z-index', 'hierarchy', 'tree'], viewBox: '0 0 24 24', svgBody: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>' },

  // Navigation
  { id: 'home', name: 'Home', category: 'navigation', tags: ['house', 'dashboard', 'start', 'main'], viewBox: '0 0 24 24', svgBody: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
  { id: 'search', name: 'Search', category: 'navigation', tags: ['find', 'query', 'filter', 'magnifier'], viewBox: '0 0 24 24', svgBody: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>' },
  { id: 'menu', name: 'Hamburger Menu', category: 'navigation', tags: ['menu', 'bars', 'nav', 'mobile'], viewBox: '0 0 24 24', svgBody: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>' },
  { id: 'arrow-right', name: 'Arrow Right', category: 'navigation', tags: ['next', 'forward', 'cta', 'go'], viewBox: '0 0 24 24', svgBody: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>' },
  { id: 'arrow-left', name: 'Arrow Left', category: 'navigation', tags: ['back', 'previous', 'return'], viewBox: '0 0 24 24', svgBody: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>' },
  { id: 'chevron-down', name: 'Chevron Down', category: 'navigation', tags: ['dropdown', 'accordion', 'select', 'expand'], viewBox: '0 0 24 24', svgBody: '<path d="m6 9 6 6 6-6"/>' },
  { id: 'chevron-right', name: 'Chevron Right', category: 'navigation', tags: ['tree', 'breadcrumb', 'next'], viewBox: '0 0 24 24', svgBody: '<path d="m9 18 6-6-6-6"/>' },
  { id: 'external-link', name: 'External Link', category: 'navigation', tags: ['open', 'url', 'browser', 'tab'], viewBox: '0 0 24 24', svgBody: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' },

  // Actions
  { id: 'plus', name: 'Plus / Add', category: 'actions', tags: ['create', 'new', 'insert', 'add'], viewBox: '0 0 24 24', svgBody: '<path d="M5 12h14"/><path d="M12 5v14"/>' },
  { id: 'check', name: 'Checkmark', category: 'actions', tags: ['done', 'success', 'confirm', 'valid'], viewBox: '0 0 24 24', svgBody: '<path d="M20 6 9 17l-5-5"/>' },
  { id: 'x-close', name: 'Close / Cancel', category: 'actions', tags: ['close', 'remove', 'dismiss', 'modal'], viewBox: '0 0 24 24', svgBody: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' },
  { id: 'edit', name: 'Edit Pencil', category: 'actions', tags: ['write', 'modify', 'rename', 'form'], viewBox: '0 0 24 24', svgBody: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>' },
  { id: 'trash', name: 'Delete Trash', category: 'actions', tags: ['delete', 'remove', 'bin', 'clear'], viewBox: '0 0 24 24', svgBody: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>' },
  { id: 'copy', name: 'Copy Clipboard', category: 'actions', tags: ['copy', 'duplicate', 'snippet', 'clone'], viewBox: '0 0 24 24', svgBody: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>' },
  { id: 'download', name: 'Download / Export', category: 'actions', tags: ['export', 'save', 'download', 'bundle'], viewBox: '0 0 24 24', svgBody: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>' },
  { id: 'upload', name: 'Upload / Import', category: 'actions', tags: ['import', 'upload', 'file', 'cloud'], viewBox: '0 0 24 24', svgBody: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>' },
  { id: 'refresh', name: 'Refresh / Sync', category: 'actions', tags: ['reload', 'sync', 'htmx', 'update'], viewBox: '0 0 24 24', svgBody: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>' },
  { id: 'undo', name: 'Undo', category: 'actions', tags: ['undo', 'revert', 'history', 'back'], viewBox: '0 0 24 24', svgBody: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>' },
  { id: 'send', name: 'Send Prompt', category: 'actions', tags: ['submit', 'send', 'chat', 'message'], viewBox: '0 0 24 24', svgBody: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>' },
  { id: 'filter', name: 'Filter Funnel', category: 'actions', tags: ['filter', 'sort', 'table', 'refine'], viewBox: '0 0 24 24', svgBody: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>' },

  // Commerce & Business
  { id: 'shopping-cart', name: 'Shopping Cart', category: 'commerce', tags: ['ecommerce', 'cart', 'buy', 'checkout', 'shop'], viewBox: '0 0 24 24', svgBody: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>' },
  { id: 'credit-card', name: 'Credit Card', category: 'commerce', tags: ['payment', 'billing', 'stripe', 'checkout'], viewBox: '0 0 24 24', svgBody: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>' },
  { id: 'package', name: 'Product Package', category: 'commerce', tags: ['box', 'shipping', 'inventory', 'order', 'unsloth'], viewBox: '0 0 24 24', svgBody: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>' },
  { id: 'tag', name: 'Price Tag', category: 'commerce', tags: ['discount', 'label', 'category', 'price'], viewBox: '0 0 24 24', svgBody: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>' },
  { id: 'dollar', name: 'Revenue / Currency', category: 'commerce', tags: ['money', 'finance', 'kpi', 'revenue'], viewBox: '0 0 24 24', svgBody: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
  { id: 'star', name: 'Star Rating', category: 'commerce', tags: ['favorite', 'review', 'rating', 'featured'], viewBox: '0 0 24 24', svgBody: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
  { id: 'heart', name: 'Wishlist Heart', category: 'commerce', tags: ['like', 'love', 'save', 'wishlist'], viewBox: '0 0 24 24', svgBody: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>' },
  { id: 'wallet', name: 'Wallet', category: 'commerce', tags: ['balance', 'account', 'crypto', 'pay'], viewBox: '0 0 24 24', svgBody: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>' },

  // Media & Communication
  { id: 'image', name: 'Image / Photo', category: 'media', tags: ['picture', 'photo', 'gallery', 'thumbnail'], viewBox: '0 0 24 24', svgBody: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>' },
  { id: 'play', name: 'Play Video', category: 'media', tags: ['run', 'preview', 'video', 'start'], viewBox: '0 0 24 24', svgBody: '<polygon points="6 3 20 12 6 21 6 3"/>' },
  { id: 'camera', name: 'Camera / Vision', category: 'media', tags: ['screenshot', 'vision', 'photo', 'capture'], viewBox: '0 0 24 24', svgBody: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>' },
  { id: 'mail', name: 'Email Envelope', category: 'media', tags: ['email', 'inbox', 'contact', 'newsletter'], viewBox: '0 0 24 24', svgBody: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>' },
  { id: 'bell', name: 'Notification Bell', category: 'media', tags: ['alert', 'notification', 'toast', 'updates'], viewBox: '0 0 24 24', svgBody: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>' },
  { id: 'message-square', name: 'Chat Bubble', category: 'media', tags: ['chat', 'comment', 'feedback', 'dialog'], viewBox: '0 0 24 24', svgBody: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  { id: 'globe', name: 'Globe / Web', category: 'media', tags: ['world', 'i18n', 'web', 'browser', 'http'], viewBox: '0 0 24 24', svgBody: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>' },
  { id: 'share', name: 'Share Network', category: 'media', tags: ['share', 'social', 'publish', 'export'], viewBox: '0 0 24 24', svgBody: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>' },

  // Data & Analytics
  { id: 'bar-chart', name: 'Analytics Chart', category: 'data', tags: ['chart', 'metrics', 'kpi', 'stats', 'graph'], viewBox: '0 0 24 24', svgBody: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>' },
  { id: 'trending-up', name: 'Trending Growth', category: 'data', tags: ['growth', 'positive', 'kpi', 'analytics'], viewBox: '0 0 24 24', svgBody: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>' },
  { id: 'database', name: 'SQLite Database', category: 'data', tags: ['sql', 'sqlite', 'storage', 'table', 'data'], viewBox: '0 0 24 24', svgBody: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>' },
  { id: 'table', name: 'Data Table', category: 'data', tags: ['grid', 'spreadsheet', 'rows', 'crud'], viewBox: '0 0 24 24', svgBody: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>' },
  { id: 'calendar', name: 'Calendar Date', category: 'data', tags: ['date', 'schedule', 'picker', 'event'], viewBox: '0 0 24 24', svgBody: '<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>' },
  { id: 'clock', name: 'Clock / Latency', category: 'data', tags: ['time', 'history', 'recent', 'duration'], viewBox: '0 0 24 24', svgBody: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  { id: 'folder', name: 'Folder Directory', category: 'data', tags: ['directory', 'project', 'explorer', 'vfs'], viewBox: '0 0 24 24', svgBody: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>' },
  { id: 'file-code', name: 'Code File', category: 'data', tags: ['source', 'tsx', 'html', 'code', 'script'], viewBox: '0 0 24 24', svgBody: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>' },

  // System & Security
  { id: 'user', name: 'User Profile', category: 'system', tags: ['account', 'avatar', 'person', 'login'], viewBox: '0 0 24 24', svgBody: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  { id: 'users', name: 'Team / Users', category: 'system', tags: ['team', 'customers', 'group', 'crm'], viewBox: '0 0 24 24', svgBody: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  { id: 'settings', name: 'Settings Gear', category: 'system', tags: ['preferences', 'config', 'options', 'cog'], viewBox: '0 0 24 24', svgBody: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  { id: 'lock', name: 'Lock Security', category: 'system', tags: ['auth', 'password', 'private', 'secure'], viewBox: '0 0 24 24', svgBody: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
  { id: 'shield-check', name: 'Verified Shield', category: 'system', tags: ['security', 'safe', 'a11y', 'verified'], viewBox: '0 0 24 24', svgBody: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>' },
  { id: 'sun', name: 'Light Theme Sun', category: 'system', tags: ['light', 'theme', 'day', 'mode'], viewBox: '0 0 24 24', svgBody: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>' },
  { id: 'moon', name: 'Dark Theme Moon', category: 'system', tags: ['dark', 'theme', 'night', 'mode'], viewBox: '0 0 24 24', svgBody: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>' },
  { id: 'terminal', name: 'Terminal / CLI', category: 'system', tags: ['console', 'shell', 'command', 'dev'], viewBox: '0 0 24 24', svgBody: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>' },

  // Local AI & Design Studio
  { id: 'sparkles', name: 'AI Sparkles', category: 'ai', tags: ['ai', 'magic', 'generate', 'prompt', 'agent'], viewBox: '0 0 24 24', svgBody: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>' },
  { id: 'bot', name: 'Local AI Agent', category: 'ai', tags: ['robot', 'llm', 'ollama', 'lmstudio', 'copilot'], viewBox: '0 0 24 24', svgBody: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>' },
  { id: 'cpu', name: 'GPU / VRAM Chip', category: 'ai', tags: ['hardware', 'vram', 'gpu', 'local', 'quantization'], viewBox: '0 0 24 24', svgBody: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>' },
  { id: 'wand', name: 'Auto-Layout Wand', category: 'ai', tags: ['tidy', 'solve', 'autolayout', 'convert'], viewBox: '0 0 24 24', svgBody: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/>' },
];

export function searchOfflineIcons(query: string, category?: string): OfflineIconEntry[] {
  const q = query.trim().toLowerCase();
  return OFFLINE_ICON_CATALOG.filter((item) => {
    if (category && category !== 'all' && item.category !== category) return false;
    if (!q) return true;
    return (
      item.id.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
}
