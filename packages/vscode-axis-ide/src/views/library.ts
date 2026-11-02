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

/** Tree node for the Script Library view (`axis.library`). */
export type LibraryTreeNode = {
  id: string;
  label: string;
};

export const LIBRARY_VIEW_ID = 'axis.library';

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

/** Empty-library placeholder (personal + builtin catalog land later). */
export function libraryRootChildren(): LibraryTreeNode[] {
  return [{ id: 'library.empty', label: 'Apply a builtin' }];
}

/** MVP Script Library TreeDataProvider — empty placeholder only. */
export class LibraryTreeProvider implements vscode.TreeDataProvider<LibraryTreeNode> {
  getTreeItem(element: LibraryTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.contextValue = 'axis.library.empty';
    const icon = tryThemeIcon('book');
    if (icon) item.iconPath = icon;
    item.tooltip = tryMarkdownTooltip(['kind: library', `id: ${element.id}`]);
    return item;
  }

  getChildren(element?: LibraryTreeNode): LibraryTreeNode[] {
    if (element) return [];
    return libraryRootChildren();
  }
}
