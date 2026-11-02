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

/**
 * Shared contracts for per-kind plugin TreeViews (no vscode import).
 */

import type { PluginKind } from './types';

export const ACTIVATE_PLUGIN_COMMAND = 'axis.plugins.activate';

export const PLUGIN_KIND_VIEW_IDS = {
  source: 'axis.plugins.source',
  stream: 'axis.plugins.stream',
  engine: 'axis.plugins.engine',
  storage: 'axis.plugins.storage',
  dataset: 'axis.plugins.dataset',
  component: 'axis.plugins.component',
} as const;

export type PluginKindViewId = (typeof PLUGIN_KIND_VIEW_IDS)[PluginKind];

export type KindViewDeps = {
  isActive: (kind: PluginKind, id: string) => boolean;
  onActivate: (kind: PluginKind, id: string) => void | Thenable<void>;
};
