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
 * Exact AXIS icon map — **intent → Lucide component name**.
 *
 * Pure data (no Lucide/Solid imports) so tests and docs can audit uniqueness.
 * Runtime components live in {@link ./icons} (`Icons.<key>`).
 *
 * ## Rules
 * 1. Import Lucide only in `icons.tsx`.
 * 2. One Lucide glyph → one canonical key (no shared glyphs in this map).
 * 3. Keys name product intent, not the Lucide file name.
 * 4. Per-panel glyph routing lives in {@link PANEL_ICON} — keep that table in
 *    sync when adding a {@link PanelId}.
 *
 * | Icons key | Lucide | Intent |
 * |-----------|--------|--------|
 * | play | Play | Run / replay |
 * | settings | Settings | App settings only |
 * | sun / moon | Sun / Moon | Theme |
 * | watchlist | List | Watchlist panel |
 * | search | Search | Symbol browse |
 * | menu | Menu | Hamburger |
 * | panelLeft / Right / Bottom | Panel* | Dock |
 * | grip | GripVertical | Drag handle |
 * | upload / download | Upload / Download | File / load history |
 * | refresh / reset | RefreshCw / RotateCcw | Reload / defaults |
 * | copy / check / x | Copy / Check / X | Clipboard / ok / close |
 * | chevron* | Chevron* | Disclosure |
 * | externalLink | ExternalLink | New tab |
 * | popout | SquareArrowOutUpRight | Companion window |
 * | fileJson / fileCsv | FileJson / FileSpreadsheet | Export |
 * | library | FolderOpen | Script library |
 * | loader | Loader2 | Busy |
 * | alert | AlertCircle | Warning |
 * | scripts | ChartCandlestick | Scripts panel |
 * | scriptLogs | ScrollText | Pine logs |
 * | systemLogs | Terminal | System logs |
 * | status | Gauge | Status bar |
 * | wifi / wifiOff | Wifi / WifiOff | Live stream |
 * | database / archive | Database / Archive | Storage |
 * | radio / key | Radio / KeyRound | Live / secrets |
 * | shuffle / plus / minus | Shuffle / Plus / Minus | Reorder / add / remove |
 * | arrowRight | ArrowRight | Forward |
 * | cursor / trend / ray / extend | MousePointer2 / TrendingUp / MoveUpRight / MoveHorizontal | Draw tools |
 * | square / fib | Square / GitCommitHorizontal | Rect / fib |
 * | layers | Layers | Layers panel |
 * | onchain | Link2 | On-chain |
 * | dataView | Table2 | Data window values |
 * | dataSource | HardDrive | DSM panel |
 * | datasets | Package | Cached datasets |
 * | ruler / type | Ruler / Type | Ruler / types |
 * | trash / eraser | Trash2 / Eraser | Delete / erase |
 * | magnet / lock / unlock | Magnet / Lock / Unlock | Snap / lock |
 * | pencil / shapes / circle | Pencil / Shapes / Circle | Draw |
 * | arrowUpRight / pin | ArrowUpRight / Pin | Arrow / pins |
 * | palette | Palette | Colors |
 * | bringToFront / sendToBack | BringToFront / SendToBack | Z-order |
 * | eye / eyeOff | Eye / EyeOff | Visibility |
 * | vline | Slash | Vertical line |
 * | server / cpu / clock / zap | Server / Cpu / Clock / Zap | Engines |
 * | fullscreen / maximize / minimize | Fullscreen / Maximize2 / Minimize2 | Presentation |
 * | alignLeft / wrapText | AlignLeft / WrapText | Format / wrap |
 * | smile | Smile | Emoji picker |
 * | editor | FileCode | Editor panel |
 * | inputs | SlidersHorizontal | Script inputs |
 * | alerts | Bell | Alerts panel |
 * | results | ClipboardList | Results panel |
 * | architecture | Network | Wire / architecture |
 * | runtimes | Boxes | Runtimes hub |
 * | studio | AppWindow | Studio overlay |
 * | book / cable / barChart | BookOpen / Cable / BarChart3 | Docs / wire / stats |
 * | activity | Activity | Generic pulse (non-panel) |
 *
 * @module ui/icon-map
 */

import type { PanelId } from './panels/types';

export const ICON_MAP = {
  play: 'Play',
  settings: 'Settings',
  sun: 'Sun',
  moon: 'Moon',
  watchlist: 'List',
  search: 'Search',
  menu: 'Menu',
  panelLeft: 'PanelLeft',
  panelRight: 'PanelRight',
  panelBottom: 'PanelBottom',
  grip: 'GripVertical',
  upload: 'Upload',
  download: 'Download',
  refresh: 'RefreshCw',
  reset: 'RotateCcw',
  copy: 'Copy',
  check: 'Check',
  x: 'X',
  chevronDown: 'ChevronDown',
  chevronUp: 'ChevronUp',
  chevronRight: 'ChevronRight',
  externalLink: 'ExternalLink',
  popout: 'SquareArrowOutUpRight',
  fileJson: 'FileJson',
  fileCsv: 'FileSpreadsheet',
  library: 'FolderOpen',
  loader: 'Loader2',
  alert: 'AlertCircle',
  scripts: 'ChartCandlestick',
  scriptLogs: 'ScrollText',
  systemLogs: 'Terminal',
  status: 'Gauge',
  wifi: 'Wifi',
  wifiOff: 'WifiOff',
  database: 'Database',
  archive: 'Archive',
  radio: 'Radio',
  key: 'KeyRound',
  shuffle: 'Shuffle',
  plus: 'Plus',
  minus: 'Minus',
  arrowRight: 'ArrowRight',
  cursor: 'MousePointer2',
  trend: 'TrendingUp',
  ray: 'MoveUpRight',
  extend: 'MoveHorizontal',
  square: 'Square',
  fib: 'GitCommitHorizontal',
  layers: 'Layers',
  onchain: 'Link2',
  dataView: 'Table2',
  dataSource: 'HardDrive',
  datasets: 'Package',
  ruler: 'Ruler',
  type: 'Type',
  trash: 'Trash2',
  eraser: 'Eraser',
  magnet: 'Magnet',
  lock: 'Lock',
  unlock: 'Unlock',
  pencil: 'Pencil',
  shapes: 'Shapes',
  circle: 'Circle',
  arrowUpRight: 'ArrowUpRight',
  pin: 'Pin',
  palette: 'Palette',
  bringToFront: 'BringToFront',
  sendToBack: 'SendToBack',
  eye: 'Eye',
  eyeOff: 'EyeOff',
  vline: 'Slash',
  server: 'Server',
  cpu: 'Cpu',
  clock: 'Clock',
  zap: 'Zap',
  fullscreen: 'Fullscreen',
  maximize: 'Maximize2',
  minimize: 'Minimize2',
  alignLeft: 'AlignLeft',
  wrapText: 'WrapText',
  smile: 'Smile',
  editor: 'FileCode',
  inputs: 'SlidersHorizontal',
  alerts: 'Bell',
  results: 'ClipboardList',
  architecture: 'Network',
  runtimes: 'Boxes',
  studio: 'AppWindow',
  book: 'BookOpen',
  cable: 'Cable',
  barChart: 'BarChart3',
  activity: 'Activity',
} as const;

export type IconName = keyof typeof ICON_MAP;

/**
 * Per-panel icon routing — `PanelId → IconName`.
 *
 * Single source of truth for which glyph identifies a panel:
 * - `FloatableShell` panel header renders this next to the hamburger menu
 *   (`data-testid="axis-panel-header-icon-{panelId}"`).
 * - `Topbar` panel-toggle buttons resolve the same glyph by reading this map,
 *   so a panel always carries the same icon from header to toggle.
 *
 * Every {@link PanelId} must be present — TypeScript enforces exhaustiveness via
 * `Record<PanelId, IconName>`. Add an entry when you add a panel; mirror the
 * choice in `Topbar.tsx` if you want the toggle there too.
 */
export const PANEL_ICON: Record<PanelId, IconName> = {
  watchlist: 'watchlist',
  indicators: 'scripts',
  editor: 'editor',
  logs: 'systemLogs',
  scriptlogs: 'scriptLogs',
  statusbar: 'status',
  dataview: 'dataView',
  layers: 'layers',
  alerts: 'alerts',
  library: 'library',
  datasource: 'dataSource',
  onchain: 'onchain',
};

/** Lucide names bound more than once (must be empty for {@link ICON_MAP}). */
export function findDuplicateIconGlyphs(
  map: Record<string, string> = ICON_MAP as Record<string, string>,
): string[] {
  const seen = new Map<string, string[]>();
  for (const [key, lucide] of Object.entries(map)) {
    const list = seen.get(lucide) || [];
    list.push(key);
    seen.set(lucide, list);
  }
  return [...seen.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([lucide, keys]) => `${lucide}: ${keys.join(', ')}`);
}
