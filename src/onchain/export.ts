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
 * CSV / download export helpers for on-chain series and events.
 *
 * Pure serializers for long-format series and event rows; browser download
 * is a thin DOM helper that no-ops when `document` is unavailable (SSR / tests).
 *
 * @module onchain/export
 */

/** One labeled on-chain series for {@link seriesToCsv}. */
export interface ExportSeries {
  label: string;
  points: Array<{ time: number; value: number }>;
}

/** Event row shape accepted by {@link eventsToCsv}. */
export interface ExportEvent {
  time: number;
  type: string;
  title?: string;
  severity?: string;
  price?: number;
}

/** Escape a CSV field when it contains commas, quotes, or newlines. */
function csvCell(v: string | number | undefined | null): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serialize one or more series to **long** CSV: `series,time,value`.
 *
 * Each series contributes one row per point; empty input yields header only.
 */
export function seriesToCsv(
  series: Array<{ label: string; points: Array<{ time: number; value: number }> }>,
): string {
  const header = 'series,time,value';
  if (!Array.isArray(series) || !series.length) return header;

  const rows: string[] = [];
  for (const s of series) {
    if (!s || typeof s !== 'object') continue;
    const label = csvCell(s.label ?? '');
    const points = Array.isArray(s.points) ? s.points : [];
    for (const p of points) {
      if (!p || typeof p !== 'object') continue;
      const time = Number(p.time);
      const value = Number(p.value);
      if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
      rows.push([label, String(time), String(value)].join(','));
    }
  }
  return [header, ...rows].join('\n');
}

/**
 * Serialize events to CSV: `time,type,title,severity,price`.
 *
 * Optional fields are empty cells when absent. Empty input yields header only.
 */
export function eventsToCsv(
  events: Array<{
    time: number;
    type: string;
    title?: string;
    severity?: string;
    price?: number;
  }>,
): string {
  const header = 'time,type,title,severity,price';
  if (!Array.isArray(events) || !events.length) return header;

  const rows: string[] = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const time = Number(e.time);
    if (!Number.isFinite(time)) continue;
    const type = String(e.type ?? '');
    if (!type) continue;
    const title = e.title != null ? String(e.title) : '';
    const severity = e.severity != null ? String(e.severity) : '';
    const price =
      e.price != null && Number.isFinite(Number(e.price)) ? String(Number(e.price)) : '';
    rows.push(
      [String(time), csvCell(type), csvCell(title), csvCell(severity), price].join(','),
    );
  }
  return [header, ...rows].join('\n');
}

/**
 * Trigger a browser download of a text file via Blob + temporary `<a download>`.
 *
 * No-op when `document` is undefined (Node / SSR). Revokes the object URL after click.
 *
 * @param filename - Suggested download name
 * @param content - File body
 * @param mime - MIME type (default `text/plain;charset=utf-8`)
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8',
): void {
  if (typeof document === 'undefined') return;
  try {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.txt';
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // DOM / Blob unavailable — swallow so callers stay fire-and-forget
  }
}
