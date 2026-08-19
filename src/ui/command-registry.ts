// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Command palette registry — pure command specs + fuzzy filter/score.
 *
 * UI lives in {@link ./CommandPalette.tsx}. Actions are injected via
 * {@link buildDefaultCommands} so unit tests can score/filter without Solid.
 *
 * @module ui/command-registry
 */

/** Stable command id (used as list keys / telemetry). */
export type CommandId = string;

/** Optional grouping shown in the palette. */
export type CommandCategory = 'panels' | 'theme' | 'chart' | 'actions' | 'navigation';

/** Declarative command metadata (no side effects). */
export interface CommandSpec {
  id: CommandId;
  title: string;
  /** Extra terms for fuzzy match (not shown in the list by default). */
  keywords?: string[];
  category?: CommandCategory | string;
  /** Hint shown on the right (e.g. ⌘K is not listed here — optional). */
  shortcut?: string;
}

/** Runnable command = metadata + action. */
export interface CommandDef extends CommandSpec {
  run: () => void | Promise<void>;
}

/** Ranked result from {@link filterCommands}. */
export type RankedCommand<T extends CommandSpec = CommandSpec> = T & {
  score: number;
};

/**
 * Handlers the shell injects so the registry stays free of Solid imports
 * for the pure filter path (actions still close over store at build time).
 */
export interface CommandActions {
  toggleWatchlist: () => void;
  toggleEditor: () => void;
  toggleResults: () => void;
  toggleLogs: () => void;
  toggleLayers: () => void;
  toggleIndicators: () => void;
  toggleDataView: () => void;
  toggleAlerts?: () => void;
  toggleScriptLogs?: () => void;
  toggleStatusBar?: () => void;
  toggleLibrary?: () => void;
  toggleDataSource?: () => void;
  toggleOnchain?: () => void;
  /** Open on-chain panel (e.g. TVL mode; panel mode is local UI state). */
  openOnchain?: () => void;
  /** Detach all on-chain chart series attachments. */
  clearAllOnchainSeries?: () => void;
  /** Clear on-chain event markers plane. */
  clearOnchainEvents?: () => void;
  /** Probe Worker on-chain proxy / refresh telemetry HUD. */
  kickOnchainHealth?: () => void;
  /** Re-fetch every attached DefiLlama TVL series. */
  refreshAllAttachedTvl?: () => void | Promise<void>;
  /** Download all attached on-chain series as long CSV. */
  exportOnchainSeries?: () => void;
  /** Attach top popular DefiLlama TVL protocols (preset, e.g. top 5). */
  attachPopularTvl?: () => void | Promise<void>;
  toggleTheme: () => void;
  /** Apply a named chart theme preset (void-dark, classic, …). */
  setChartThemePreset?: (presetId: string) => void;
  /** Open Settings on the Theme tab. */
  openThemeSettings?: () => void;
  /** Open Settings on the Editor (lint / hover / complete) tab. */
  openEditorSettings?: () => void;
  setChartGridMode: (mode: '1' | '2h' | '2v' | '4') => void;
  runScript: () => void | Promise<void>;
  focusSymbol: () => void;
  loadSymbol?: () => void | Promise<void>;
  reloadChart?: () => void | Promise<void>;
  toggleLive?: () => void;
  openSettings?: () => void;
  openPlugins?: () => void;
  /** Open Workers Manager (calc backends / edge / Pyodide). */
  openWorkers?: () => void;
  /** Open the architecture / compose-recipe wiring modal. */
  openArchitecture?: () => void;
  openScriptSettings?: () => void;
  /** Open Results on the Optimise tab (strategy HPO). */
  openOptimise?: () => void;
  /** About AXIS modal (logo / Help → About). */
  openAbout?: () => void;
  resetUiLayout?: () => void;
  /** Browser Fullscreen API on the app shell. */
  toggleFullscreen?: () => void | Promise<void>;
  /** Hide topbar / docks / status — chart fills the shell. */
  toggleChartOnly?: () => void;
  /** Chart-only + browser fullscreen together (immersive chart). */
  toggleChartOnlyFullscreen?: () => void | Promise<void>;
  /** Column ruler in the Pine editor (optional; omitted when store lacks toggle). */
  toggleEditorRuler?: () => void;
  /** End-of-line log/error chips from last run. */
  toggleInlineDebug?: () => void;
  /** Chart markers for log bar_index/time pins. */
  toggleDebugPins?: () => void;
  /** Per-line % cost gutter (profiler mode). */
  toggleProfiler?: () => void;
  /** Prompt for line number → `axis-editor-goto-line`. */
  jumpToLine?: () => void;
  /** Persist active editor tab to the script library. */
  saveToLibrary?: () => void | Promise<void>;
  /** Focus (and soft-format) the docked CodeMirror surface. */
  focusEditor?: () => void;
  /** Host-injected git push (only when `window.axisGitPush` exists). */
  gitPush?: () => void | Promise<void>;
  /** Host-injected git pull (only when `window.axisGitPull` exists). */
  gitPull?: () => void | Promise<void>;
}

/* ── Fuzzy scoring (pure) ─────────────────────────────────────────── */

/**
 * Score how well `query` matches `text`. Higher is better; `0` = no match.
 *
 * Ranking preferences (roughly):
 * 1. Exact equality
 * 2. Prefix match
 * 3. Contiguous substring
 * 4. Ordered subsequence (fuzzy)
 */
export function scoreMatch(text: string, query: string): number {
  const h = String(text || '')
    .toLowerCase()
    .trim();
  const n = String(query || '')
    .toLowerCase()
    .trim();
  if (!n) return 1;
  if (!h) return 0;

  if (h === n) return 10_000;
  if (h.startsWith(n)) return 8_000 - Math.min(200, h.length - n.length);
  const idx = h.indexOf(n);
  if (idx >= 0) return 6_000 - idx * 10 - Math.min(100, h.length - n.length);

  // Ordered subsequence (fuzzy): bonus for consecutive hits & early start
  let hi = 0;
  let score = 0;
  let consecutive = 0;
  let first = -1;
  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni]!;
    let found = false;
    while (hi < h.length) {
      if (h[hi] === ch) {
        if (first < 0) first = hi;
        consecutive += 1;
        score += 12 + consecutive * 8;
        // Word-boundary bonus (start or after space / punctuation)
        if (hi === 0 || /[\s\-_./]/.test(h[hi - 1]!)) score += 25;
        hi++;
        found = true;
        break;
      }
      consecutive = 0;
      hi++;
    }
    if (!found) return 0;
  }
  // Prefer early matches and tighter coverage
  score += Math.max(0, 40 - first * 3);
  score -= Math.max(0, h.length - n.length) * 0.5;
  return Math.max(1, Math.round(score));
}

/**
 * Best score across title, id, category, and keywords.
 * Empty / whitespace query returns a neutral score so callers can list all.
 */
export function scoreCommand(
  cmd: Pick<CommandSpec, 'id' | 'title' | 'keywords' | 'category'>,
  query: string,
): number {
  const q = String(query || '').trim();
  if (!q) return 1;

  let best = scoreMatch(cmd.title, q);
  best = Math.max(best, scoreMatch(cmd.id, q) * 0.85);
  if (cmd.category) best = Math.max(best, scoreMatch(String(cmd.category), q) * 0.7);
  for (const kw of cmd.keywords || []) {
    best = Math.max(best, scoreMatch(kw, q) * 0.95);
  }
  return best;
}

/**
 * Filter + rank commands by fuzzy score. Empty query returns all in input order
 * with score `1`. Non-matching commands (score 0) are dropped.
 */
export function filterCommands<T extends Pick<CommandSpec, 'id' | 'title' | 'keywords' | 'category'>>(
  commands: readonly T[],
  query: string,
): RankedCommand<T>[] {
  const q = String(query || '').trim();
  if (!q) {
    return commands.map((c) => ({ ...c, score: 1 }));
  }

  const ranked: RankedCommand<T>[] = [];
  for (const cmd of commands) {
    const score = scoreCommand(cmd, q);
    if (score > 0) ranked.push({ ...cmd, score });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });
  return ranked;
}

/* ── Default command set ──────────────────────────────────────────── */

/** Static specs used by tests and as the base for {@link buildDefaultCommands}. */
export const DEFAULT_COMMAND_SPECS: readonly CommandSpec[] = [
  // Panels
  {
    id: 'panel.watchlist',
    title: 'Toggle Watchlist',
    category: 'panels',
    keywords: ['list', 'symbols', 'sidebar', 'wl'],
  },
  {
    id: 'panel.editor',
    title: 'Toggle Editor',
    category: 'panels',
    keywords: ['pine', 'code', 'script editor', 'dock'],
  },
  {
    id: 'panel.results',
    title: 'Toggle Results',
    category: 'panels',
    keywords: ['export', 'strategy', 'report', 'output'],
  },
  {
    id: 'panel.logs',
    title: 'Toggle System Logs',
    category: 'panels',
    keywords: ['logs', 'console', 'telemetry', 'system'],
  },
  {
    id: 'panel.layers',
    title: 'Toggle Layers',
    category: 'panels',
    keywords: ['drawings', 'panes', 'overlay'],
  },
  {
    id: 'panel.indicators',
    title: 'Toggle Scripts',
    category: 'panels',
    keywords: ['scripts', 'applied', 'indicator list', 'indicators', 'strategies'],
  },
  {
    id: 'panel.dataview',
    title: 'Toggle Data Window',
    category: 'panels',
    keywords: ['dataview', 'ohlcv', 'crosshair', 'values', 'data'],
  },
  {
    id: 'panel.alerts',
    title: 'Toggle Alerts',
    category: 'panels',
    keywords: ['price alert', 'webhook', 'notification', 'alarm'],
  },
  {
    id: 'panel.scriptlogs',
    title: 'Toggle Script Logs',
    category: 'panels',
    keywords: ['log.info', 'pine logs', 'script output', 'scriptlogs'],
  },
  {
    id: 'panel.statusbar',
    title: 'Toggle Status Bar',
    category: 'panels',
    keywords: ['status', 'hud', 'connection', 'statusbar', 'footer'],
  },
  {
    id: 'panel.library',
    title: 'Toggle Script Library',
    category: 'panels',
    keywords: ['library', 'scripts', 'save', 'load', 'storage', 'pine files'],
  },
  {
    id: 'panel.datasource',
    title: 'Toggle Data Source Manager',
    category: 'panels',
    keywords: [
      'data source',
      'datasource',
      'backfill',
      'history',
      'ohlcv',
      'accumulate',
      'exchange',
      'symbol',
      'timeframe',
    ],
  },
  {
    id: 'panel.onchain',
    title: 'Toggle On-Chain panel',
    category: 'panels',
    keywords: [
      'onchain',
      'on-chain',
      'defillama',
      'tvl',
      'chain',
      'protocol',
      'liquidity',
    ],
  },
  {
    id: 'onchain.mode.tvl',
    title: 'On-Chain: Open TVL',
    category: 'actions',
    keywords: [
      'onchain',
      'on-chain',
      'tvl',
      'defillama',
      'protocol',
      'open onchain',
    ],
  },
  {
    id: 'onchain.clear.series',
    title: 'On-Chain: Clear Series',
    category: 'actions',
    keywords: [
      'onchain',
      'on-chain',
      'clear',
      'series',
      'detach',
      'remove overlays',
      'tvl lines',
    ],
  },
  {
    id: 'onchain.clear.events',
    title: 'On-Chain: Clear Events',
    category: 'actions',
    keywords: [
      'onchain',
      'on-chain',
      'clear',
      'events',
      'markers',
      'spikes',
      'event plane',
    ],
  },
  {
    id: 'onchain.health',
    title: 'On-Chain: Refresh Health',
    category: 'actions',
    keywords: [
      'onchain',
      'on-chain',
      'health',
      'probe',
      'telemetry',
      'proxy',
      'worker',
    ],
  },
  {
    id: 'onchain.refresh',
    title: 'On-Chain: Refresh Attached TVL',
    category: 'actions',
    keywords: [
      'onchain',
      'on-chain',
      'refresh',
      'reload',
      'tvl',
      'refetch',
      'update series',
      'defillama',
    ],
  },
  {
    id: 'onchain.export.series',
    title: 'On-Chain: Export Series CSV',
    category: 'actions',
    keywords: [
      'onchain',
      'on-chain',
      'export',
      'csv',
      'download',
      'series',
      'tvl',
      'save data',
    ],
  },
  {
    id: 'onchain.attach.popular',
    title: 'On-Chain: Attach Popular TVL',
    category: 'actions',
    keywords: [
      'onchain',
      'on-chain',
      'popular',
      'preset',
      'top tvl',
      'attach',
      'defillama',
      'protocols',
    ],
  },
  // Theme
  {
    id: 'theme.toggle',
    title: 'Toggle Theme',
    category: 'theme',
    keywords: ['dark', 'light', 'appearance', 'mode'],
  },
  {
    id: 'theme.chart',
    title: 'Chart Theme…',
    category: 'theme',
    keywords: [
      'chart theme',
      'bar color',
      'candle color',
      'background',
      'chart.bg_color',
      'chart.fg_color',
      'color_background',
      'color_foreground',
      'grid color',
      'preset',
    ],
  },
  {
    id: 'theme.void-dark',
    title: 'Theme: Void Dark',
    category: 'theme',
    keywords: ['void', 'dark', 'preset', 'chart.bg_color'],
  },
  {
    id: 'theme.void-light',
    title: 'Theme: Void Light',
    category: 'theme',
    keywords: ['void', 'light', 'preset'],
  },
  {
    id: 'theme.classic',
    title: 'Theme: Classic',
    category: 'theme',
    keywords: ['classic', 'green', 'red', 'teal', 'preset'],
  },
  {
    id: 'theme.mono',
    title: 'Theme: Mono',
    category: 'theme',
    keywords: ['mono', 'gray', 'graphite', 'focus', 'preset'],
  },
  {
    id: 'theme.obsidian',
    title: 'Theme: Obsidian',
    category: 'theme',
    keywords: ['obsidian', 'luxury', 'gold', 'sage', 'warm dark', 'preset'],
  },
  {
    id: 'theme.graphite',
    title: 'Theme: Graphite',
    category: 'theme',
    keywords: ['graphite', 'industrial', 'teal', 'cool dark', 'preset'],
  },
  {
    id: 'theme.pacific',
    title: 'Theme: Pacific',
    category: 'theme',
    keywords: ['pacific', 'ocean', 'teal', 'cyan', 'clay', 'preset'],
  },
  {
    id: 'theme.dusk',
    title: 'Theme: Dusk',
    category: 'theme',
    keywords: ['dusk', 'twilight', 'violet', 'lilac', 'preset'],
  },
  {
    id: 'theme.porcelain',
    title: 'Theme: Porcelain',
    category: 'theme',
    keywords: ['porcelain', 'light', 'pearl', 'day', 'preset'],
  },
  {
    id: 'theme.parchment',
    title: 'Theme: Parchment',
    category: 'theme',
    keywords: ['parchment', 'paper', 'warm light', 'ivory', 'preset'],
  },
  // Chart grid
  {
    id: 'chart.grid.1',
    title: 'Chart Layout: Single',
    category: 'chart',
    keywords: ['1', 'grid', 'one chart', 'single'],
  },
  {
    id: 'chart.grid.2h',
    title: 'Chart Layout: 2 Horizontal',
    category: 'chart',
    keywords: ['2h', 'side by side', 'split horizontal', 'grid'],
  },
  {
    id: 'chart.grid.2v',
    title: 'Chart Layout: 2 Vertical',
    category: 'chart',
    keywords: ['2v', 'stacked', 'split vertical', 'grid'],
  },
  {
    id: 'chart.grid.4',
    title: 'Chart Layout: Quad',
    category: 'chart',
    keywords: ['4', 'four', 'grid', 'multi'],
  },
  // Actions
  {
    id: 'action.run',
    title: 'Run Script',
    category: 'actions',
    keywords: ['execute', 'apply', 'pine', 'compile', 'indicator'],
    shortcut: '⌘↵',
  },
  {
    id: 'action.focus-symbol',
    title: 'Focus Symbol',
    category: 'navigation',
    keywords: ['ticker', 'pair', 'search symbol', 'goto'],
  },
  {
    id: 'action.load-symbol',
    title: 'Load Symbol',
    category: 'actions',
    keywords: ['fetch', 'history', 'bars', 'reload data'],
  },
  {
    id: 'action.reload-chart',
    title: 'Reload Chart',
    category: 'actions',
    keywords: ['refresh', 'redraw', 'force load'],
  },
  {
    id: 'action.toggle-live',
    title: 'Toggle Live Stream',
    category: 'actions',
    keywords: ['websocket', 'realtime', 'stream', 'live'],
  },
  {
    id: 'action.settings',
    title: 'Open Settings',
    category: 'navigation',
    keywords: ['preferences', 'endpoint', 'engine', 'config'],
  },
  {
    id: 'action.settings-editor',
    title: 'Open Editor Settings',
    category: 'navigation',
    keywords: [
      'lint',
      'preeval',
      'pre-eval',
      'hover',
      'autocomplete',
      'completion',
      'suggestions',
      'underlines',
      'diagnostics',
      'hints',
    ],
  },
  {
    id: 'action.plugins',
    title: 'Open Runtimes → Plugins',
    category: 'navigation',
    keywords: ['library', 'extensions', 'install', 'catalog', 'runtimes', 'manager'],
  },
  {
    id: 'action.workers',
    title: 'Open Runtimes → Status',
    category: 'navigation',
    keywords: [
      'workers',
      'worker manager',
      'runtimes',
      'backend',
      'endpoint',
      'pyodide',
      'edge',
      'cloudflare',
      'pro api',
      'install helper',
      'health',
      'status',
      'service worker',
      'pyne-agent',
    ],
  },
  {
    id: 'action.architecture',
    title: 'Open Architecture',
    category: 'navigation',
    keywords: [
      'wire',
      'compose',
      'recipe',
      'predefinition',
      'source',
      'stream',
      'engine',
      'storage',
      'dataset',
      'offline lab',
      'plugin slots',
      'modular',
    ],
  },
  {
    id: 'action.script-settings',
    title: 'Open Script Inputs',
    category: 'actions',
    keywords: ['inputs', 'parameters', 'input.*', 'strategy', 'properties', 'capital', 'pyramiding'],
  },
  {
    id: 'action.optimise-strategy',
    title: 'Optimise strategy',
    category: 'actions',
    keywords: [
      'hpo',
      'hyperparameter',
      'optimisation',
      'optimization',
      'tune',
      'walk-forward',
      'tpe',
      'inputs',
    ],
  },
  {
    id: 'action.about',
    title: 'About AXIS',
    category: 'navigation',
    keywords: [
      'about',
      'hoox',
      'ethos',
      'manifesto',
      'author',
      'jango',
      'license',
      'agpl',
      'version',
      'credits',
    ],
  },
  {
    id: 'action.reset-ui',
    title: 'Reset UI Layout',
    category: 'actions',
    keywords: ['factory', 'defaults', 'chrome', 'panels reset'],
  },
  {
    id: 'action.fullscreen',
    title: 'Toggle Fullscreen',
    category: 'navigation',
    keywords: ['fullscreen', 'full screen', 'display', 'monitor', 'f11'],
    shortcut: 'F11',
  },
  {
    id: 'action.chart-only',
    title: 'Toggle Chart Only',
    category: 'navigation',
    keywords: [
      'chart only',
      'fullscreen chart',
      'hide chrome',
      'focus chart',
      'zen',
      'immersive',
    ],
    shortcut: '⇧F',
  },
  {
    id: 'action.chart-only-fullscreen',
    title: 'Chart Only + Fullscreen',
    category: 'navigation',
    keywords: [
      'immersive',
      'chart fullscreen',
      'full screen only chart',
      'maximize chart',
      'presentation',
    ],
  },
  // Editor power tools
  {
    id: 'editor.toggle-ruler',
    title: 'Toggle Editor Ruler',
    category: 'actions',
    keywords: ['ruler', 'column', 'guide', 'indent guide', '80'],
  },
  {
    id: 'editor.toggle-inline-debug',
    title: 'Toggle Inline Debug',
    category: 'actions',
    keywords: ['debug', 'inline', 'chips', 'log', 'problem', 'problems', 'diagnostics'],
  },
  {
    id: 'editor.toggle-debug-pins',
    title: 'Toggle Debug Pins',
    category: 'actions',
    keywords: ['debug', 'pin', 'pins', 'markers', 'bar_index', 'chart pins'],
  },
  {
    id: 'editor.toggle-profiler',
    title: 'Toggle Profiler',
    category: 'actions',
    keywords: ['profiler', 'profile', 'performance', 'cost', 'gutter', 'timing'],
  },
  {
    id: 'editor.goto-line',
    title: 'Jump to Line',
    category: 'navigation',
    keywords: ['goto', 'line', 'jump', 'go to', 'problem', 'navigate'],
    shortcut: '⌥G',
  },
  {
    id: 'editor.save-library',
    title: 'Save to Library',
    category: 'actions',
    keywords: ['save', 'library', 'persist', 'commit', 'script', 'storage'],
  },
  {
    id: 'editor.focus',
    title: 'Focus Editor',
    category: 'navigation',
    keywords: ['format', 'focus', 'code', 'cursor', 'editor', 'cm'],
  },
  {
    id: 'git.push',
    title: 'Git Push',
    category: 'actions',
    keywords: ['git', 'push', 'remote', 'upload', 'commit push'],
  },
  {
    id: 'git.pull',
    title: 'Git Pull',
    category: 'actions',
    keywords: ['git', 'pull', 'fetch', 'remote', 'sync', 'download'],
  },
] as const;

/**
 * Attach runnable handlers to the default command set.
 * Missing optional handlers omit those commands (or no-op when core).
 */
export function buildDefaultCommands(actions: CommandActions): CommandDef[] {
  const byId = new Map<string, () => void | Promise<void>>([
    ['panel.watchlist', actions.toggleWatchlist],
    ['panel.editor', actions.toggleEditor],
    ['panel.results', actions.toggleResults],
    ['panel.logs', actions.toggleLogs],
    ['panel.layers', actions.toggleLayers],
    ['panel.indicators', actions.toggleIndicators],
    ['panel.dataview', actions.toggleDataView],
    ['theme.toggle', actions.toggleTheme],
    ['chart.grid.1', () => actions.setChartGridMode('1')],
    ['chart.grid.2h', () => actions.setChartGridMode('2h')],
    ['chart.grid.2v', () => actions.setChartGridMode('2v')],
    ['chart.grid.4', () => actions.setChartGridMode('4')],
    ['action.run', () => void actions.runScript()],
    ['action.focus-symbol', actions.focusSymbol],
  ]);

  if (actions.toggleScriptLogs) byId.set('panel.scriptlogs', actions.toggleScriptLogs);
  if (actions.toggleStatusBar) byId.set('panel.statusbar', actions.toggleStatusBar);
  if (actions.toggleAlerts) byId.set('panel.alerts', actions.toggleAlerts);
  if (actions.toggleLibrary) byId.set('panel.library', actions.toggleLibrary);
  if (actions.toggleDataSource) byId.set('panel.datasource', actions.toggleDataSource);
  if (actions.toggleOnchain) byId.set('panel.onchain', actions.toggleOnchain);
  // TVL mode: prefer open-only; fall back to toggle when open helper missing
  if (actions.openOnchain) {
    byId.set('onchain.mode.tvl', actions.openOnchain);
  } else if (actions.toggleOnchain) {
    byId.set('onchain.mode.tvl', actions.toggleOnchain);
  }
  if (actions.clearAllOnchainSeries) {
    byId.set('onchain.clear.series', actions.clearAllOnchainSeries);
  }
  if (actions.clearOnchainEvents) {
    byId.set('onchain.clear.events', actions.clearOnchainEvents);
  }
  if (actions.kickOnchainHealth) {
    byId.set('onchain.health', actions.kickOnchainHealth);
  }
  if (actions.refreshAllAttachedTvl) {
    byId.set('onchain.refresh', () => void actions.refreshAllAttachedTvl?.());
  }
  if (actions.exportOnchainSeries) {
    byId.set('onchain.export.series', actions.exportOnchainSeries);
  }
  if (actions.attachPopularTvl) {
    byId.set('onchain.attach.popular', () => void actions.attachPopularTvl?.());
  }
  if (actions.loadSymbol) byId.set('action.load-symbol', () => void actions.loadSymbol?.());
  if (actions.reloadChart) byId.set('action.reload-chart', () => void actions.reloadChart?.());
  if (actions.toggleLive) byId.set('action.toggle-live', actions.toggleLive);
  if (actions.openSettings) {
    byId.set('action.settings', actions.openSettings);
  }
  if (actions.openEditorSettings) {
    byId.set('action.settings-editor', actions.openEditorSettings);
  } else if (actions.openSettings) {
    byId.set('action.settings-editor', actions.openSettings);
  }
  // Chart Theme → Settings Theme tab (prefer dedicated opener)
  if (actions.openThemeSettings) {
    byId.set('theme.chart', actions.openThemeSettings);
  } else if (actions.openSettings) {
    byId.set('theme.chart', actions.openSettings);
  }
  if (actions.setChartThemePreset) {
    byId.set('theme.void-dark', () => actions.setChartThemePreset?.('void-dark'));
    byId.set('theme.void-light', () => actions.setChartThemePreset?.('void-light'));
    byId.set('theme.classic', () => actions.setChartThemePreset?.('classic'));
    byId.set('theme.mono', () => actions.setChartThemePreset?.('mono'));
    byId.set('theme.obsidian', () => actions.setChartThemePreset?.('obsidian'));
    byId.set('theme.graphite', () => actions.setChartThemePreset?.('graphite'));
    byId.set('theme.pacific', () => actions.setChartThemePreset?.('pacific'));
    byId.set('theme.dusk', () => actions.setChartThemePreset?.('dusk'));
    byId.set('theme.porcelain', () => actions.setChartThemePreset?.('porcelain'));
    byId.set('theme.parchment', () => actions.setChartThemePreset?.('parchment'));
  }
  if (actions.openPlugins) byId.set('action.plugins', actions.openPlugins);
  if (actions.openWorkers) byId.set('action.workers', actions.openWorkers);
  if (actions.openArchitecture) byId.set('action.architecture', actions.openArchitecture);
  if (actions.openScriptSettings) byId.set('action.script-settings', actions.openScriptSettings);
  if (actions.openOptimise) byId.set('action.optimise-strategy', actions.openOptimise);
  if (actions.openAbout) byId.set('action.about', actions.openAbout);
  if (actions.resetUiLayout) byId.set('action.reset-ui', actions.resetUiLayout);
  if (actions.toggleFullscreen) {
    byId.set('action.fullscreen', () => void actions.toggleFullscreen?.());
  }
  if (actions.toggleChartOnly) byId.set('action.chart-only', actions.toggleChartOnly);
  if (actions.toggleChartOnlyFullscreen) {
    byId.set('action.chart-only-fullscreen', () => void actions.toggleChartOnlyFullscreen?.());
  }
  if (actions.toggleEditorRuler) byId.set('editor.toggle-ruler', actions.toggleEditorRuler);
  if (actions.toggleInlineDebug) byId.set('editor.toggle-inline-debug', actions.toggleInlineDebug);
  if (actions.toggleDebugPins) byId.set('editor.toggle-debug-pins', actions.toggleDebugPins);
  if (actions.toggleProfiler) byId.set('editor.toggle-profiler', actions.toggleProfiler);
  if (actions.jumpToLine) byId.set('editor.goto-line', actions.jumpToLine);
  if (actions.saveToLibrary) byId.set('editor.save-library', () => void actions.saveToLibrary?.());
  if (actions.focusEditor) byId.set('editor.focus', actions.focusEditor);
  if (actions.gitPush) byId.set('git.push', () => void actions.gitPush?.());
  if (actions.gitPull) byId.set('git.pull', () => void actions.gitPull?.());

  const out: CommandDef[] = [];
  for (const spec of DEFAULT_COMMAND_SPECS) {
    const run = byId.get(spec.id);
    if (!run) continue;
    out.push({ ...spec, run });
  }
  return out;
}
