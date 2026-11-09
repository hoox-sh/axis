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
 * Apply an AXIS built-in to the chart (new instance, same path as Run).
 *
 * @module indicators/builtins/apply
 */

import { setStatus } from '../../store';
import { runAndApply, type RunOptions, type RunResult } from '../runner';
import { getBuiltinScript } from './catalog';

/**
 * Outcome of {@link applyBuiltinScript}: the normal run payload plus the
 * catalog id, echoed even when the id is unknown and the run returned an error.
 */
export type ApplyBuiltinResult = RunResult & { builtinId: string };

/**
 * Run a catalog script onto the chart as a **new** applied instance.
 * Does not auto-open Scripts — the plot lands on the chart; the panel is
 * a manager, not a confirmation.
 */
export async function applyBuiltinScript(
  id: string,
  opts: RunOptions = {},
): Promise<ApplyBuiltinResult> {
  const script = getBuiltinScript(id);
  if (!script) {
    const msg = `Unknown built-in script: ${id}`;
    setStatus('error', msg);
    return {
      builtinId: id,
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: msg,
    };
  }
  const result = await runAndApply(script.code, undefined, {
    openResults: false,
    skipEditorDraft: true,
    ...opts,
  });
  return { ...result, builtinId: script.id };
}
