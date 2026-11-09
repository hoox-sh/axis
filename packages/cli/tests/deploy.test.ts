/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { gitHeadSha, wranglerGitDefine } from '../src/commands/deploy.js';
import { getPaths } from '../src/utils/paths.js';

describe('wranglerGitDefine', () => {
  it('stamps a hex SHA as a JS string define', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(wranglerGitDefine(sha)).toEqual(['--define', `WORKER_GIT_SHA:"${sha}"`]);
  });

  it('skips empty or non-hex values', () => {
    expect(wranglerGitDefine('')).toEqual([]);
    expect(wranglerGitDefine('not-a-sha')).toEqual([]);
    expect(wranglerGitDefine('HEAD')).toEqual([]);
  });
});

describe('gitHeadSha', () => {
  it('matches git rev-parse HEAD in the AXIS root', () => {
    const paths = getPaths();
    const sha = gitHeadSha(paths.root);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
