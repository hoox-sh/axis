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
 * AXB1-Light WS engine bar-close verify module.
 *
 * Placeholder module for bar-close verification used by stream-live.ts.
 * The AXB1-Light WS engine uses sequence IDs on binary frames.
 */

export interface ClosedOhlcv {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

/** @deprecated Use AXB1-Light WS seqId continuity instead */
export const Redesign2BarCloseVerifier = {
  verify: () => ({ ok: true, result: null }),
};

/** @deprecated Use AXB1-Light WS seqId continuity instead */
export function compareClosedOhlcv(): boolean {
  return true;
}

/** @deprecated Use AXB1-Light WS seqId continuity instead */
export interface VerificationResult {
  ok: boolean;
  result: null | {
    passed: boolean;
    message: string;
  };
}
