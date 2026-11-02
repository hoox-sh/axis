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
import { isVersionOlderThan } from './semver';

describe('isVersionOlderThan', () => {
  test('equal release versions are not older', () => {
    expect(isVersionOlderThan('0.5.4', '0.5.4')).toBe(false);
    expect(isVersionOlderThan('v0.5.4', '0.5.4')).toBe(false);
  });

  test('detects older and newer', () => {
    expect(isVersionOlderThan('0.5.3', '0.5.4')).toBe(true);
    expect(isVersionOlderThan('0.5.4', '0.5.3')).toBe(false);
    expect(isVersionOlderThan('0.4.9', '0.5.0')).toBe(true);
    expect(isVersionOlderThan('1.0.0', '0.9.9')).toBe(false);
    // Lexicographic filename sort would get these wrong (0.5.4 > 0.5.10 as strings).
    expect(isVersionOlderThan('0.5.4', '0.5.10')).toBe(true);
    expect(isVersionOlderThan('0.9.0', '0.10.0')).toBe(true);
  });

  test('strips leading v', () => {
    expect(isVersionOlderThan('v0.5.3', 'v0.5.4')).toBe(true);
  });

  test('ignores prerelease/build (release-segment only)', () => {
    expect(isVersionOlderThan('0.5.4-beta', '0.5.4')).toBe(false);
    expect(isVersionOlderThan('0.5.4+build.1', '0.5.4')).toBe(false);
    expect(isVersionOlderThan('0.5.3-beta', '0.5.4')).toBe(true);
  });

  test('empty version is older than a real min; empty min is never older-than', () => {
    expect(isVersionOlderThan('', '0.5.4')).toBe(true);
    expect(isVersionOlderThan('0.5.4', '')).toBe(false);
    expect(isVersionOlderThan('', '')).toBe(false);
  });
});
