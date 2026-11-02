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

import {
  HOST_TO_VIEW,
  HOST_TO_VIEW_TYPES,
  VIEW_TO_HOST,
  decode,
  encode,
  type AxisEnvelope,
  type ChartFullPayload,
  type ChartInitPayload,
  type ChartPluginsPayload,
  type ProtocolError,
  type WebviewReadyPayload,
} from '../protocol';
import {
  type CommittedTrendlineDrawing,
  normalizeCommittedDrawing,
} from './chart-drawings';

export type ChartMessageHandle =
  | { kind: 'reject'; error: ProtocolError }
  | { kind: 'ignore' }
  | {
      kind: 'init';
      envelope: AxisEnvelope<ChartInitPayload>;
      /** Always posted after init (empty bars clears prior series). */
      full: AxisEnvelope<ChartFullPayload>;
    }
  | { kind: 'setTool'; tool: string }
  | { kind: 'commit'; drawing: CommittedTrendlineDrawing }
  | { kind: 'requestReload' };

/**
 * VS Code theme CSS variables the chart shell inherits from the webview host.
 * Values are empty placeholders — the iframe already resolves `var(--vscode-*)`;
 * AXIS chart theme tokens land with paint. Body class remains the kind bridge.
 */
export const CHART_INIT_CSS_VAR_KEYS = [
  '--vscode-editor-background',
  '--vscode-editor-foreground',
  '--vscode-font-family',
  '--vscode-font-size',
] as const;

export function defaultChartCssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CHART_INIT_CSS_VAR_KEYS) {
    out[key] = '';
  }
  return out;
}

const PLUGIN_HUD_KEYS = ['source', 'stream', 'engine', 'storage'] as const;

/** Copy known plugin id strings; arrays / non-objects dropped. */
export function copyChartPlugins(
  raw: ChartInitPayload['plugins'] | undefined,
): ChartPluginsPayload | undefined {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  const out: ChartPluginsPayload = {};
  for (const key of PLUGIN_HUD_KEYS) {
    const v = rec[key];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

/**
 * Build `chart.init` (theme / cssVars / seriesKey / panes — bars go on chart.full).
 */
export function buildChartInitStub(partial?: Partial<ChartInitPayload>): ChartInitPayload {
  const init: ChartInitPayload = {
    theme: partial?.theme ?? 'void',
    cssVars: partial?.cssVars ?? defaultChartCssVars(),
    seriesKey: typeof partial?.seriesKey === 'string' ? partial.seriesKey : '',
    panes: partial?.panes ?? [{ id: 'price', kind: 'price' }],
  };
  if ('drawings' in (partial ?? {}) && partial) {
    init.drawings = partial.drawings;
  }
  if (partial && partial.plugins !== undefined) {
    const plugins = copyChartPlugins(partial.plugins);
    if (plugins) init.plugins = plugins;
  }
  return init;
}

/** Session slice needed after webview.ready — rebuilt per message (no stale init). */
export interface ChartHandshakeSession {
  init: ChartInitPayload;
  /** Always post chart.full (empty bars clears prior series when mock is off). */
  full: ChartFullPayload;
}

/**
 * Handle one untrusted webview → host message for the chart editor.
 * Never throws. Accepts `webview.ready` (view=chart) and replies with `chart.init`
 * (+ `chart.full`). Handles `drawing.setTool` / `drawing.commit` /
 * `chart.requestReload`. Rejects host→view types and bad envelopes.
 *
 * `getSession` is invoked only after a valid ready so callers rebuild from the
 * live document + settings instead of closing over resolve-time snapshots.
 */
export function handleChartWebviewMessage(
  raw: unknown,
  getSession: ChartHandshakeSession | (() => ChartHandshakeSession),
): ChartMessageHandle {
  try {
    const decoded = decode(raw);
    if (!decoded.ok) {
      return { kind: 'reject', error: decoded.error };
    }
    if (HOST_TO_VIEW_TYPES.has(decoded.envelope.type)) {
      return {
        kind: 'reject',
        error: {
          code: 'BAD_TYPE',
          message: `chart webview must not send host→view type "${decoded.envelope.type}"`,
        },
      };
    }
    if (decoded.envelope.type === VIEW_TO_HOST.DrawingSetTool) {
      const payload = decoded.envelope.payload as { tool: string };
      return { kind: 'setTool', tool: payload.tool };
    }
    if (decoded.envelope.type === VIEW_TO_HOST.DrawingCommit) {
      const drawing = normalizeCommittedDrawing(decoded.envelope.payload);
      if (!drawing) {
        return {
          kind: 'reject',
          error: {
            code: 'BAD_PAYLOAD',
            message:
              'drawing.commit requires id, tool "trendline", and two {time,price} points',
          },
        };
      }
      return { kind: 'commit', drawing };
    }
    if (decoded.envelope.type === VIEW_TO_HOST.ChartRequestReload) {
      return { kind: 'requestReload' };
    }
    if (decoded.envelope.type !== VIEW_TO_HOST.WebviewReady) {
      return { kind: 'ignore' };
    }
    const payload = decoded.envelope.payload as WebviewReadyPayload;
    if (payload.view !== 'chart') {
      return {
        kind: 'reject',
        error: {
          code: 'BAD_PAYLOAD',
          message: `chart webview expected view "chart", got "${payload.view}"`,
        },
      };
    }
    const session = typeof getSession === 'function' ? getSession() : getSession;
    const envelope = encode(HOST_TO_VIEW.ChartInit, session.init);
    const full = encode(HOST_TO_VIEW.ChartFull, session.full);
    return { kind: 'init', envelope, full };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      kind: 'reject',
      error: { code: 'BAD_ENVELOPE', message: `chart message handler failed: ${message}` },
    };
  }
}
