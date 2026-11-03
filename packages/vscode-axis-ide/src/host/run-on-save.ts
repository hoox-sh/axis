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
 * `axis.run.onSave` — off | evaluate (silent) | run (full chart paint).
 */

export const RUN_ON_SAVE_MODES = ['off', 'evaluate', 'run'] as const;
export type RunOnSaveMode = (typeof RUN_ON_SAVE_MODES)[number];

export const DEFAULT_RUN_ON_SAVE: RunOnSaveMode = 'off';

/** Unknown / empty → off. Non-strings ignored. */
export function parseRunOnSave(raw: unknown): RunOnSaveMode {
  if (typeof raw !== 'string') return DEFAULT_RUN_ON_SAVE;
  const v = raw.trim().toLowerCase();
  if (v === 'evaluate' || v === 'eval' || v === 'silent') return 'evaluate';
  if (v === 'run' || v === 'autorun' || v === 'auto') return 'run';
  return DEFAULT_RUN_ON_SAVE;
}
