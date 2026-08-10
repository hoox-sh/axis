/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Git script versioning — commit list + read-at-revision (mocked APIs).
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag, ensureBuiltins } from '../src/plugins/bootstrap';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { gitStoragePlugin } from '../src/storage/git';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { setStore } from '../src/store';
import {
  githubListFileCommits,
  githubGetFileAtRef,
} from '../src/storage/git-github';
import type { GitConfig } from '../src/storage/git-config';

class MemoryStorage {
  store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

const originalFetch = globalThis.fetch;

const CFG: GitConfig = {
  provider: 'github',
  apiBaseUrl: 'https://api.github.com',
  token: 'ghp_testtoken',
  owner: 'acme',
  repo: 'pines',
  projectId: '',
  branch: 'main',
  basePath: 'pine-library',
  autoPush: true,
  commitMessageTemplate: 'chore(pine): save {{name}} @ {{iso}}',
};

function b64(s: string): string {
  return btoa(s);
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  setStore('pluginsConfig', 'storage:git', { ...CFG });
  setStore('activePlugins', 'storage', 'git');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('githubListFileCommits', () => {
  it('parses commit history for a path', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/commits?');
      expect(url).toContain('path=');
      return new Response(
        JSON.stringify([
          {
            sha: 'abcdef0123456789',
            html_url: 'https://github.com/acme/pines/commit/abcdef0123456789',
            commit: {
              message: 'chore(pine): save RSI @ 2026-01-01\n\nbody',
              author: { name: 'alice', date: '2026-01-01T12:00:00Z' },
            },
          },
          {
            sha: '1111222233334444',
            commit: {
              message: 'initial',
              author: { name: 'bob', date: '2025-12-01T00:00:00Z' },
            },
          },
        ]),
        { status: 200 },
      );
    }) as typeof fetch;

    const list = await githubListFileCommits(
      CFG,
      'pine-library/library/s_rsi.pyne',
      { limit: 10 },
    );
    expect(list).toHaveLength(2);
    expect(list[0]!.shortSha).toBe('abcdef0');
    expect(list[0]!.message).toBe('chore(pine): save RSI @ 2026-01-01');
    expect(list[0]!.author).toBe('alice');
    expect(list[1]!.sha).toBe('1111222233334444');
  });
});

describe('githubGetFileAtRef', () => {
  it('reads file content at a commit ref', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('ref=deadbeef');
      return new Response(
        JSON.stringify({
          type: 'file',
          content: b64('//@version=5\nindicator("old")\n'),
          sha: 'blobsha1',
          encoding: 'base64',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const file = await githubGetFileAtRef(
      CFG,
      'pine-library/library/s_rsi.pyne',
      'deadbeef',
    );
    expect(file?.content).toContain('indicator("old")');
    expect(file?.blobSha).toBe('blobsha1');
  });
});

describe('gitStoragePlugin listVersions / readAtRevision', () => {
  it('lists versions via index path resolution', async () => {
    const index = {
      version: 1,
      scripts: [
        {
          id: 's_rsi',
          name: 'RSI',
          path: 'pine-library/library/s_rsi.pyne',
          updatedAt: Date.now(),
        },
      ],
    };
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('index.json') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            type: 'file',
            content: b64(JSON.stringify(index)),
            sha: 'indexsha',
            encoding: 'base64',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/commits?')) {
        return new Response(
          JSON.stringify([
            {
              sha: 'ccc111',
              commit: {
                message: 'save RSI',
                author: { name: 'dev', date: '2026-02-01T00:00:00Z' },
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), {
        status: 404,
      });
    }) as typeof fetch;

    const vers = await gitStoragePlugin.listVersions!('s_rsi', { limit: 5 });
    expect(vers).toHaveLength(1);
    expect(vers[0]!.message).toBe('save RSI');
  });

  it('reads at revision with kind/version enrichment', async () => {
    const index = {
      version: 1,
      scripts: [
        {
          id: 's_rsi',
          name: 'RSI',
          path: 'pine-library/library/s_rsi.pyne',
          updatedAt: 1,
        },
      ],
    };
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('index.json')) {
        return new Response(
          JSON.stringify({
            type: 'file',
            content: b64(JSON.stringify(index)),
            sha: 'indexsha',
            encoding: 'base64',
          }),
          { status: 200 },
        );
      }
      if (url.includes('s_rsi.pyne') && url.includes('ref=oldrev')) {
        return new Response(
          JSON.stringify({
            type: 'file',
            content: b64('//@version=5\nstrategy("S")\nplot(close)'),
            sha: 'blobold',
            encoding: 'base64',
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const doc = await gitStoragePlugin.readAtRevision!('s_rsi', 'oldrev');
    expect(doc.content).toContain('strategy("S")');
    expect(doc.scriptKind).toBe('strategy');
    expect(doc.pineVersion).toBe('5');
    expect(doc.revision).toBe('oldrev');
  });
});
