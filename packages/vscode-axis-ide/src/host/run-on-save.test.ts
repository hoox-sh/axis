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
  DEFAULT_RUN_ON_SAVE,
  parseRunOnSave,
  RUN_ON_SAVE_MODES,
} from './run-on-save';

describe('parseRunOnSave', () => {
  test('defaults and aliases', () => {
    expect(DEFAULT_RUN_ON_SAVE).toBe('off');
    expect(RUN_ON_SAVE_MODES).toEqual(['off', 'evaluate', 'run']);
    expect(parseRunOnSave(undefined)).toBe('off');
    expect(parseRunOnSave(null)).toBe('off');
    expect(parseRunOnSave(1)).toBe('off');
    expect(parseRunOnSave('')).toBe('off');
    expect(parseRunOnSave('off')).toBe('off');
    expect(parseRunOnSave(' evaluate ')).toBe('evaluate');
    expect(parseRunOnSave('eval')).toBe('evaluate');
    expect(parseRunOnSave('silent')).toBe('evaluate');
    expect(parseRunOnSave('RUN')).toBe('run');
    expect(parseRunOnSave('autorun')).toBe('run');
    expect(parseRunOnSave('auto')).toBe('run');
  });
});
