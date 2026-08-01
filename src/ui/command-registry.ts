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
  toggleTheme: () => void;
  setChartGridMode: (mode: '1' | '2h' | '2v' | '4') => void;
  runScript: () => void | Promise<void>;
  focusSymbol: () => void;
  loadSymbol?: () => void | Promise<void>;
  reloadChart?: () => void | Promise<void>;
  toggleLive?: () => void;
  openSettings?: () => void;
  openPlugins?: () => void;
  openScriptSettings?: () => void;
  resetUiLayout?: () => void;
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
    title: 'Toggle Indicators',
    category: 'panels',
    keywords: ['scripts', 'applied', 'indicator list'],
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
    keywords: ['log.info', 'pine logs', 'script output'],
  },
  // Theme
  {
    id: 'theme.toggle',
    title: 'Toggle Theme',
    category: 'theme',
    keywords: ['dark', 'light', 'appearance', 'mode'],
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
    id: 'action.plugins',
    title: 'Open Plugins',
    category: 'navigation',
    keywords: ['library', 'extensions', 'install'],
  },
  {
    id: 'action.script-settings',
    title: 'Open Script Inputs',
    category: 'actions',
    keywords: ['inputs', 'parameters', 'input.*'],
  },
  {
    id: 'action.reset-ui',
    title: 'Reset UI Layout',
    category: 'actions',
    keywords: ['factory', 'defaults', 'chrome', 'panels reset'],
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
  if (actions.toggleAlerts) byId.set('panel.alerts', actions.toggleAlerts);
  if (actions.loadSymbol) byId.set('action.load-symbol', () => void actions.loadSymbol?.());
  if (actions.reloadChart) byId.set('action.reload-chart', () => void actions.reloadChart?.());
  if (actions.toggleLive) byId.set('action.toggle-live', actions.toggleLive);
  if (actions.openSettings) byId.set('action.settings', actions.openSettings);
  if (actions.openPlugins) byId.set('action.plugins', actions.openPlugins);
  if (actions.openScriptSettings) byId.set('action.script-settings', actions.openScriptSettings);
  if (actions.resetUiLayout) byId.set('action.reset-ui', actions.resetUiLayout);

  const out: CommandDef[] = [];
  for (const spec of DEFAULT_COMMAND_SPECS) {
    const run = byId.get(spec.id);
    if (!run) continue;
    out.push({ ...spec, run });
  }
  return out;
}
