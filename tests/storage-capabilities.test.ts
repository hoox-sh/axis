// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Storage backend capabilities.
 *
 * The scan found the service probing each backend for optional methods
 * (`typeof p.saveResult === 'function'`) and then throwing a special
 * `VERSIONING_UNAVAILABLE` error at the call site. The backends now *declare*
 * what they can do, and the service reads that.
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag, ensureBuiltins } from '../src/plugins/bootstrap';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { setStore } from '../src/store';
import { cloudStoragePlugin } from '../src/storage/cloud';
import { localStoragePlugin } from '../src/storage/local';
import { gitStoragePlugin } from '../src/storage/git';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('declared storage capabilities', () => {
  it('local keeps results, version history and drafts', () => {
    expect(localStoragePlugin.capabilities?.results).toBe(true);
    expect(localStoragePlugin.capabilities?.versioning).toBe(true);
    expect(localStoragePlugin.capabilities?.drafts).toBe(true);
  });

  it('cloud keeps version history and drafts, but not run results', () => {
    expect(cloudStoragePlugin.capabilities?.versioning).toBe(true);
    expect(cloudStoragePlugin.capabilities?.drafts).toBe(true);
    expect(cloudStoragePlugin.capabilities?.results).toBeUndefined();
  });

  it('git keeps version history but leaves drafts local', () => {
    expect(gitStoragePlugin.capabilities?.versioning).toBe(true);
    expect(gitStoragePlugin.capabilities?.drafts).toBe(false);
  });
});

describe('cloud list ordering', () => {
  it('returns newest first', async () => {
    setStore('pluginsConfig', 'storage:cloud', {
      endpoint: 'https://cloud.test',
      apiKey: 'pn_' + 'a'.repeat(48),
    });
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            status: 'success',
            scripts: [
              { id: 'old', name: 'Old', updatedAt: 1000 },
              { id: 'new', name: 'New', updatedAt: 3000 },
              { id: 'mid', name: 'Mid', updatedAt: 2000 },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const metas = await cloudStoragePlugin.list();
    expect(metas.map((m) => m.id)).toEqual(['new', 'mid', 'old']);
  });
});
