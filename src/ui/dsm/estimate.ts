// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live backfill estimate for the Data panel: clock span, dense bar count,
 * and venue pages for a past date through now.
 *
 * @module ui/dsm/estimate
 */

import { expectedBarsInSpan } from '../../data/bars-gaps';
import { fmtBarsAsSpan, fmtDuration } from './format';

export interface BackfillEstimate {
  /** False when the date is missing or not finite. */
  valid: boolean;
  /** True when the UTC date is still ahead of `nowSec`. */
  future: boolean;
  /** Clock span of the requested window. Em dash when not valid. */
  spanLabel: string;
  /** Dense bars for the full window, with a tilde. Em dash when not valid. */
  barsLabel: string;
  /** Venue pages for the full window, with a tilde. Em dash when not valid. */
  pagesLabel: string;
  /** Dense bar count. 0 when the date is unusable. */
  bars: number;
  /** Pages to cover {@link bars} at `pageLimit`. */
  pages: number;
  /** Bars one job will actually walk (cap applied). */
  jobBars: number;
  /** Pages one job will actually walk. */
  jobPages: number;
  /** Page size used for the page count. */
  pageLimit: number;
  /** True when a job cap cuts the requested window. */
  capped: boolean;
  /** One sentence when the date or a cap changes what Start will do. Empty otherwise. */
  note: string;
}

const DASH = '—';

function emptyEstimate(future: boolean, note: string, pageLimit: number): BackfillEstimate {
  return {
    valid: false,
    future,
    spanLabel: DASH,
    barsLabel: DASH,
    pagesLabel: DASH,
    bars: 0,
    pages: 0,
    jobBars: 0,
    jobPages: 0,
    pageLimit,
    capped: false,
    note,
  };
}

/**
 * Estimate a backfill from `fromSec` through `nowSec`.
 * Bar count matches coverage validation. Caps default to the DSM walk limits.
 */
export function estimateBackfill(opts: {
  fromSec: number | null;
  nowSec: number;
  interval: string;
  pageLimit: number;
  maxBars?: number;
  maxPages?: number;
}): BackfillEstimate {
  const maxBars = Math.max(1, Math.floor(opts.maxBars ?? 50_000));
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? 200));
  const pageLimit = Math.max(1, Math.floor(opts.pageLimit) || 1);
  const interval = String(opts.interval || '1d');

  if (opts.fromSec == null || !Number.isFinite(opts.fromSec) || !Number.isFinite(opts.nowSec)) {
    return emptyEstimate(false, '', pageLimit);
  }
  if (opts.fromSec > opts.nowSec) {
    return emptyEstimate(true, 'That date is ahead of now. Pick a UTC date in the past.', pageLimit);
  }

  const bars = expectedBarsInSpan(opts.fromSec, opts.nowSec, interval);
  const pages = Math.max(1, Math.ceil(bars / pageLimit));
  const barCut = Math.min(bars, maxBars);
  let jobPages = Math.max(1, Math.ceil(barCut / pageLimit));
  const pageCut = jobPages > maxPages;
  if (pageCut) jobPages = maxPages;
  const jobBars = Math.min(barCut, jobPages * pageLimit);
  const capped = jobBars < bars;

  let note = '';
  if (capped) {
    const kept = fmtBarsAsSpan(jobBars, interval);
    const ofTf = kept === '—' ? '' : ` (~${kept} of ${interval})`;
    if (pageCut && jobBars < barCut) {
      note = `One job stops after ${maxPages.toLocaleString()} pages (${jobBars.toLocaleString()} bars${ofTf}).`;
    } else {
      note = `One job keeps the newest ${jobBars.toLocaleString()} bars${ofTf}.`;
    }
  }

  return {
    valid: true,
    future: false,
    spanLabel: fmtDuration(opts.fromSec, opts.nowSec),
    barsLabel: `~${bars.toLocaleString()}`,
    pagesLabel: `~${pages.toLocaleString()}`,
    bars,
    pages,
    jobBars,
    jobPages,
    pageLimit,
    capped,
    note,
  };
}
