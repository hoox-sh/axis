/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Stub ChartHost before importing modules that pull Solid UI.
 *
 * Call {@link installChartHostMock} at the **top** of the test file (before
 * runner / multiplex / load-symbol imports) so `getManager` / `setDataToChart`
 * no-op and Solid components are not instantiated in Bun.
 */

import { mock } from 'bun:test';

/** mock.module ChartHost paths used by relative and package-style imports. */
export function installChartHostMock() {
  mock.module('../../src/chart/ChartHost', () => ({
    getManager: () => undefined,
    getDrawingLayer: () => undefined,
    setDataToChart: () => {},
    ChartHost: () => null,
  }));
  // Also resolve absolute-style paths some bundlers use
  mock.module('../chart/ChartHost', () => ({
    getManager: () => undefined,
    getDrawingLayer: () => undefined,
    setDataToChart: () => {},
    ChartHost: () => null,
  }));
}
