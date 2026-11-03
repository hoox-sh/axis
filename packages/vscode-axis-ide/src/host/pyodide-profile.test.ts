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

import { describe, expect, test } from 'bun:test';
import {
  ALLOW_PYODIDE_SETTING,
  LOCAL_PYODIDE_VERSION,
  PYODIDE_CALCULATOR_PROFILE,
  isPyodideAllowed,
  pyodideRuntimeStatus,
} from './pyodide-profile';

describe('pyodide calculator profile (Task 27 stub)', () => {
  test('locks LOCAL_PYODIDE_VERSION to 0.29.5', () => {
    expect(LOCAL_PYODIDE_VERSION).toBe('0.29.5');
    expect(PYODIDE_CALCULATOR_PROFILE.version).toBe('0.29.5');
  });

  test('profile is bars-in calculator, not stream-owning', () => {
    expect(PYODIDE_CALCULATOR_PROFILE.id).toBe('pyodide');
    expect(PYODIDE_CALCULATOR_PROFILE.kind).toBe('calculator');
    expect(PYODIDE_CALCULATOR_PROFILE.barsIn).toBe(true);
    expect(PYODIDE_CALCULATOR_PROFILE.streamOwning).toBe(false);
  });

  test('isPyodideAllowed defaults off for non-true values', () => {
    expect(isPyodideAllowed(undefined)).toBe(false);
    expect(isPyodideAllowed(false)).toBe(false);
    expect(isPyodideAllowed(null)).toBe(false);
    expect(isPyodideAllowed('true')).toBe(false);
    expect(isPyodideAllowed(1)).toBe(false);
    expect(isPyodideAllowed(true)).toBe(true);
  });

  test('runtime stub is never ready; flag-off vs assets-not-shipped reasons', () => {
    const off = pyodideRuntimeStatus(false);
    expect(off.ready).toBe(false);
    expect(off.version).toBe(LOCAL_PYODIDE_VERSION);
    expect(off.reason).toContain(ALLOW_PYODIDE_SETTING);
    expect(off.reason).toContain('false');

    const on = pyodideRuntimeStatus(true);
    expect(on.ready).toBe(false);
    expect(on.version).toBe('0.29.5');
    expect(on.reason).toMatch(/not shipped/i);
    expect(on.profile.streamOwning).toBe(false);
  });
});
