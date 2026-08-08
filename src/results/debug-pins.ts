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
 * Debug **chart pins** from Pine log / inline-debug entries.
 *
 * Pure helpers: parse `bar_index` / time from structured fields or free text,
 * build pin descriptors, and map them to Lightweight Charts series markers.
 *
 * @module results/debug-pins
 */

import { normalizePyneLogs, type PyneLogEntry, type PyneLogLevel } from './pyne-logs';
import {
  parseSourceLine,
  type InlineDebugAnnotation,
  type InlineDebugLevel,
} from './inline-debug';
import type { TradeMarker } from './events';

/** One chart pin derived from a log / inline-debug annotation. */
export interface DebugPin {
  /** Unix seconds when known (engine time or resolved from bars[barIndex]). */
  time?: number | null;
  /** Pine bar_index / array index when known. */
  barIndex?: number | null;
  /** Short label for marker text / chip tooltip. */
  label: string;
  /** 1-based source line when known. */
  line?: number | null;
  level?: InlineDebugLevel | PyneLogLevel;
  /** Full message (truncated for markers separately). */
  message?: string;
}

/** Loose entry shape accepted by {@link pinsFromDebugEntries}. */
export type DebugPinSource =
  | PyneLogEntry
  | InlineDebugAnnotation
  | {
      message?: string;
      msg?: string;
      text?: string;
      barIndex?: number | null;
      bar_index?: number | null;
      bar?: number | null;
      index?: number | null;
      time?: number | null;
      bar_time?: number | null;
      barTime?: number | null;
      ts?: number | null;
      line?: number | null;
      level?: string;
      severity?: string;
    };

export interface PinsFromDebugOptions {
  /** OHLCV bars (unix seconds) — used to resolve barIndex → time. */
  bars?: ReadonlyArray<{ time: number }> | null;
  /** Cap markers to avoid flooding the chart (default 80). */
  maxPins?: number;
  /**
   * When true, keep entries that only have a source line and no bar/time
   * (default false — those cannot pin a bar).
   */
  includeLineOnly?: boolean;
}

const DEFAULT_MAX_PINS = 80;

const LEVEL_COLOR: Record<string, string> = {
  error: '#e85d4c',
  warning: '#e8a03a',
  info: '#8b8e9c',
  debug: '#939fff',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function messageOf(entry: DebugPinSource): string {
  if (!isRecord(entry) && typeof entry !== 'object') return '';
  const e = entry as Record<string, unknown>;
  const raw = e.message ?? e.msg ?? e.text ?? '';
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function levelOf(entry: DebugPinSource): InlineDebugLevel {
  if (!isRecord(entry) && typeof entry !== 'object') return 'info';
  const e = entry as Record<string, unknown>;
  const raw = String(e.level ?? e.severity ?? 'info').toLowerCase();
  if (raw.includes('err') || raw === 'fatal' || raw === 'critical') return 'error';
  if (raw.includes('warn')) return 'warning';
  if (raw.includes('debug') || raw.includes('trace')) return 'debug';
  return 'info';
}

/**
 * Parse a bar index from free-text log messages.
 * Examples: `bar_index=12`, `bar_index 12`, `bar: 3`, `[bar 5]`, `barIndex: 9`,
 * `at bar 7`, `#bar:3`, trailing `@42`.
 * Returns null when absent or out of a sane range.
 */
export function parseBarIndexFromText(text: string): number | null {
  if (!text) return null;
  const patterns = [
    /\bbar_index\s*[=:]\s*(-?\d+)\b/i,
    /\bbar_index\s+(-?\d+)\b/i,
    /\bbarIndex\s*[=:]\s*(-?\d+)\b/,
    /\[bar\s*(-?\d+)\]/i,
    /#bar\s*[=:]?\s*(-?\d+)\b/i,
    /\bat\s+bar\s+(-?\d+)\b/i,
    /\bbar\s*[=:]\s*(-?\d+)\b/i,
    /@\s*(-?\d+)\s*$/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] != null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && Math.abs(n) < 50_000_000) return Math.trunc(n);
    }
  }
  return null;
}

/**
 * Parse a bar/event time from free text (unix seconds or ms).
 * Examples: `time=1700000000`, `ts: 1700000000000`, `bar_time=…`.
 */
export function parseTimeFromText(text: string): number | null {
  if (!text) return null;
  const patterns = [
    /\bbar_time\s*[=:]\s*(-?\d+(?:\.\d+)?)\b/i,
    /\bbarTime\s*[=:]\s*(-?\d+(?:\.\d+)?)\b/,
    /\btime\s*[=:]\s*(-?\d+(?:\.\d+)?)\b/i,
    /\bts\s*[=:]\s*(-?\d+(?:\.\d+)?)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] != null) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Normalize engine times to unix **seconds** for Lightweight Charts.
 * Values ≥ 1e12 are treated as milliseconds.
 */
export function normalizePinTime(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const n = Number(raw);
  if (Math.abs(n) >= 1e12) return Math.trunc(n / 1000);
  return n;
}

/** Resolve `{ time, barIndex }` using optional bars series. */
export function resolveDebugPinTarget(
  pin: Pick<DebugPin, 'time' | 'barIndex'>,
  bars?: ReadonlyArray<{ time: number }> | null,
): { time: number | null; barIndex: number | null } {
  let time = normalizePinTime(pin.time ?? null);
  let barIndex =
    pin.barIndex != null && Number.isFinite(pin.barIndex) ? Math.trunc(pin.barIndex) : null;

  if (bars?.length) {
    if (time == null && barIndex != null) {
      const b = bars[barIndex];
      if (b && Number.isFinite(b.time)) time = b.time;
    }
    if (barIndex == null && time != null) {
      const exact = bars.findIndex((b) => b.time === time);
      if (exact >= 0) barIndex = exact;
      else {
        // Nearest bar by absolute time delta
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < bars.length; i++) {
          const d = Math.abs(bars[i]!.time - time);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (bestD < Infinity) barIndex = best;
      }
    }
  }

  return { time, barIndex };
}

function structuredBarIndex(entry: DebugPinSource): number | null {
  if (!isRecord(entry) && typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  return asFiniteNumber(e.barIndex ?? e.bar_index ?? e.bar ?? e.index);
}

function structuredTime(entry: DebugPinSource): number | null {
  if (!isRecord(entry) && typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  return asFiniteNumber(e.time ?? e.bar_time ?? e.barTime ?? e.ts);
}

function structuredLine(entry: DebugPinSource): number | null {
  if (!isRecord(entry) && typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const n = asFiniteNumber(e.line ?? e.lineNumber ?? e.line_number ?? e.lineno);
  if (n != null && n >= 1) return Math.trunc(n);
  return null;
}

function makeLabel(opts: {
  line: number | null;
  barIndex: number | null;
  message: string;
  level: string;
}): string {
  if (opts.line != null) return `L${opts.line}`;
  if (opts.barIndex != null) return `#${opts.barIndex}`;
  const short = opts.message.replace(/\s+/g, ' ').trim();
  if (short) return short.length > 12 ? `${short.slice(0, 10)}…` : short;
  return opts.level || 'log';
}

/**
 * Build chart pins from Pine logs / inline-debug annotations.
 * Entries without bar_index or time are skipped (unless `includeLineOnly`).
 * Duplicate bar positions keep the highest-severity pin (error > warning > …).
 */
export function pinsFromDebugEntries(
  entries: ReadonlyArray<DebugPinSource> | null | undefined,
  options: PinsFromDebugOptions = {},
): DebugPin[] {
  if (!entries?.length) return [];
  const maxPins = options.maxPins ?? DEFAULT_MAX_PINS;
  const bars = options.bars ?? null;
  const includeLineOnly = !!options.includeLineOnly;

  const rank = (l: string) =>
    l === 'error' ? 0 : l === 'warning' ? 1 : l === 'debug' ? 2 : 3;

  const out: DebugPin[] = [];
  for (const entry of entries) {
    if (entry == null) continue;
    const message = messageOf(entry);
    let barIndex = structuredBarIndex(entry);
    if (barIndex == null) barIndex = parseBarIndexFromText(message);
    let time = normalizePinTime(structuredTime(entry));
    if (time == null) time = normalizePinTime(parseTimeFromText(message));
    // Prefer structured line; fall back to free-text "line N" / "L12" in message
    const line = structuredLine(entry) ?? parseSourceLine(message);
    const level = levelOf(entry);

    if (barIndex == null && time == null && !includeLineOnly) continue;
    if (barIndex == null && time == null && line == null) continue;

    const resolved = resolveDebugPinTarget({ time, barIndex }, bars);
    const pin: DebugPin = {
      time: resolved.time,
      barIndex: resolved.barIndex,
      line,
      level,
      message: message || undefined,
      label: makeLabel({
        line,
        barIndex: resolved.barIndex ?? barIndex,
        message,
        level,
      }),
    };
    out.push(pin);
  }

  // Collapse by resolved time or barIndex (prefer higher severity)
  const byKey = new Map<string, DebugPin>();
  for (const p of out) {
    const key =
      p.time != null
        ? `t:${p.time}`
        : p.barIndex != null
          ? `b:${p.barIndex}`
          : p.line != null
            ? `l:${p.line}`
            : `m:${p.label}:${p.message ?? ''}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, p);
      continue;
    }
    const better = rank(String(p.level)) < rank(String(prev.level));
    if (better) {
      byKey.set(key, {
        ...p,
        // Keep a line ref if either had one
        line: p.line ?? prev.line,
        message: p.message || prev.message,
      });
    } else {
      byKey.set(key, {
        ...prev,
        line: prev.line ?? p.line,
        message: prev.message || p.message,
      });
    }
  }

  const collapsed = Array.from(byKey.values()).sort((a, b) => {
    // Prefer barIndex for stable log order; fall back to time / line
    const rankKey = (p: DebugPin) => {
      if (p.barIndex != null) return p.barIndex;
      if (p.time != null) return p.time;
      if (p.line != null) return p.line;
      return 0;
    };
    const d = rankKey(a) - rankKey(b);
    if (d !== 0) return d;
    return String(a.label).localeCompare(String(b.label));
  });

  return collapsed.slice(0, Math.max(0, maxPins));
}

/**
 * Map pins to LWC series markers (`TradeMarker` / shape-compatible).
 * Pins without a resolvable `time` are dropped (markers require UTCTimestamp).
 */
export function debugPinsToMarkers(
  pins: ReadonlyArray<DebugPin> | null | undefined,
  bars?: ReadonlyArray<{ time: number }> | null,
): TradeMarker[] {
  if (!pins?.length) return [];
  const markers: TradeMarker[] = [];
  for (const p of pins) {
    const { time } = resolveDebugPinTarget(p, bars);
    if (time == null || !Number.isFinite(time)) continue;
    const level = String(p.level || 'info');
    const color = LEVEL_COLOR[level] ?? LEVEL_COLOR.info!;
    const text = (p.label || '·').slice(0, 16);
    markers.push({
      time,
      position: 'aboveBar',
      color,
      shape: 'circle',
      text,
    });
  }
  return markers.sort((a, b) => a.time - b.time || a.text.localeCompare(b.text));
}

/**
 * Collect pins from a full last-run payload (logs + inline annotations).
 * Convenience for ChartHost / UI — still pure.
 */
export function pinsFromLastRun(
  lastRun: unknown,
  options: PinsFromDebugOptions & {
    /** Precomputed inline annotations (optional; avoids re-parse of lines). */
    annotations?: ReadonlyArray<InlineDebugAnnotation> | null;
    /** When true, also use normalizePyneLogs (default true). */
    fromLogs?: boolean;
  } = {},
): DebugPin[] {
  const sources: DebugPinSource[] = [];

  if (options.fromLogs !== false && lastRun != null) {
    sources.push(...normalizePyneLogs(lastRun));
  }

  if (options.annotations?.length) {
    sources.push(...options.annotations);
  }

  return pinsFromDebugEntries(sources, options);
}

/** Count chart-pinable entries in a last-run payload (for editor tool status). */
export function countDebugPins(
  lastRun: unknown,
  options: PinsFromDebugOptions & {
    annotations?: ReadonlyArray<InlineDebugAnnotation> | null;
    fromLogs?: boolean;
  } = {},
): number {
  return pinsFromLastRun(lastRun, options).length;
}
