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
  PROTOCOL_ERROR_CODES,
  VIEW_TO_HOST,
  decode,
  encode,
  type AxisEnvelope,
  type ProtocolError,
  type ResultsFocusPayload,
  type ResultsSetPayload,
} from '../protocol';
import type { ResultsFocusStore } from '../run/results-store';

export type ResultsMessageHandle =
  | { kind: 'reject'; error: ProtocolError }
  | { kind: 'ignore' }
  | { kind: 'ready'; set: AxisEnvelope<ResultsSetPayload> }
  | { kind: 'focus'; runId: string; set: AxisEnvelope<ResultsSetPayload> };

/**
 * Handle one untrusted Results/Strategy webview → host message.
 * Never throws. Accepts `results.ready` and `results.focus`; rejects host→view types.
 */
export function handleResultsWebviewMessage(
  raw: unknown,
  store: Pick<ResultsFocusStore, 'getResultsSetPayload' | 'focusResults'>,
): ResultsMessageHandle {
  try {
    const decoded = decode(raw);
    if (!decoded.ok) {
      return { kind: 'reject', error: decoded.error };
    }
    if (HOST_TO_VIEW_TYPES.has(decoded.envelope.type)) {
      return {
        kind: 'reject',
        error: {
          code: PROTOCOL_ERROR_CODES.BAD_TYPE,
          message: `results panel rejected host→view type: ${decoded.envelope.type}`,
        },
      };
    }

    if (decoded.envelope.type === VIEW_TO_HOST.ResultsReady) {
      return {
        kind: 'ready',
        set: encode(HOST_TO_VIEW.ResultsSet, store.getResultsSetPayload()),
      };
    }

    if (decoded.envelope.type === VIEW_TO_HOST.ResultsFocus) {
      const payload = decoded.envelope.payload as ResultsFocusPayload;
      const runId = typeof payload?.runId === 'string' ? payload.runId : '';
      if (!runId.trim()) {
        return { kind: 'ignore' };
      }
      store.focusResults(runId);
      return {
        kind: 'focus',
        runId: runId.trim(),
        set: encode(HOST_TO_VIEW.ResultsSet, store.getResultsSetPayload()),
      };
    }

    // webview.ready / chart.* etc. — ignore for this panel.
    return { kind: 'ignore' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      kind: 'reject',
      error: {
        code: PROTOCOL_ERROR_CODES.BAD_ENVELOPE,
        message: `results message handle failed: ${message}`,
      },
    };
  }
}

/** Encode a `results.set` from the store snapshot (focus publish path). */
export function encodeResultsSet(
  store: Pick<ResultsFocusStore, 'getResultsSetPayload'>,
): AxisEnvelope<ResultsSetPayload> {
  return encode(HOST_TO_VIEW.ResultsSet, store.getResultsSetPayload());
}
