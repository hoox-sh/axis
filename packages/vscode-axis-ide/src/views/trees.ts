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
 * Library, Layers, and Scripts are WebviewViews registered from activate.
 * Tree providers stay exported for unit tests. This no longer calls createTreeView.
 */
export function registerAxisTreeViews(_context: vscode.ExtensionContext): void {
  void _context;
}
