// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import * as vscode from 'vscode';

/** Tree node for the Layers view (`axis.layers`). */
export type LayersTreeNode = {
  id: string;
  label: string;
  /** Section roots are collapsible; leaf placeholders are not. */
  collapsible: boolean;
  /** Item count on section roots, e.g. `(0)`. */
  description?: string;
};

export const LAYERS_VIEW_ID = 'axis.layers';

/**
 * PWA LayerPanel order (must stay aligned with `src/ui/LayerPanel.tsx`):
 * Scripts → Panes → Overlays → On-chain → Drawings.
 */
export const LAYER_SECTION_ORDER = [
  'Scripts',
  'Panes',
  'Overlays',
  'On-chain',
  'Drawings',
] as const;

export type LayerSectionTitle = (typeof LAYER_SECTION_ORDER)[number];

const SECTION_EMPTY_LABEL: Record<LayerSectionTitle, string> = {
  Scripts: 'Apply a builtin',
  Panes: 'No panes yet',
  Overlays: 'No overlays yet',
  'On-chain': 'No on-chain yet',
  Drawings: 'No drawings yet',
};

function sectionId(title: LayerSectionTitle): string {
  return `layers.section.${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/** Defensive ThemeIcon — Bun vscode mocks may omit the constructor. */
function tryThemeIcon(id: string): vscode.ThemeIcon | undefined {
  try {
    const Ctor = (
      vscode as { ThemeIcon?: new (iconId: string) => vscode.ThemeIcon }
    ).ThemeIcon;
    if (typeof Ctor === 'function') return new Ctor(id);
  } catch {
    /* mock without ThemeIcon */
  }
  return undefined;
}

/** Untrusted markdown tooltip (no theme icons). */
function tryMarkdownTooltip(lines: readonly string[]): vscode.MarkdownString | string {
  const value = lines.filter((line) => line.length > 0).join('\n');
  try {
    const Ctor = (
      vscode as { MarkdownString?: new (value?: string) => vscode.MarkdownString }
    ).MarkdownString;
    if (typeof Ctor === 'function') {
      const md = new Ctor(value);
      try {
        md.supportThemeIcons = false;
      } catch {
        /* mock */
      }
      try {
        md.isTrusted = false;
      } catch {
        /* mock */
      }
      return md;
    }
  } catch {
    /* mock without MarkdownString */
  }
  return value;
}

/** Root children: empty section shells in PWA order. */
export function layersRootChildren(): LayersTreeNode[] {
  return LAYER_SECTION_ORDER.map((title) => ({
    id: sectionId(title),
    label: title,
    collapsible: true,
    description: '(0)',
  }));
}

/** Children under a section — empty placeholder until chart state is wired. */
export function layersSectionChildren(section: LayersTreeNode): LayersTreeNode[] {
  const title = LAYER_SECTION_ORDER.find((t) => sectionId(t) === section.id);
  if (!title) return [];
  return [
    {
      id: `${section.id}.empty`,
      label: SECTION_EMPTY_LABEL[title],
      collapsible: false,
    },
  ];
}

/** MVP Layers TreeDataProvider — section order only, no chart bindings yet. */
export class LayersTreeProvider implements vscode.TreeDataProvider<LayersTreeNode> {
  getTreeItem(element: LayersTreeNode): vscode.TreeItem {
    const state = element.collapsible
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(element.label, state);
    item.id = element.id;
    item.contextValue = element.collapsible ? 'axis.layers.section' : 'axis.layers.empty';
    if (element.collapsible) {
      item.description = element.description ?? '(0)';
    }
    const icon = tryThemeIcon(element.collapsible ? 'layers' : 'circle-slash');
    if (icon) item.iconPath = icon;
    item.tooltip = tryMarkdownTooltip(['kind: layers', `id: ${element.id}`]);
    return item;
  }

  getChildren(element?: LayersTreeNode): LayersTreeNode[] {
    if (!element) return layersRootChildren();
    if (element.collapsible) return layersSectionChildren(element);
    return [];
  }
}
