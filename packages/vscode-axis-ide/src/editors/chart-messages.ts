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
  type ChartInitPayload,
  type ProtocolError,
  type WebviewReadyPayload,
} from '../protocol';

export type ChartMessageHandle =
  | { kind: 'reject'; error: ProtocolError }
  | { kind: 'ignore' }
  | { kind: 'init'; envelope: AxisEnvelope<ChartInitPayload> };

/**
 * VS Code theme CSS variables the chart shell inherits from the webview host.
 * Values are empty placeholders — the iframe already resolves `var(--vscode-*)`;
 * AXIS chart theme tokens land with Task 07 paint. Body class remains the kind bridge.
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

/**
 * Build the PR-04 `chart.init` stub (theme / cssVars / seriesKey / panes — no bars).
 */
export function buildChartInitStub(partial?: Partial<ChartInitPayload>): ChartInitPayload {
  return {
    theme: partial?.theme ?? 'void',
    cssVars: partial?.cssVars ?? defaultChartCssVars(),
    seriesKey: typeof partial?.seriesKey === 'string' ? partial.seriesKey : '',
    panes: partial?.panes ?? [{ id: 'price', kind: 'price' }],
  };
}

/**
 * Handle one untrusted webview → host message for the chart editor.
 * Never throws. Accepts `webview.ready` (view=chart) and replies with `chart.init`.
 * Rejects host→view types (wrong direction) and bad envelopes.
 */
export function handleChartWebviewMessage(
  raw: unknown,
  init: ChartInitPayload,
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
    const envelope = encode(HOST_TO_VIEW.ChartInit, init);
    return { kind: 'init', envelope };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      kind: 'reject',
      error: { code: 'BAD_ENVELOPE', message: `chart message handler failed: ${message}` },
    };
  }
}
