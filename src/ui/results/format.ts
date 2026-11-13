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
 * Pure formatting helpers for the Results studio overlay.
 *
 * No Solid imports: every function here is a plain input → string transform, so
 * the Events and Saved subpages can share them and unit tests can exercise them
 * without a DOM. Moved out of `ResultsModal.tsx`, which had grown past 1.6k
 * lines with these formatters interleaved between signals.
 *
 * @module ui/results/format
 */

import { formatNum } from '../../results/strategy';
import type { ResultMeta } from '../../storage/service';

/** Trigger a browser download for a text payload. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Format a `ResultMeta.startedAt` epoch ms as `2026-08-29 12:34:56` (local). */
export function formatSavedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a run duration for the saved-runs row (e.g. `"234 ms"`, `"1.2s"`). */
export function formatSavedDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

/** Default label for a saved-run row when `meta.label` is missing. */
export function defaultSavedLabel(run: ResultMeta): string {
  const kind = run.scriptKind ?? 'run';
  const at = formatSavedAt(run.startedAt);
  // "Strategy @ 2026-08-29 12:34:56"
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} @ ${at}`;
}

/** Extract symbol/timeframe strings from `ResultMeta.inputs` (engine-fed). */
export function savedRunMarket(run: ResultMeta): { symbol: string; timeframe: string } {
  const inputs = run.inputs ?? {};
  const symbol = String(
    (inputs as Record<string, unknown>)['symbol'] ??
      (inputs as Record<string, unknown>)['ticker'] ??
      '',
  ).trim();
  const timeframe = String(
    (inputs as Record<string, unknown>)['timeframe'] ??
      (inputs as Record<string, unknown>)['interval'] ??
      '',
  ).trim();
  return { symbol, timeframe };
}

/** The subset of a persisted strategy snapshot the Saved row renders. */
export interface SavedStatsSummary {
  trades?: number;
  winRate?: number;
  totalPnl?: number;
  returnPct?: number;
  /** `null` = ∞ (no losing trades); absent = unknown (legacy row). */
  profitFactor?: number | null;
  maxDD?: number;
  avgTrade?: number;
  wins?: number;
  losses?: number;
}

/** Narrow an unknown persisted `stats` blob into {@link SavedStatsSummary}. */
export function readSavedStats(raw: unknown): SavedStatsSummary {
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  const out: SavedStatsSummary = {};
  if (typeof v['trades'] === 'number') out.trades = v['trades'];
  if (typeof v['winRate'] === 'number') out.winRate = v['winRate'];
  if (typeof v['totalPnl'] === 'number') out.totalPnl = v['totalPnl'];
  if (typeof v['returnPct'] === 'number') out.returnPct = v['returnPct'];
  if (typeof v['maxDD'] === 'number') out.maxDD = v['maxDD'];
  if (typeof v['avgTrade'] === 'number') out.avgTrade = v['avgTrade'];
  if (typeof v['wins'] === 'number') out.wins = v['wins'];
  if (typeof v['losses'] === 'number') out.losses = v['losses'];
  if (v['profitFactor'] === null) out.profitFactor = null;
  else if (typeof v['profitFactor'] === 'number') out.profitFactor = v['profitFactor'];
  return out;
}

/** A fraction (`0.042`) as a signed percentage (`+4.20%`). */
export function formatSavedPct(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

/** Profit factor, with `∞` for missing/infinite values. */
export function formatSavedPf(pf: number | null | undefined): string {
  if (pf == null) return '∞';
  if (!Number.isFinite(pf)) return '∞';
  return pf.toFixed(2);
}

/** `unix seconds | epoch ms` → local `YYYY-MM-DD HH:MM` (events grid). */
export function formatEventTime(t: unknown): string {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const ms = n > 1e12 ? n : n * 1000;
  try {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(t);
  }
}

/** Trim trailing zeros from integral quantities, else 4 decimals. */
export function formatFillQty(q: number): string {
  return q % 1 === 0 ? String(q) : q.toFixed(4);
}

/** Position-fill price: 2 decimals for typical symbols, formatNum fallback. */
export function formatPosPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) >= 1 ? n.toFixed(2) : formatNum(n);
}
