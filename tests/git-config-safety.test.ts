// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_GIT_CONFIG,
  assertSafeRepoPath,
  normalizeRepoPath,
  resolveScriptRepoPath,
  sanitizeBasePath,
  scriptPath,
  type GitConfig,
} from '../src/storage/git-config';

const cfg: GitConfig = {
  ...DEFAULT_GIT_CONFIG,
  basePath: 'pyne-library',
  token: 'x',
  owner: 'a',
  repo: 'b',
};

describe('git path safety', () => {
  it('sanitizeBasePath rejects .. segments', () => {
    expect(sanitizeBasePath('../../etc')).toBe(DEFAULT_GIT_CONFIG.basePath);
    expect(sanitizeBasePath('my-lib/')).toBe('my-lib');
  });

  it('assertSafeRepoPath confines under library/', () => {
    expect(assertSafeRepoPath(cfg, 'pyne-library/library/s1.pyne')).toBe(
      'pyne-library/library/s1.pyne',
    );
    expect(assertSafeRepoPath(cfg, 'pyne-library/published/user/Lib/1/lib.pyne')).toBe(
      'pyne-library/published/user/Lib/1/lib.pyne',
    );
    expect(() => assertSafeRepoPath(cfg, 'README.md')).toThrow(/under/);
    expect(() => assertSafeRepoPath(cfg, 'pyne-library/library/../secret')).toThrow(/unsafe/);
    expect(() => assertSafeRepoPath(cfg, '../x')).toThrow();
  });

  it('resolveScriptRepoPath ignores bare filenames and escapes', () => {
    // Import-style bare name → default scriptPath
    expect(
      resolveScriptRepoPath(cfg, { id: 's1', docPath: 'RSI.pine' }),
    ).toBe(scriptPath(cfg, 's1'));

    // Keep legacy index path
    expect(
      resolveScriptRepoPath(cfg, {
        id: 's1',
        docPath: undefined,
        indexPath: 'pyne-library/library/s1.pine',
      }),
    ).toBe('pyne-library/library/s1.pine');

    // Escape attempt ignored
    expect(
      resolveScriptRepoPath(cfg, {
        id: 's1',
        docPath: '../../.github/workflows/ci.yml',
      }),
    ).toBe(scriptPath(cfg, 's1'));
  });

  it('normalizeRepoPath rejects dots', () => {
    expect(normalizeRepoPath('a/b/c')).toBe('a/b/c');
    expect(() => normalizeRepoPath('a/../b')).toThrow();
  });
});
