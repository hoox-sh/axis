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
 * Pine / PYNE bar-state execution context for live apply.
 *
 * Tip updates must not commit `barstate.isconfirmed` accumulators
 * (`ta.cum`, `ta.valuewhen`, `var`). Only an append (or snapshot replay
 * of closed bars) commits.
 *
 * @module hp/calc/execution-context
 */

import { Axb1Opcode } from '../axb1/constants';

/** How the next Pine eval may touch historical state. */
export type ExecutionContext = 'snapshot' | 'tip' | 'append';

export function isExecutionContext(value: unknown): value is ExecutionContext {
  return value === 'snapshot' || value === 'tip' || value === 'append';
}

/**
 * JSON `/ws/live` delta → context.
 *
 * - `forming: true` → tip (scratch only)
 * - `forming: false` → append (commit the closed bar)
 * - omitted `forming`: count growth is an append; same-length tail is a tip
 */
export function executionContextFromDelta(
  delta: { forming?: boolean; count?: number },
  cachedCount?: number,
): ExecutionContext {
  if (delta.forming === true) return 'tip';
  if (delta.forming === false) return 'append';
  if (
    cachedCount != null &&
    typeof delta.count === 'number' &&
    Number.isFinite(delta.count) &&
    delta.count > cachedCount
  ) {
    return 'append';
  }
  return 'tip';
}

/** JSON frame type + payload → context. */
export function executionContextFromJsonFrame(frame: {
  type?: string;
  payload?: { forming?: boolean; count?: number };
}): ExecutionContext {
  const type = frame.type;
  if (type === 'full') return 'snapshot';
  if (type === 'close') return 'append';
  if (type === 'delta') {
    return executionContextFromDelta(frame.payload ?? {});
  }
  return 'snapshot';
}

/** AXB1 opcode → context. */
export function executionContextFromOpcode(opcode: Axb1Opcode): ExecutionContext {
  switch (opcode) {
    case Axb1Opcode.TIP_UPDATE:
    case Axb1Opcode.PLOT_TIP:
      return 'tip';
    case Axb1Opcode.APPEND_BAR:
    case Axb1Opcode.CLOSE_VERIFY:
      return 'append';
    default:
      return 'snapshot';
  }
}
