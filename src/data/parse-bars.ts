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
 * Parse user-uploaded OHLCV from CSV or JSON into {@link Bar}[], and
 * sanitize/normalize historical bars from any source.
 *
 * Used by the file-upload UI before bars are stored via {@link setUploadedBars}
 * and loaded through the `csv-upload` source. {@link normalizeHistoricalBars}
 * is also used by `load-symbol` after plugin fetch.
 *
 * ## Formats
 *
 * **CSV** (header optional): `time,open,high,low,close[,volume]`
 * - Separators: comma, semicolon, or tab; quoted fields supported
 * - `time` = unix seconds, unix ms, or ISO date string
 * - `#` comment lines ignored; rows sorted ascending by time
 *
 * **JSON**: array of objects, array of `[t,o,h,l,c,v?]`, or
 * `{ bars|data|candles: [...] }`. Object keys are case-insensitive
 * (`time`/`timestamp`/`date`, `open`/`o`, …).
 *
 * ## Public API
 *
 * - {@link parseOhlcvText} — string + optional file name hint
 * - {@link parseOhlcvFile} — browser `File` helper
 * - {@link normalizeBarTime} — ms→seconds, reject non-finite / non-positive
 * - {@link sanitizeBar} — single bar: finite OHLCV, mild high/low repair
 * - {@link normalizeHistoricalBars} — array sanitize + sort + dedupe + limit
 *
 * @module data/parse-bars
 */

import type { Bar } from '../store/types';

/** Unix seconds past ~year 2100 — reject clearly absurd post-normalize times. */
const MAX_UNIX_SECONDS = 4_102_444_800;

/**
 * Coerce a raw timestamp to unix **seconds**.
 * Accepts seconds, milliseconds (&gt;1e12), and drops non-finite / non-positive.
 */
export function normalizeBarTime(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else {
    const s = String(raw).trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) n = parseFloat(s);
    else {
      const ms = Date.parse(s);
      if (Number.isNaN(ms)) return null;
      n = ms; // Date.parse is ms → fold into ms branch below
      // treat as ms always from Date.parse
      const t = Math.floor(ms / 1000);
      return t > 0 && t <= MAX_UNIX_SECONDS ? t : null;
    }
  }
  if (!Number.isFinite(n)) return null;
  // ms if larger than year ~2001 in ms-as-if-seconds threshold
  let t = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  // microsecond-ish leftovers
  if (t > 1e12) t = Math.floor(t / 1000);
  if (!Number.isFinite(t) || t <= 0 || t > MAX_UNIX_SECONDS) return null;
  return t;
}

function toUnixSeconds(raw: unknown): number | null {
  return normalizeBarTime(raw);
}

function num(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Repair mild OHLC inconsistencies (high below open/close, low above).
 * Returns null if values are non-finite or still inverted after repair.
 */
function repairOhlc(
  open: number,
  high: number,
  low: number,
  close: number,
): { open: number; high: number; low: number; close: number } | null {
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }
  const maxOC = Math.max(open, close);
  const minOC = Math.min(open, close);
  let h = high < maxOC ? maxOC : high;
  let l = low > minOC ? minOC : low;
  if (h < l) {
    // swap if fully inverted
    const tmp = h;
    h = l;
    l = tmp;
  }
  if (h < l || !Number.isFinite(h) || !Number.isFinite(l)) return null;
  return { open, high: h, low: l, close };
}

/**
 * Sanitize one bar-like object into a chart-safe {@link Bar}, or null if
 * time/OHLC is missing, non-finite, or unusable.
 */
export function sanitizeBar(raw: unknown): Bar | null {
  if (raw == null || typeof raw !== 'object') return null;

  try {
    if (Array.isArray(raw)) {
      if (raw.length < 5) return null;
      const time = toUnixSeconds(raw[0]);
      const open = num(raw[1]);
      const high = num(raw[2]);
      const low = num(raw[3]);
      const close = num(raw[4]);
      if (time == null || open == null || high == null || low == null || close == null) return null;
      const ohlc = repairOhlc(open, high, low, close);
      if (!ohlc) return null;
      const volume = raw.length > 5 ? num(raw[5]) : null;
      const bar: Bar = { time, ...ohlc };
      if (volume != null && volume >= 0) bar.volume = volume;
      return bar;
    }

    const row = raw as Record<string, unknown>;
    const lower: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof k === 'string') lower[k.toLowerCase()] = v;
    }

    const time = toUnixSeconds(
      lower.time ?? lower.timestamp ?? lower.date ?? lower.datetime ?? lower.t,
    );
    const open = num(lower.open ?? lower.o);
    const high = num(lower.high ?? lower.h);
    const low = num(lower.low ?? lower.l);
    const close = num(lower.close ?? lower.c);
    if (time == null || open == null || high == null || low == null || close == null) return null;
    const ohlc = repairOhlc(open, high, low, close);
    if (!ohlc) return null;
    const volRaw = num(lower.volume ?? lower.vol ?? lower.v);
    const bar: Bar = { time, ...ohlc };
    if (volRaw != null && volRaw >= 0) bar.volume = volRaw;
    if (typeof lower.closed === 'boolean') bar.closed = lower.closed;
    return bar;
  } catch {
    return null;
  }
}

/**
 * Unwrap common API envelopes so partial/malformed payloads do not throw.
 * Accepts a bare array or `{ bars|data|candles|klines|result: [...] }`.
 */
function coerceBarList(bars: unknown): unknown[] | null {
  if (bars == null) return null;
  if (Array.isArray(bars)) return bars;
  if (typeof bars !== 'object') return null;
  try {
    const o = bars as Record<string, unknown>;
    const nested = o.bars ?? o.data ?? o.candles ?? o.klines ?? o.result;
    if (Array.isArray(nested)) return nested;
    // One more level: { result: { list: [...] } } (Bybit-style leftovers)
    if (nested != null && typeof nested === 'object' && !Array.isArray(nested)) {
      const inner = nested as Record<string, unknown>;
      const list = inner.list ?? inner.bars ?? inner.data;
      if (Array.isArray(list)) return list;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Normalize a source/plugin bar list: drop invalid rows, ms→s, sort ascending,
 * dedupe same timestamps (last wins), optionally keep the newest `limit` bars.
 * Never throws — bad payloads yield `[]`.
 */
export function normalizeHistoricalBars(
  bars: unknown,
  opts?: { limit?: number },
): Bar[] {
  const rows = coerceBarList(bars);
  if (!rows || rows.length === 0) return [];

  const out: Bar[] = [];
  for (const row of rows) {
    try {
      const bar = sanitizeBar(row);
      if (bar) out.push(bar);
    } catch {
      /* skip poison row */
    }
  }
  if (!out.length) return [];

  out.sort((a, b) => a.time - b.time);

  // Dedupe identical open times — keep last (most recent write for that stamp)
  const deduped: Bar[] = [];
  for (const b of out) {
    if (deduped.length && deduped[deduped.length - 1]!.time === b.time) {
      deduped[deduped.length - 1] = b;
    } else {
      deduped.push(b);
    }
  }

  const limit = opts?.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0 && deduped.length > limit) {
    return deduped.slice(-Math.floor(limit));
  }
  return deduped;
}

function rowToBar(row: Record<string, unknown> | unknown[]): Bar | null {
  return sanitizeBar(row);
}

function parseCsv(text: string): Bar[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (!lines.length) return [];

  const first = lines[0].toLowerCase();
  const hasHeader =
    first.includes('time') ||
    first.includes('date') ||
    first.includes('open') ||
    first.includes('close');

  let headers: string[] | null = null;
  let start = 0;
  if (hasHeader) {
    headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    start = 1;
  }

  const bars: Bar[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    let bar: Bar | null;
    if (headers) {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        obj[h] = cells[idx];
      });
      bar = rowToBar(obj);
    } else {
      bar = rowToBar(cells);
    }
    if (bar) bars.push(bar);
  }
  return normalizeHistoricalBars(bars);
}

/** Minimal CSV split (handles quoted fields). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseJson(text: string): Bar[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON: ${msg}`);
  }
  const rows = coerceBarList(data);
  if (!rows) {
    throw new Error('JSON must be an array of bars or { bars: [...] }');
  }
  return normalizeHistoricalBars(rows);
}

/**
 * Parse OHLCV from raw text. Format is inferred from `fileName` extension
 * or content (`[` / `{` → JSON, else CSV).
 * @throws If empty or no valid rows
 */
export function parseOhlcvText(text: string, fileName = ''): Bar[] {
  if (text == null || typeof text !== 'string') {
    throw new Error('File is empty');
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error('File is empty');
  const lower = String(fileName || '').toLowerCase();
  const asJson =
    lower.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{');
  let bars: Bar[];
  try {
    bars = asJson ? parseJson(trimmed) : parseCsv(trimmed);
  } catch (e: unknown) {
    // Re-throw structured parse errors; wrap unexpected ones
    if (e instanceof Error && /empty|No valid|Invalid JSON|JSON must/i.test(e.message)) {
      throw e;
    }
    throw new Error(
      e instanceof Error ? e.message : `Parse failed: ${String(e)}`,
    );
  }
  if (!bars.length) {
    throw new Error('No valid OHLCV rows found (need time,open,high,low,close)');
  }
  return bars;
}

/** Read a browser File and parse via {@link parseOhlcvText}. */
export async function parseOhlcvFile(file: File): Promise<Bar[]> {
  const text = await file.text();
  return parseOhlcvText(text, file.name);
}
