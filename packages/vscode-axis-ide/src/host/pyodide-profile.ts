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
 * Optional Pyodide calculator profile (Task 27 / PR-15 stub).
 *
 * Bars-in only — not stream-owning (engine redesign §5.2). Version matches the
 * AXIS PWA lock. Multi-MB Wasm assets are **not** shipped in this VSIX; enable
 * path is flag + CSP widen only until a later task vendors the runtime.
 */

/** Locked Pyodide runtime version (same as PWA `src/engines/catalog.ts`). */
export const LOCAL_PYODIDE_VERSION = '0.29.5';

/** Setting id in `contributes.configuration` (default **false**). */
export const ALLOW_PYODIDE_SETTING = 'axis.engine.allowPyodide';

/** Calculator profile descriptor — host supplies bars; engine does not own live. */
export type PyodideEngineProfile = {
  id: 'pyodide';
  kind: 'calculator';
  barsIn: true;
  streamOwning: false;
  version: typeof LOCAL_PYODIDE_VERSION;
};

export const PYODIDE_CALCULATOR_PROFILE: PyodideEngineProfile = {
  id: 'pyodide',
  kind: 'calculator',
  barsIn: true,
  streamOwning: false,
  version: LOCAL_PYODIDE_VERSION,
};

/** Coerce a raw setting value; only explicit `true` enables the flag. */
export function isPyodideAllowed(raw: unknown): boolean {
  return raw === true;
}

export type PyodideRuntimeStatus = {
  ready: boolean;
  reason: string;
  version: string;
  profile: PyodideEngineProfile;
};

/**
 * Stub status for probes / UI. Even with the flag on, this VSIX does not load
 * Pyodide Wasm — callers must not assume a calculator is available.
 */
export function pyodideRuntimeStatus(allowed: boolean): PyodideRuntimeStatus {
  if (!allowed) {
    return {
      ready: false,
      reason: `${ALLOW_PYODIDE_SETTING} is false (default)`,
      version: LOCAL_PYODIDE_VERSION,
      profile: PYODIDE_CALCULATOR_PROFILE,
    };
  }
  return {
    ready: false,
    reason: `Pyodide ${LOCAL_PYODIDE_VERSION} calculator stub — Wasm assets not shipped in this VSIX`,
    version: LOCAL_PYODIDE_VERSION,
    profile: PYODIDE_CALCULATOR_PROFILE,
  };
}
