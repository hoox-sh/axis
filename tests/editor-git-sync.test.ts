// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers for editor git sync chrome (`src/editor/git-sync.ts`).
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { setStore, setActivePlugin } from '../src/store';
import {
  formatGitStatus,
  getEditorStorageId,
  isGitStorageActive,
  statusMetaFromPull,
  type PullLibraryResult,
} from '../src/editor/git-sync';

beforeEach(() => {
  setActivePlugin('storage', 'local');
  setStore('activePlugins', 'storage', 'local');
});

describe('isGitStorageActive', () => {
  it('is false when storage is local', () => {
    setStore('activePlugins', 'storage', 'local');
    expect(isGitStorageActive()).toBe(false);
  });

  it('is true when activePlugins.storage is git', () => {
    setStore('activePlugins', 'storage', 'git');
    expect(isGitStorageActive()).toBe(true);
  });

  it('is false for cloud', () => {
    setStore('activePlugins', 'storage', 'cloud');
    expect(isGitStorageActive()).toBe(false);
  });
});

describe('getEditorStorageId', () => {
  it('returns active storage id', () => {
    setStore('activePlugins', 'storage', 'cloud');
    expect(getEditorStorageId()).toBe('cloud');
  });

  it('falls back to local when unset', () => {
    setStore('activePlugins', 'storage', undefined as unknown as string);
    // getActiveStorageId falls back to 'local'
    expect(getEditorStorageId()).toBe('local');
  });
});

describe('formatGitStatus', () => {
  it('shows storage id and clean by default', () => {
    expect(formatGitStatus({ storageId: 'local' })).toBe('local · clean');
  });

  it('shows dirty flag', () => {
    expect(formatGitStatus({ storageId: 'git', dirty: true })).toBe('git · dirty');
  });

  it('includes branch and remote', () => {
    expect(
      formatGitStatus({
        storageId: 'git',
        dirty: false,
        branch: 'main',
        remote: 'acme/pine',
      }),
    ).toBe('git · acme/pine · @main · clean');
  });

  it('marks offline and count', () => {
    expect(
      formatGitStatus({
        storageId: 'git',
        dirty: true,
        connected: false,
        count: 3,
      }),
    ).toBe('git · dirty · offline · 3 script(s)');
  });

  it('uses active storage when storageId omitted', () => {
    setStore('activePlugins', 'storage', 'cloud');
    expect(formatGitStatus({ dirty: false })).toBe('cloud · clean');
  });

  it('appends error when present', () => {
    expect(
      formatGitStatus({ storageId: 'git', dirty: false, error: 'token required' }),
    ).toBe('git · clean · token required');
  });
});

describe('statusMetaFromPull', () => {
  it('maps pull result + dirty into chip meta', () => {
    const pull: PullLibraryResult = {
      list: [
        { id: 'a', name: 'A', updatedAt: 1 },
        { id: 'b', name: 'B', updatedAt: 2 },
      ],
      status: {
        connected: true,
        branch: 'main',
        remote: 'owner/repo',
      },
      sync: { ok: true, message: 'Pulled 2 script(s) from github' },
    };
    const meta = statusMetaFromPull(pull, true, 'git');
    expect(meta).toEqual({
      storageId: 'git',
      dirty: true,
      connected: true,
      branch: 'main',
      remote: 'owner/repo',
      count: 2,
      error: undefined,
    });
    expect(formatGitStatus(meta)).toContain('dirty');
    expect(formatGitStatus(meta)).toContain('2 script(s)');
  });

  it('surfaces sync failure as error', () => {
    const pull: PullLibraryResult = {
      list: [],
      status: { connected: false },
      sync: { ok: false, message: 'GitHub: Bad credentials' },
    };
    const meta = statusMetaFromPull(pull, false, 'git');
    expect(meta.error).toBe('GitHub: Bad credentials');
    expect(meta.connected).toBe(false);
  });
});
