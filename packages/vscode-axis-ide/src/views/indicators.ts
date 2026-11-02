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

/** Tree node for the Scripts/indicators view (`axis.indicators`). */
export type IndicatorsTreeNode = {
  id: string;
  label: string;
};

export const INDICATORS_VIEW_ID = 'axis.indicators';

/** Empty applied-scripts placeholder (chart instances land with apply/run). */
export function indicatorsRootChildren(): IndicatorsTreeNode[] {
  return [{ id: 'indicators.empty', label: 'No indicators' }];
}

/** MVP Scripts TreeDataProvider — empty placeholder only. */
export class IndicatorsTreeProvider implements vscode.TreeDataProvider<IndicatorsTreeNode> {
  getTreeItem(element: IndicatorsTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.contextValue = 'axis.indicators.empty';
    return item;
  }

  getChildren(element?: IndicatorsTreeNode): IndicatorsTreeNode[] {
    if (element) return [];
    return indicatorsRootChildren();
  }
}
