// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure label and filter helpers for the Layers panel.
 *
 * @module ui/layers/format
 */

import { toolLabel, type Drawing } from '../../chart/drawing-types';

/** Unix seconds or epoch millis → `YYYY-MM-DD HH:MM` UTC, or an em dash. */
export function formatBarTime(t: number): string {
  if (!Number.isFinite(t)) return '—';
  // unix seconds vs ms
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(t);
  }
}

/** Compact USD for on-chain last values (e.g. TVL). */
export function formatCompactUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const v = abs;
  if (v >= 1e12) return `${sign}${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${sign}${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(1)}K`;
  return `${sign}${v.toFixed(0)}`;
}

/** One-line subtitle for an on-chain series row. */
export function onchainSeriesSub(s: {
  provider?: string;
  providerId?: string;
  loading?: boolean;
  error?: unknown;
  lastTvl?: number | null;
}): string {
  return [
    s.provider || s.providerId,
    s.loading ? 'loading…' : null,
    s.error ? 'error' : null,
    s.lastTvl != null ? `$${formatCompactUsd(s.lastTvl)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Short human label for a drawing row. */
export function drawingListLabel(d: Drawing): string {
  switch (d.kind) {
    case 'hline':
      return `H · ${Number(d.price).toFixed(2)}`;
    case 'vline':
      return `V · ${formatBarTime(d.time)}`;
    case 'text':
      return (d.text || d.meta?.text || 'Text').slice(0, 32);
    case 'measure': {
      const dp = d.p2.price - d.p1.price;
      return `Δ ${dp >= 0 ? '+' : ''}${dp.toFixed(2)}`;
    }
    case 'fib':
      return `Fib · ${Math.min(d.p1.price, d.p2.price).toFixed(0)}–${Math.max(d.p1.price, d.p2.price).toFixed(0)}`;
    case 'trend':
    case 'ray':
    case 'extend':
    case 'arrow':
      return `${toolLabel(d.kind)} · ${d.p1.price.toFixed(1)}→${d.p2.price.toFixed(1)}`;
    case 'rect':
    case 'ellipse':
      return toolLabel(d.kind);
    default:
      return toolLabel(d.kind);
  }
}

/** Case-insensitive match on label, tool name, text, and id. Empty query matches all. */
export function drawingMatchesQuery(d: Drawing, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = String(d.text || d.meta?.text || '').toLowerCase();
  return (
    drawingListLabel(d).toLowerCase().includes(q) ||
    toolLabel(d.kind).toLowerCase().includes(q) ||
    d.kind.toLowerCase().includes(q) ||
    text.includes(q) ||
    d.id.toLowerCase().includes(q)
  );
}
