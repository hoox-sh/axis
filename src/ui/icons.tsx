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
 * AXIS icon set — Lucide (https://lucide.dev)
 *
 * Why Lucide: tree-shakable stroke icons, consistent 24×24 grid, ISC license,
 * solid-js package (`lucide-solid`), strong default for modern UIs (shadcn, etc.).
 */

import type { Component, JSX } from 'solid-js';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BringToFront,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Copy,
  Download,
  Eraser,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  List,
  Loader2,
  Lock,
  Magnet,
  Menu,
  Minus,
  Moon,
  MousePointer2,
  PanelRight,
  PanelLeft,
  PanelBottom,
  GripVertical,
  Palette,
  Pencil,
  Pin,
  Play,
  Ruler,
  SendToBack,
  Settings,
  Shapes,
  Square,
  Sun,
  Trash2,
  TrendingUp,
  Type,
  Unlock,
  Upload,
  X,
  ExternalLink,
  SquareArrowOutUpRight,
  ScrollText,
  Wifi,
  WifiOff,
  MoveUpRight,
  Layers,
  Table2,
  type LucideProps,
} from 'lucide-solid';

export type IconProps = LucideProps & { class?: string };

const defaults: Partial<LucideProps> = {
  // 1em tracks --ui-scale via root font-size (density slider)
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

export const Icons = {
  play: withDefaults(Play),
  settings: withDefaults(Settings),
  sun: withDefaults(Sun),
  moon: withDefaults(Moon),
  list: withDefaults(List),
  menu: withDefaults(Menu),
  panelRight: withDefaults(PanelRight),
  panelLeft: withDefaults(PanelLeft),
  panelBottom: withDefaults(PanelBottom),
  grip: withDefaults(GripVertical),
  upload: withDefaults(Upload),
  download: withDefaults(Download),
  copy: withDefaults(Copy),
  check: withDefaults(Check),
  x: withDefaults(X),
  chevronDown: withDefaults(ChevronDown),
  chevronUp: withDefaults(ChevronUp),
  externalLink: withDefaults(ExternalLink),
  popout: withDefaults(SquareArrowOutUpRight),
  fileJson: withDefaults(FileJson),
  fileCsv: withDefaults(FileSpreadsheet),
  folder: withDefaults(FolderOpen),
  loader: withDefaults(Loader2),
  alert: withDefaults(AlertCircle),
  activity: withDefaults(Activity),
  scrollText: withDefaults(ScrollText),
  wifi: withDefaults(Wifi),
  wifiOff: withDefaults(WifiOff),
  // Drawing tools
  cursor: withDefaults(MousePointer2),
  minus: withDefaults(Minus),
  trend: withDefaults(TrendingUp),
  ray: withDefaults(MoveUpRight),
  square: withDefaults(Square),
  fib: withDefaults(Layers),
  layers: withDefaults(Layers),
  table: withDefaults(Table2),
  ruler: withDefaults(Ruler),
  type: withDefaults(Type),
  trash: withDefaults(Trash2),
  eraser: withDefaults(Eraser),
  // Drawing toolbar chrome / prefs
  magnet: withDefaults(Magnet),
  lock: withDefaults(Lock),
  unlock: withDefaults(Unlock),
  pencil: withDefaults(Pencil),
  shapes: withDefaults(Shapes),
  circle: withDefaults(Circle),
  arrowUpRight: withDefaults(ArrowUpRight),
  pin: withDefaults(Pin),
  chevronRight: withDefaults(ChevronRight),
  palette: withDefaults(Palette),
  bringToFront: withDefaults(BringToFront),
  sendToBack: withDefaults(SendToBack),
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
