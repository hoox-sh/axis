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

import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    contextValue?: string;
    constructor(label: string, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    window: {
      createTreeView: () => ({ dispose() {} }),
    },
  };
});

type LibraryMod = typeof import('./library');
type LayersMod = typeof import('./layers');
type IndicatorsMod = typeof import('./indicators');

let library: LibraryMod;
let layers: LayersMod;
let indicators: IndicatorsMod;

beforeAll(async () => {
  library = await import('./library');
  layers = await import('./layers');
  indicators = await import('./indicators');
});

describe('empty TreeDataProvider getChildren', () => {
  test('library root shows No scripts yet', () => {
    const provider = new library.LibraryTreeProvider();
    const roots = provider.getChildren();
    expect(roots.map((n) => n.label)).toEqual(['No scripts yet']);
    expect(library.libraryRootChildren().map((n) => n.label)).toEqual(['No scripts yet']);
    expect(provider.getChildren(roots[0])).toEqual([]);
  });

  test('indicators root shows No indicators', () => {
    const provider = new indicators.IndicatorsTreeProvider();
    const roots = provider.getChildren();
    expect(roots.map((n) => n.label)).toEqual(['No indicators']);
    expect(indicators.indicatorsRootChildren().map((n) => n.label)).toEqual(['No indicators']);
    expect(provider.getChildren(roots[0])).toEqual([]);
  });

  test('layers root keeps Scripts → Panes → Overlays → On-chain → Drawings', () => {
    const provider = new layers.LayersTreeProvider();
    const roots = provider.getChildren();
    expect(roots.map((n) => n.label)).toEqual([
      'Scripts',
      'Panes',
      'Overlays',
      'On-chain',
      'Drawings',
    ]);
    expect([...layers.LAYER_SECTION_ORDER]).toEqual([
      'Scripts',
      'Panes',
      'Overlays',
      'On-chain',
      'Drawings',
    ]);

    const scripts = roots[0];
    expect(scripts).toBeDefined();
    if (!scripts) throw new Error('expected Scripts section');
    const underScripts = provider.getChildren(scripts);
    expect(underScripts.map((n) => n.label)).toEqual(['No scripts']);
    expect(provider.getChildren(underScripts[0])).toEqual([]);
  });

  test('view ids match contributes fragment (no watchlist)', () => {
    expect(library.LIBRARY_VIEW_ID).toBe('axis.library');
    expect(layers.LAYERS_VIEW_ID).toBe('axis.layers');
    expect(indicators.INDICATORS_VIEW_ID).toBe('axis.indicators');
    expect([
      library.LIBRARY_VIEW_ID,
      layers.LAYERS_VIEW_ID,
      indicators.INDICATORS_VIEW_ID,
    ]).not.toContain('axis.watchlist');
  });
});
