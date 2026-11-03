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
  PRO_API_KEY_RE,
  PRO_KEY_ERROR,
  WORKER_API_KEY_RE,
  WORKER_KEY_ERROR,
} from './slots';
import { formatSecretStatus } from './status';
import { redactSecret, validateProKey, validateWorkerKey } from './validate';

/** Valid Worker key: pn_ + 48 lowercase hex. */
const VALID_WORKER = `pn_${'a'.repeat(48)}`;
/** Valid Pro key: pyn_ + ≥20 [A-Za-z0-9_-]. */
const VALID_PRO = `pyn_${'A'.repeat(20)}`;

describe('WORKER_API_KEY_RE', () => {
  test('matches live-ticket shape exactly', () => {
    expect(WORKER_API_KEY_RE.source).toBe('^pn_[a-f0-9]{48}$');
    expect(WORKER_API_KEY_RE.flags).toBe('');
  });

  test('accepts pn_ + 48 hex', () => {
    expect(WORKER_API_KEY_RE.test(VALID_WORKER)).toBe(true);
    expect(WORKER_API_KEY_RE.test(`pn_${'0123456789abcdef'.repeat(3)}`)).toBe(true);
  });

  test('rejects pn_oops and near-misses', () => {
    expect(WORKER_API_KEY_RE.test('pn_oops')).toBe(false);
    expect(WORKER_API_KEY_RE.test(`pn_${'A'.repeat(48)}`)).toBe(false); // uppercase
    expect(WORKER_API_KEY_RE.test(`pn_${'a'.repeat(47)}`)).toBe(false);
    expect(WORKER_API_KEY_RE.test(`pn_${'a'.repeat(49)}`)).toBe(false);
    expect(WORKER_API_KEY_RE.test(VALID_PRO)).toBe(false);
  });
});

describe('PRO_API_KEY_RE', () => {
  test('locks source/flags (20–508 body, total ≤512)', () => {
    expect(PRO_API_KEY_RE.source).toBe('^pyn_[A-Za-z0-9_-]{20,508}$');
    expect(PRO_API_KEY_RE.flags).toBe('');
  });

  test('requires pyn_ + 20–508 safe chars; 19-char body fails', () => {
    expect(PRO_API_KEY_RE.test(VALID_PRO)).toBe(true);
    expect(PRO_API_KEY_RE.test(`pyn_${'x'.repeat(19)}`)).toBe(false);
    expect(PRO_API_KEY_RE.test(`pyn_${'x'.repeat(508)}`)).toBe(true);
    expect(PRO_API_KEY_RE.test(`pyn_${'x'.repeat(509)}`)).toBe(false);
    expect(PRO_API_KEY_RE.test('pn_oops')).toBe(false);
    expect(PRO_API_KEY_RE.test(VALID_WORKER)).toBe(false);
  });
});

describe('validateWorkerKey', () => {
  test('ok for valid key (trims); no plaintext key field', () => {
    expect(validateWorkerKey(`  ${VALID_WORKER}  `)).toEqual({ ok: true });
    expect(validateWorkerKey(VALID_WORKER)).not.toHaveProperty('key');
  });

  test('rejects pn_oops with shared error constant', () => {
    expect(validateWorkerKey('pn_oops')).toEqual({
      ok: false,
      error: WORKER_KEY_ERROR,
    });
  });

  test('rejects non-string / empty', () => {
    expect(validateWorkerKey(null).ok).toBe(false);
    expect(validateWorkerKey(undefined).ok).toBe(false);
    expect(validateWorkerKey(42).ok).toBe(false);
    expect(validateWorkerKey(['pn_oops']).ok).toBe(false);
    expect(validateWorkerKey('').ok).toBe(false);
    expect(validateWorkerKey('   ').ok).toBe(false);
  });
});

describe('validateProKey', () => {
  test('ok for valid key (trims); no plaintext key field', () => {
    expect(validateProKey(`\t${VALID_PRO}\n`)).toEqual({ ok: true });
    expect(validateProKey(VALID_PRO)).not.toHaveProperty('key');
  });

  test('rejects short / wrong prefix / overlong with shared error constant', () => {
    expect(validateProKey('pyn_short')).toEqual({
      ok: false,
      error: PRO_KEY_ERROR,
    });
    expect(validateProKey('pn_oops').error).toBe(PRO_KEY_ERROR);
    expect(validateProKey(`pyn_${'x'.repeat(19)}`).error).toBe(PRO_KEY_ERROR);
    expect(validateProKey(`pyn_${'x'.repeat(509)}`).error).toBe(PRO_KEY_ERROR);
  });

  test('rejects non-string / empty', () => {
    expect(validateProKey({ key: VALID_PRO }).ok).toBe(false);
    expect(validateProKey([]).ok).toBe(false);
    expect(validateProKey('').ok).toBe(false);
  });
});

describe('redactSecret', () => {
  test('never echoes full key', () => {
    const out = redactSecret(VALID_WORKER);
    expect(out).not.toBe(VALID_WORKER);
    expect(out).not.toContain(VALID_WORKER.slice(4, 20));
    expect(out.startsWith('pn_')).toBe(true);
    expect(out).toContain('****');
    expect(out.endsWith(VALID_WORKER.slice(-4))).toBe(true);
  });

  test('always masks short strings (never returns raw)', () => {
    expect(redactSecret('abcd')).toBe('****');
    expect(redactSecret('12345678')).toBe('****');
    expect(redactSecret('123456789')).toBe('1234****…6789');
    expect(redactSecret('ab')).toBe('****');
  });

  test('redacts pro keys and empty / non-string', () => {
    expect(redactSecret(VALID_PRO)).toMatch(/^pyn_\*{4}/);
    expect(redactSecret('')).toBe('(empty)');
    expect(redactSecret(null)).toBe('(empty)');
    expect(redactSecret(123)).toBe('(redacted)');
  });
});

describe('formatSecretStatus', () => {
  test('shows set/missing marks only — never secret values', () => {
    const both = formatSecretStatus('set', 'missing');
    expect(both.text).toBe('$(graph) AXIS W✓ P·');
    expect(both.tooltip).toBe('AXIS IDE\nWorker key: set\nPro key: missing');
    expect(both.text).not.toContain('pn_');
    expect(both.text).not.toContain('pyn_');
    expect(both.tooltip).not.toContain('pn_');
    expect(both.tooltip).not.toContain('pyn_');

    const none = formatSecretStatus('missing', 'missing');
    expect(none.text).toBe('$(graph) AXIS W· P·');
    const all = formatSecretStatus('set', 'set');
    expect(all.text).toBe('$(graph) AXIS W✓ P✓');
  });
});
