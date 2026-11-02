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
 * Workers webview codec. Message shapes live in the pure host model.
 */

import {
  encodeWorkersProbe,
  encodeWorkersProbeAll,
  encodeWorkersReady,
  parseWorkersStudioMessage,
  type WorkerStudioCard,
  type WorkersStudioCounts,
} from '../../../src/views/workers-studio-model';

export {
  encodeWorkersProbe,
  encodeWorkersProbeAll,
  encodeWorkersReady,
  parseWorkersStudioMessage,
};
export type { WorkerStudioCard, WorkersStudioCounts };

export const PROTOCOL_VERSION = 1 as const;

export type WebviewDecodeOk = {
  ok: true;
  type: 'workers.init' | 'workers.state';
  cards: WorkerStudioCard[];
  counts: WorkersStudioCounts;
  probed: boolean;
};

export type WebviewDecodeErr = { ok: false; error: string };
export type WebviewDecodeResult = WebviewDecodeOk | WebviewDecodeErr;

/** Never-throw decode of untrusted host postMessage data. */
export function decodeHostMessage(raw: unknown): WebviewDecodeResult {
  try {
    const msg = parseWorkersStudioMessage(raw);
    if (!msg || (msg.type !== 'workers.init' && msg.type !== 'workers.state')) {
      return { ok: false, error: 'unexpected type' };
    }
    return {
      ok: true,
      type: msg.type,
      cards: msg.cards,
      counts: msg.counts,
      probed: msg.probed,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `decode failed: ${message}` };
  }
}
