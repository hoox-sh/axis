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

import { describe, expect, test } from 'bun:test';
import {
  ACTIVATE_PLUGIN_COMMAND,
  PLUGIN_KIND_VIEW_IDS,
  type PluginKindViewId,
} from './kind-tree-model';
import { PLUGIN_KINDS, type PluginKind } from './types';

describe('kind tree model ids', () => {
  test('activate command and per-kind view ids', () => {
    expect(ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
    expect(PLUGIN_KIND_VIEW_IDS).toEqual({
      source: 'axis.plugins.source',
      stream: 'axis.plugins.stream',
      engine: 'axis.plugins.engine',
      storage: 'axis.plugins.storage',
      dataset: 'axis.plugins.dataset',
      component: 'axis.plugins.component',
    });
    for (const kind of PLUGIN_KINDS) {
      const id: PluginKindViewId = PLUGIN_KIND_VIEW_IDS[kind];
      expect(id).toBe(`axis.plugins.${kind}`);
    }
    const kinds = Object.keys(PLUGIN_KIND_VIEW_IDS) as PluginKind[];
    expect(kinds).toEqual([...PLUGIN_KINDS]);
  });
});
