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
 * AXIS icon components — Lucide via `lucide-solid`.
 *
 * Exact intent → Lucide map: {@link ./icon-map} (`ICON_MAP`).
 * Prefer `Icons.<key>` everywhere; never import lucide-solid outside this file.
 *
 * @module ui/icons
 */

import type { Component, JSX } from 'solid-js';
import {
  Activity,
  AlertCircle,
  AppWindow,
  AlignLeft,
  Archive,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  BringToFront,
  Cable,
  ChartCandlestick,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardList,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  Fullscreen,
  Gauge,
  GitCommitHorizontal,
  GripVertical,
  HardDrive,
  KeyRound,
  Layers,
  Link2,
  List,
  Loader2,
  Lock,
  Magnet,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Moon,
  MousePointer2,
  MoveHorizontal,
  MoveUpRight,
  Network,
  Package,
  Palette,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Ruler,
  ScrollText,
  Search,
  SendToBack,
  Server,
  Settings,
  Shapes,
  Shuffle,
  Slash,
  SlidersHorizontal,
  Smile,
  Square,
  SquareArrowOutUpRight,
  Sun,
  Table2,
  Terminal,
  Trash2,
  TrendingUp,
  Type,
  Unlock,
  Upload,
  Wifi,
  WifiOff,
  WrapText,
  X,
  Zap,
  type LucideProps,
} from 'lucide-solid';

export {
  ICON_MAP,
  findDuplicateIconGlyphs,
  type IconName,
} from './icon-map';

export type IconProps = LucideProps & { class?: string };

const defaults: Partial<LucideProps> = {
  size: '1em',
  strokeWidth: 2,
  absoluteStrokeWidth: false,
};

function withDefaults(Icon: Component<LucideProps>): Component<IconProps> {
  return (props) => (
    <Icon
      {...defaults}
      {...props}
      class={`sc-icon ${props.class || ''}`.trim()}
    />
  );
}

/**
 * Product icons — keys match {@link ICON_MAP}.
 * Legacy aliases at the bottom share glyphs for gradual migration.
 */
export const Icons = {
  play: withDefaults(Play),
  settings: withDefaults(Settings),
  sun: withDefaults(Sun),
  moon: withDefaults(Moon),
  watchlist: withDefaults(List),
  search: withDefaults(Search),
  menu: withDefaults(Menu),
  panelLeft: withDefaults(PanelLeft),
  panelRight: withDefaults(PanelRight),
  panelBottom: withDefaults(PanelBottom),
  grip: withDefaults(GripVertical),
  upload: withDefaults(Upload),
  download: withDefaults(Download),
  refresh: withDefaults(RefreshCw),
  reset: withDefaults(RotateCcw),
  copy: withDefaults(Copy),
  check: withDefaults(Check),
  x: withDefaults(X),
  chevronDown: withDefaults(ChevronDown),
  chevronUp: withDefaults(ChevronUp),
  chevronRight: withDefaults(ChevronRight),
  externalLink: withDefaults(ExternalLink),
  popout: withDefaults(SquareArrowOutUpRight),
  fileJson: withDefaults(FileJson),
  fileCsv: withDefaults(FileSpreadsheet),
  library: withDefaults(FolderOpen),
  loader: withDefaults(Loader2),
  alert: withDefaults(AlertCircle),
  scripts: withDefaults(ChartCandlestick),
  scriptLogs: withDefaults(ScrollText),
  systemLogs: withDefaults(Terminal),
  status: withDefaults(Gauge),
  wifi: withDefaults(Wifi),
  wifiOff: withDefaults(WifiOff),
  database: withDefaults(Database),
  archive: withDefaults(Archive),
  radio: withDefaults(Radio),
  key: withDefaults(KeyRound),
  shuffle: withDefaults(Shuffle),
  plus: withDefaults(Plus),
  minus: withDefaults(Minus),
  arrowRight: withDefaults(ArrowRight),
  cursor: withDefaults(MousePointer2),
  trend: withDefaults(TrendingUp),
  ray: withDefaults(MoveUpRight),
  extend: withDefaults(MoveHorizontal),
  square: withDefaults(Square),
  fib: withDefaults(GitCommitHorizontal),
  layers: withDefaults(Layers),
  onchain: withDefaults(Link2),
  dataView: withDefaults(Table2),
  dataSource: withDefaults(HardDrive),
  datasets: withDefaults(Package),
  ruler: withDefaults(Ruler),
  type: withDefaults(Type),
  trash: withDefaults(Trash2),
  eraser: withDefaults(Eraser),
  magnet: withDefaults(Magnet),
  lock: withDefaults(Lock),
  unlock: withDefaults(Unlock),
  pencil: withDefaults(Pencil),
  shapes: withDefaults(Shapes),
  circle: withDefaults(Circle),
  arrowUpRight: withDefaults(ArrowUpRight),
  pin: withDefaults(Pin),
  palette: withDefaults(Palette),
  bringToFront: withDefaults(BringToFront),
  sendToBack: withDefaults(SendToBack),
  eye: withDefaults(Eye),
  eyeOff: withDefaults(EyeOff),
  vline: withDefaults(Slash),
  server: withDefaults(Server),
  cpu: withDefaults(Cpu),
  clock: withDefaults(Clock),
  zap: withDefaults(Zap),
  fullscreen: withDefaults(Fullscreen),
  maximize: withDefaults(Maximize2),
  minimize: withDefaults(Minimize2),
  alignLeft: withDefaults(AlignLeft),
  wrapText: withDefaults(WrapText),
  smile: withDefaults(Smile),
  editor: withDefaults(FileCode),
  inputs: withDefaults(SlidersHorizontal),
  alerts: withDefaults(Bell),
  results: withDefaults(ClipboardList),
  architecture: withDefaults(Network),
  runtimes: withDefaults(Boxes),
  studio: withDefaults(AppWindow),
  book: withDefaults(BookOpen),
  cable: withDefaults(Cable),
  barChart: withDefaults(BarChart3),
  activity: withDefaults(Activity),

  // ── Legacy aliases (same glyph as canonical key) ──────────────────────
  /** @deprecated use Icons.watchlist */
  list: withDefaults(List),
  /** @deprecated use Icons.library */
  folder: withDefaults(FolderOpen),
  /** @deprecated use Icons.scriptLogs */
  scrollText: withDefaults(ScrollText),
  /** @deprecated use Icons.onchain */
  chain: withDefaults(Link2),
  /** @deprecated use Icons.dataView */
  table: withDefaults(Table2),
};

/** Inline icon row helper for buttons */
export function IconLabel(props: {
  icon: Component<IconProps>;
  children?: JSX.Element;
  class?: string;
}) {
  const I = props.icon;
  return (
    <span class={`inline-flex items-center gap-1.5 ${props.class || ''}`}>
      <I class="flex-shrink-0 opacity-90" />
      {props.children}
    </span>
  );
}
