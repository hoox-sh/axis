/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Stub ChartHost before importing modules that pull Solid UI (runner, multiplex, load-symbol).
 * Call `installChartHostMock()` at the top of the test file (before other app imports).
 */

import { mock } from 'bun:test';

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
