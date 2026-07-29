// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Data Window rows: OHLCV + plot series at a bar index / time.
 */

import type { Bar } from '../store/types';

export interface DataViewRow {
  key: string;
  label: string;
  value: string;
  color?: string;
  group: 'ohlcv' | 'series' | 'meta';
}

function fmtNum(v: unknown, digits = 4): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v || '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(digits);
  return n.toPrecision(4);
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '—';
  // ms vs sec
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  } catch {
    return String(t);
  }
}

/** Resolve bar index from crosshair time (nearest). */
export function barIndexAtTime(bars: Bar[], time: number | null | undefined): number {
  if (!bars.length || time == null || !Number.isFinite(time)) return bars.length ? bars.length - 1 : -1;
  // exact
  const exact = bars.findIndex((b) => b.time === time);
  if (exact >= 0) return exact;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < bars.length; i++) {
    const d = Math.abs(bars[i]!.time - time);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface BuildDataViewOpts {
  bars: Bar[];
  /** Crosshair / selected bar time */
  time?: number | null;
  /** Explicit index (wins over time when set) */
  barIndex?: number | null;
  symbol?: string;
  interval?: string;
  series?: Record<string, (number | null | string | boolean)[] | unknown>;
  plotMeta?: Record<string, { title?: string; color?: string | null; kind?: string }>;
}

/**
 * Build ordered Data Window rows for the given bar.
 */
export function buildDataViewRows(opts: BuildDataViewOpts): DataViewRow[] {
  const bars = opts.bars || [];
  if (!bars.length) {
    return [{ key: 'empty', label: 'Bar', value: 'No data', group: 'meta' }];
  }

  let idx =
    opts.barIndex != null && Number.isFinite(opts.barIndex)
      ? Math.trunc(Number(opts.barIndex))
      : barIndexAtTime(bars, opts.time);
  if (idx < 0) idx = 0;
  if (idx >= bars.length) idx = bars.length - 1;
  const bar = bars[idx]!;

  const rows: DataViewRow[] = [
    {
      key: 'symbol',
      label: 'Symbol',
      value: opts.symbol || '—',
      group: 'meta',
    },
    {
      key: 'interval',
      label: 'Interval',
      value: opts.interval || '—',
      group: 'meta',
    },
    {
      key: 'time',
      label: 'Time',
      value: fmtTime(bar.time),
      group: 'meta',
    },
    {
      key: 'index',
      label: 'Bar #',
      value: String(idx),
      group: 'meta',
    },
    { key: 'open', label: 'Open', value: fmtNum(bar.open), group: 'ohlcv' },
    { key: 'high', label: 'High', value: fmtNum(bar.high), group: 'ohlcv' },
    { key: 'low', label: 'Low', value: fmtNum(bar.low), group: 'ohlcv' },
    { key: 'close', label: 'Close', value: fmtNum(bar.close), group: 'ohlcv' },
    {
      key: 'volume',
      label: 'Volume',
      value: bar.volume != null ? fmtNum(bar.volume, 2) : '—',
      group: 'ohlcv',
    },
  ];

  const series = opts.series || {};
  const meta = opts.plotMeta || {};
  const keys = Object.keys(series).filter((k) => !k.startsWith('_') && !k.startsWith('__'));
  keys.sort((a, b) => {
    const ia = meta[a]?.kind === 'bgcolor' ? 1 : 0;
    const ib = meta[b]?.kind === 'bgcolor' ? 1 : 0;
    return ia - ib || a.localeCompare(b);
  });

  for (const k of keys) {
    const arr = series[k];
    if (!Array.isArray(arr)) continue;
    const raw = arr[idx];
    const m = meta[k];
    const kind = m?.kind ? String(m.kind) : 'plot';
    let value: string;
    if (kind === 'bgcolor') {
      value = raw == null || raw === '' ? '—' : String(raw);
    } else if (typeof raw === 'boolean') {
      value = raw ? 'true' : 'false';
    } else {
      value = fmtNum(raw);
    }
    rows.push({
      key: `s_${k}`,
      label: (m?.title && String(m.title)) || k,
      value,
      color: m?.color ? String(m.color) : undefined,
      group: 'series',
    });
  }

  return rows;
}
