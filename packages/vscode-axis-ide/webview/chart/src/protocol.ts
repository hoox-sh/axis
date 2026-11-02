// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal host→webview decode for the chart shell (mirrors axis.webview.v1).
 * Keeps the Vite bundle free of the full host protocol module.
 */

export const PROTOCOL_VERSION = 1 as const;

const HOST_TYPES = new Set([
  'chart.init',
  'chart.full',
  'chart.delta',
  'chart.theme',
  'chart.drawing.apply',
  'host.run.status',
  'host.error',
  'results.set',
]);

export type WebviewDecodeOk = {
  ok: true;
  type: string;
  payload: Record<string, unknown>;
};
export type WebviewDecodeErr = { ok: false; error: string };
export type WebviewDecodeResult = WebviewDecodeOk | WebviewDecodeErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Never-throw decode of untrusted host postMessage data. */
export function decodeHostMessage(raw: unknown): WebviewDecodeResult {
  try {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'envelope must be a non-null object' };
    }
    if (raw.v !== PROTOCOL_VERSION) {
      return { ok: false, error: `unsupported protocol version: ${String(raw.v)}` };
    }
    if (typeof raw.type !== 'string' || raw.type.length === 0) {
      return { ok: false, error: 'type must be a non-empty string' };
    }
    if (!HOST_TYPES.has(raw.type)) {
      return { ok: false, error: `unexpected or view→host type: ${raw.type}` };
    }
    if (typeof raw.ts !== 'number' || !Number.isFinite(raw.ts)) {
      return { ok: false, error: 'ts must be a finite number' };
    }
    if (!('payload' in raw) || !isPlainObject(raw.payload)) {
      return { ok: false, error: 'payload must be a plain object' };
    }
    return { ok: true, type: raw.type, payload: raw.payload };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `decode failed: ${message}` };
  }
}

/** Allowlisted chart.init fields applied to the shell (ignore unknown keys). */
export function pickChartInitFields(payload: Record<string, unknown>): {
  theme: unknown;
  cssVars: unknown;
  seriesKey: string;
  panes: unknown;
} {
  return {
    theme: payload.theme,
    cssVars: payload.cssVars,
    seriesKey: typeof payload.seriesKey === 'string' ? payload.seriesKey : '',
    panes: payload.panes,
  };
}
