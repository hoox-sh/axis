/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Left-edge history prefetch (concept P5).
 *
 * When the visible logical range reaches the loaded bars, one older page is
 * read from the dataset. The read is async. The chart is not replaced while
 * the user is still dragging, and the commit does not fit the time scale.
 *
 * @module chart/v1/left-prefetch
 */

import { mergeBars } from '../../data/bars-cache';
import { getManager, setDataToChart } from '../manager-access';
import {
  chartWindowLimit,
  clampRollingWindowBars,
  setBarsQuiet,
  setStore,
  store,
  type Bar,
} from '../../store';

/** Start a page when the viewport is this many bars from the left edge. */
export const LEFT_EDGE_MARGIN = 64;

/** One page. Small enough that the commit is one setData, not a reload. */
export const LEFT_EDGE_PAGE = 500;

export function nearLeftEdge(
  range: { from: number; to: number } | null | undefined,
  margin = LEFT_EDGE_MARGIN,
): boolean {
  if (!range || !Number.isFinite(range.from)) return false;
  return range.from < margin;
}

/** Bars strictly older than `oldest`, the newest `page` of them. */
export function olderPage(dataset: readonly Bar[], oldest: number, page = LEFT_EDGE_PAGE): Bar[] {
  if (!dataset.length || !Number.isFinite(oldest) || page <= 0) return [];
  const older: Bar[] = [];
  for (const bar of dataset) {
    if (bar && Number.isFinite(bar.time) && bar.time < oldest) older.push(bar);
  }
  if (older.length <= page) return older;
  return older.slice(older.length - page);
}

/** Logical indexes after `added` bars are inserted on the left. */
export function shiftRangeForPrepend(
  range: { from: number; to: number },
  added: number,
): { from: number; to: number } {
  return { from: range.from + added, to: range.to + added };
}

let busy = false;
let armedFor = 0;
let pending: Bar[] | null = null;
let waitTimer: ReturnType<typeof setTimeout> | null = null;

async function readOlderPage(oldest: number): Promise<Bar[]> {
  const srcId = String(store.source || '');
  const symbol = String(store.symbol || '');
  const interval = String(store.interval || '');
  if (!srcId || !symbol || !interval) return [];
  const { getDataset } = await import('../../data/dataset-store');
  const { providerDatasetLock } = await import('../../data/provider');
  const dataset = await getDataset(srcId, symbol, interval, providerDatasetLock(store.provider));
  return olderPage(dataset, oldest);
}

function commit(page: Bar[]): void {
  const chartBars = store.bars;
  if (!chartBars?.length || !page.length) return;
  const merged = mergeBars(page, [...chartBars]);
  const added = merged.length - chartBars.length;
  if (added <= 0) return;
  const mgr = getManager();
  const price = mgr?.getPane('price');
  let range: { from: number; to: number } | null = null;
  try {
    range = price?.chart.timeScale().getVisibleLogicalRange() ?? null;
  } catch {
    range = null;
  }
  const window = chartWindowLimit();
  if (merged.length > window) {
    setStore('rollingWindowBars', clampRollingWindowBars(merged.length));
  }
  setBarsQuiet(merged);
  setDataToChart(merged, { fit: false, clearMarkers: false, clearScriptState: false });
  if (range && price) {
    try {
      price.chart.timeScale().setVisibleLogicalRange(shiftRangeForPrepend(range, added));
    } catch {
      /* the page is in the store; the viewport can stay */
    }
  }
}

function tryCommit(dragging: () => boolean): void {
  if (!pending) return;
  if (dragging()) {
    if (waitTimer != null) return;
    waitTimer = setTimeout(() => {
      waitTimer = null;
      tryCommit(dragging);
    }, 200);
    return;
  }
  const page = pending;
  pending = null;
  commit(page);
}

/**
 * Arm one older page when the viewport is on the left edge.
 * Returns immediately. Paint waits until `dragging` is false.
 */
export function noteLeftEdge(
  range: { from: number; to: number } | null | undefined,
  dragging: () => boolean = () => false,
): void {
  if (!nearLeftEdge(range)) return;
  const oldest = store.bars?.[0]?.time;
  if (oldest == null || !Number.isFinite(oldest)) return;
  if (busy || armedFor === oldest) {
    if (pending) tryCommit(dragging);
    return;
  }
  busy = true;
  armedFor = oldest;
  void readOlderPage(oldest)
    .then((page) => {
      busy = false;
      if (!page.length) return;
      pending = page;
      tryCommit(dragging);
    })
    .catch(() => {
      busy = false;
    });
}

/** Tests: drop the in-flight page and the armed cursor. */
export function _resetLeftEdgePrefetch(): void {
  busy = false;
  armedFor = 0;
  pending = null;
  if (waitTimer != null) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
}
