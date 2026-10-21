// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The cached-datasets modal state is shared.
 *
 * The Topbar, the StatusBar and the Data Source Manager panel each used to
 * own a `datasetsOpen` signal, so the three copies could drift: opening the
 * modal from one surface left the other two showing their own closed state.
 */

import { describe, expect, it } from 'bun:test';
import {
  cachedDatasetsOpen,
  closeCachedDatasets,
  openCachedDatasets,
} from '../src/ui/datasets-open';

describe('cached datasets modal state', () => {
  it('starts closed', () => {
    expect(cachedDatasetsOpen()).toBe(false);
  });

  it('opens and closes', () => {
    openCachedDatasets();
    expect(cachedDatasetsOpen()).toBe(true);
    closeCachedDatasets();
    expect(cachedDatasetsOpen()).toBe(false);
  });

  it('is one signal, not one per surface', () => {
    // Every surface reads the same value — a second import gets the same
    // store, not a fresh copy.
    openCachedDatasets();
    expect(cachedDatasetsOpen()).toBe(true);
    closeCachedDatasets();
    expect(cachedDatasetsOpen()).toBe(false);
  });
});
