/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Library publish emulator: import parse, version folders, local cache publish.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  contentSha,
  formatImportSnippet,
  nextPublishedVersion,
  parseLibraryDeclaration,
  parseLibraryImports,
  publishedLibPath,
  publishedVersionDir,
  sanitizeIdent,
  type PublishedIndex,
} from '../src/storage/library-publish';
import {
  _resetPublishedCacheForTests,
  publishLibrary,
  resolveLibrariesForScript,
} from '../src/storage/library-publish-io';

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

const LIB = `//@version=6
library("MathHelpers")
export double(x) => x * 2
`;

const CONSUMER = `//@version=6
indicator("x")
import user/MathHelpers/1 as mh
plot(mh.double(close))
`;

beforeEach(() => {
  (globalThis as { localStorage?: MemoryStorage }).localStorage = new MemoryStorage();
  _resetPublishedCacheForTests();
});

describe('parse', () => {
  it('detects library() name and sanitizes', () => {
    expect(parseLibraryDeclaration(LIB)?.name).toBe('MathHelpers');
    expect(parseLibraryDeclaration('indicator("x")')).toBe(null);
    expect(sanitizeIdent('Foo Bar')).toBe('Foo_Bar');
  });

  it('parses import ns/Name/ver [as alias]', () => {
    const specs = parseLibraryImports(CONSUMER);
    expect(specs).toEqual([
      { namespace: 'user', name: 'MathHelpers', version: 1, alias: 'mh' },
    ]);
    expect(parseLibraryImports('import Alice/Fib/3').length).toBe(1);
    expect(parseLibraryImports('// import skip/This/1').length).toBe(0);
  });

  it('builds published paths with version folders', () => {
    const cfg = { basePath: 'pyne-library' };
    expect(publishedVersionDir(cfg, 'user', 'MathHelpers', 2)).toBe(
      'pyne-library/published/user/MathHelpers/2',
    );
    expect(publishedLibPath(cfg, 'user', 'MathHelpers', 2)).toBe(
      'pyne-library/published/user/MathHelpers/2/lib.pyne',
    );
  });

  it('increments versions', () => {
    const index: PublishedIndex = {
      version: 1,
      libraries: [
        {
          namespace: 'user',
          name: 'MathHelpers',
          version: 2,
          publishedAt: 1,
          contentSha: 'x',
          origin: 'manual',
        },
      ],
    };
    expect(nextPublishedVersion(index, 'user', 'MathHelpers')).toBe(3);
    expect(nextPublishedVersion(index, 'user', 'Other')).toBe(1);
  });
});

describe('publish + resolve (local cache)', () => {
  it('publishes v1 then v2, skips auto when unchanged', async () => {
    const a = await publishLibrary(LIB, { origin: 'manual', namespace: 'user' });
    expect(a.skipped).toBe(false);
    expect(a.library.version).toBe(1);
    expect(a.remote).toBe(false);
    expect(a.importSnippet).toContain('user/MathHelpers/1');

    const auto = await publishLibrary(LIB, { origin: 'auto', namespace: 'user' });
    expect(auto.skipped).toBe(true);
    expect(auto.library.version).toBe(1);

    const b = await publishLibrary(LIB + '\n// tweak\n', { origin: 'manual', namespace: 'user' });
    expect(b.library.version).toBe(2);
    expect(contentSha(LIB)).not.toBe(contentSha(LIB + '\n// tweak\n'));
  });

  it('resolves import specs from the cache', async () => {
    await publishLibrary(LIB, { origin: 'manual', namespace: 'user' });
    const { libraries, missing } = await resolveLibrariesForScript(CONSUMER);
    expect(missing).toEqual([]);
    expect(libraries).toHaveLength(1);
    expect(libraries[0]!.name).toBe('MathHelpers');
    expect(libraries[0]!.source).toContain('export double');
  });

  it('reports missing unpublished imports', async () => {
    const { missing } = await resolveLibrariesForScript(CONSUMER);
    expect(missing.map((m) => `${m.namespace}/${m.name}/${m.version}`)).toEqual([
      'user/MathHelpers/1',
    ]);
  });

  it('formats a pasteable import snippet', () => {
    expect(formatImportSnippet({ namespace: 'acme', name: 'Fib', version: 3 })).toBe(
      'import acme/Fib/3 as fib',
    );
  });
});
