/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `promptStorageChange` helper (storage/service.ts) — single shared entry
 * point that all four storage-change call sites route through before
 * flipping the active engine. Verifies the short-circuit cases
 * (unchanged / unset) and the open-dialog case (different ids).
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag, ensureBuiltins } from '../src/plugins/bootstrap';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { setActivePlugin, store } from '../src/store';
import {
  cancelPendingStorageChange,
  getPendingStorageChange,
  promptStorageChange,
  _resetPendingStorageChangeForTests,
} from '../src/storage/service';

beforeEach(() => {
  registry.clear();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  setActivePlugin('storage', 'local');
  _resetPendingStorageChangeForTests();
});

// Restore local storage so other test files that don't reset the active
// plugin (e.g. tests/storage-local.test.ts which relies on the default)
// don't see 'cloud' leaked from this file's "first-time set" cases.
afterEach(() => {
  setActivePlugin('storage', 'local');
  _resetPendingStorageChangeForTests();
});

describe('promptStorageChange', () => {
  it('is a no-op when oldId === newId (no dialog opened)', () => {
    _resetPendingStorageChangeForTests();
    promptStorageChange('local', 'local');
    expect(getPendingStorageChange()).toBeNull();
  });

  it('is a no-op when newId is empty', () => {
    _resetPendingStorageChangeForTests();
    promptStorageChange('local', '');
    expect(getPendingStorageChange()).toBeNull();
  });

  it('flips immediately (no dialog) when oldId is empty — first-time set', () => {
    _resetPendingStorageChangeForTests();
    promptStorageChange('', 'cloud');
    expect(getPendingStorageChange()).toBeNull();
    expect(store.activePlugins?.storage).toBe('cloud');
  });

  it('opens the dialog when oldId and newId differ', () => {
    _resetPendingStorageChangeForTests();
    promptStorageChange('local', 'cloud');
    const pending = getPendingStorageChange();
    expect(pending).not.toBeNull();
    expect(pending?.from).toBe('local');
    expect(pending?.to).toBe('cloud');
  });

  it('cancelPendingStorageChange clears the pending request', () => {
    promptStorageChange('local', 'cloud');
    expect(getPendingStorageChange()).not.toBeNull();
    cancelPendingStorageChange();
    expect(getPendingStorageChange()).toBeNull();
    // Active plugin should NOT have changed — cancellation is a true no-op.
    expect(store.activePlugins?.storage).toBe('local');
  });

  it('replacing the pending request overwrites the previous one', () => {
    promptStorageChange('local', 'cloud');
    promptStorageChange('local', 'git');
    const pending = getPendingStorageChange();
    expect(pending?.from).toBe('local');
    expect(pending?.to).toBe('git');
  });

  it('treats undefined oldId the same as empty (first-time set)', () => {
    _resetPendingStorageChangeForTests();
    // Cast through unknown to simulate callers that pass undefined
    promptStorageChange(undefined as unknown as string, 'cloud');
    expect(getPendingStorageChange()).toBeNull();
    expect(store.activePlugins?.storage).toBe('cloud');
  });
});
