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

import type * as vscode from 'vscode';
import { window } from 'vscode';
import { INDICATORS_VIEW_ID, IndicatorsTreeProvider } from './indicators';
import { LAYERS_VIEW_ID, LayersTreeProvider } from './layers';
import { LIBRARY_VIEW_ID, LibraryTreeProvider } from './library';

export {
  INDICATORS_VIEW_ID,
  IndicatorsTreeProvider,
  indicatorsRootChildren,
} from './indicators';
export {
  LAYER_SECTION_ORDER,
  LAYERS_VIEW_ID,
  LayersTreeProvider,
  layersRootChildren,
  layersSectionChildren,
} from './layers';
export {
  LIBRARY_VIEW_ID,
  LibraryTreeProvider,
  libraryRootChildren,
} from './library';

/**
 * Register Library / Layers / Scripts TreeViews.
 * Watchlist + Alerts register via `registerWatchlist` / `registerAlertsView`.
 */
export function registerAxisTreeViews(context: vscode.ExtensionContext): void {
  const library = window.createTreeView(LIBRARY_VIEW_ID, {
    treeDataProvider: new LibraryTreeProvider(),
    showCollapseAll: false,
  });
  const layers = window.createTreeView(LAYERS_VIEW_ID, {
    treeDataProvider: new LayersTreeProvider(),
    showCollapseAll: true,
  });
  const indicators = window.createTreeView(INDICATORS_VIEW_ID, {
    treeDataProvider: new IndicatorsTreeProvider(),
    showCollapseAll: false,
  });
  context.subscriptions.push(library, layers, indicators);
}
