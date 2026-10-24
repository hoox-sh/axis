// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Calc worker (hp2 C1): owns one `CalcSession` per series plus the cold
 * history the session replays from.
 *
 * The entry is intentionally thin — all logic lives in the pure
 * `CalcEngine` (`calc-engine.ts`) so unit tests drive the exact code this
 * worker runs. Plot values ride the messages (Pro-API path: the server
 * evaluated Pine); the worker enforces the scratch/commit *series*
 * discipline, it does not re-evaluate.
 *
 * @module hp/workers/calc.worker
 */

import { CalcEngine } from './calc-engine';
import type { CalcToHost, HostToCalc } from './calc-protocol';

interface CalcWorkerScope {
  postMessage: (msg: CalcToHost) => void;
  onmessage: ((ev: MessageEvent<HostToCalc>) => void) | null;
}

const scope = self as unknown as CalcWorkerScope;
const engine = new CalcEngine();

scope.onmessage = (ev: MessageEvent<HostToCalc>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  try {
    const out = engine.dispatch(msg);
    if (out) scope.postMessage(out);
  } catch (err) {
    scope.postMessage({
      type: 'error',
      seriesId: (msg as { seriesId?: unknown }).seriesId as string,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
};
