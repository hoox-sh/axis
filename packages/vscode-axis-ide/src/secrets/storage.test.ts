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
  AxisSecretStorage,
  PRO_KEY_ERROR,
  SECRET_SLOTS,
  SECRET_STORE_ERROR,
  WORKER_KEY_ERROR,
  createMemorySecretStore,
  type SecretStore,
} from './index';

const VALID_WORKER = `pn_${'b'.repeat(48)}`;
const VALID_PRO = `pyn_${'Cd0_-'.repeat(4)}`; // 20 chars

describe('AxisSecretStorage', () => {
  test('set/get/has/clear worker and pro keys via injectable store', async () => {
    const mem = createMemorySecretStore();
    const secrets = new AxisSecretStorage(mem);

    expect(await secrets.hasWorkerKey()).toBe(false);
    expect(await secrets.hasProKey()).toBe(false);

    const w = await secrets.setWorkerKey(VALID_WORKER);
    expect(w).toEqual({ ok: true });
    expect(w).not.toHaveProperty('key');
    expect(mem.map.get(SECRET_SLOTS.cloudApiKey)).toBe(VALID_WORKER);
    expect(await secrets.getWorkerKey()).toBe(VALID_WORKER);
    expect(await secrets.hasWorkerKey()).toBe(true);

    const p = await secrets.setProKey(VALID_PRO);
    expect(p).toEqual({ ok: true });
    expect(await secrets.getProKey()).toBe(VALID_PRO);
    expect(await secrets.hasProKey()).toBe(true);

    await secrets.clearWorkerKey();
    expect(await secrets.hasWorkerKey()).toBe(false);
    expect(await secrets.hasProKey()).toBe(true);

    await secrets.clearProKey();
    expect(await secrets.hasProKey()).toBe(false);
  });

  test('empty/whitespace set deletes the slot (design empty→delete)', async () => {
    const mem = createMemorySecretStore([
      [SECRET_SLOTS.cloudApiKey, VALID_WORKER],
      [SECRET_SLOTS.engineServerApiKey, VALID_PRO],
    ]);
    const secrets = new AxisSecretStorage(mem);

    expect(await secrets.setWorkerKey('')).toEqual({ ok: true });
    expect(mem.map.has(SECRET_SLOTS.cloudApiKey)).toBe(false);
    expect(await secrets.setProKey('   ')).toEqual({ ok: true });
    expect(mem.map.has(SECRET_SLOTS.engineServerApiKey)).toBe(false);
  });

  test('rejects invalid keys before store with shared error constants', async () => {
    const mem = createMemorySecretStore();
    const secrets = new AxisSecretStorage(mem);

    const bad = await secrets.setWorkerKey('pn_oops');
    expect(bad).toEqual({ ok: false, error: WORKER_KEY_ERROR });
    expect(mem.map.has(SECRET_SLOTS.cloudApiKey)).toBe(false);

    const badPro = await secrets.setProKey('pyn_nope');
    expect(badPro).toEqual({ ok: false, error: PRO_KEY_ERROR });
    expect(mem.map.has(SECRET_SLOTS.engineServerApiKey)).toBe(false);
  });

  test('clearWorkerAndProKeys leaves optional slots; clearAll removes all', async () => {
    const mem = createMemorySecretStore([
      [SECRET_SLOTS.cloudApiKey, VALID_WORKER],
      [SECRET_SLOTS.engineServerApiKey, VALID_PRO],
      [SECRET_SLOTS.enginePyneWorkerApiKey, 'x'],
      [SECRET_SLOTS.gitPat, 'ghp_x'],
    ]);
    const secrets = new AxisSecretStorage(mem);
    await secrets.clearWorkerAndProKeys();
    expect(mem.map.has(SECRET_SLOTS.cloudApiKey)).toBe(false);
    expect(mem.map.has(SECRET_SLOTS.engineServerApiKey)).toBe(false);
    expect(mem.map.get(SECRET_SLOTS.enginePyneWorkerApiKey)).toBe('x');
    expect(mem.map.get(SECRET_SLOTS.gitPat)).toBe('ghp_x');

    await secrets.clearAll();
    expect(mem.map.size).toBe(0);
  });

  test('has*/get* never throw; set* returns SECRET_STORE_ERROR on reject', async () => {
    const boom: SecretStore = {
      get() {
        return Promise.reject(new Error('vault locked'));
      },
      store() {
        return Promise.reject(new Error('vault locked'));
      },
      delete() {
        return Promise.reject(new Error('vault locked'));
      },
    };
    const secrets = new AxisSecretStorage(boom);
    expect(await secrets.getWorkerKey()).toBeUndefined();
    expect(await secrets.getProKey()).toBeUndefined();
    expect(await secrets.hasWorkerKey()).toBe(false);
    expect(await secrets.hasProKey()).toBe(false);
    expect(await secrets.setWorkerKey(VALID_WORKER)).toEqual({
      ok: false,
      error: SECRET_STORE_ERROR,
    });
    expect(await secrets.setProKey(VALID_PRO)).toEqual({
      ok: false,
      error: SECRET_STORE_ERROR,
    });
  });
});
