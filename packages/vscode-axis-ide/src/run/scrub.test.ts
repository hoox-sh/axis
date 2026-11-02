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
import { scrubSecrets } from './scrub';

const PRO = 'pyn_abcdefghijklmnopqrstuvwxyz0123456789';
const WORKER = 'pn_' + 'a'.repeat(48);

describe('scrubSecrets', () => {
  test('redacts pyn_ / pn_ / Bearer tokens', () => {
    const out = scrubSecrets(`fail Bearer ${PRO} key=${PRO} worker=${WORKER}`);
    expect(out).not.toContain(PRO);
    expect(out).not.toContain(WORKER);
    expect(out).toContain('Bearer ****');
  });

  test('handles null / non-string', () => {
    expect(scrubSecrets(null)).toBe('');
    expect(scrubSecrets(42)).toBe('42');
  });

  test('never throws on hostile toString', () => {
    const hostile = {
      toString() {
        throw new Error('boom');
      },
    };
    expect(scrubSecrets(hostile)).toBe('(redacted)');
  });
});
