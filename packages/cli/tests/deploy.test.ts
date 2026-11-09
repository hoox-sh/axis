/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertGitProof,
  gitHeadSha,
  healthGitSha,
  normalizeGitSha,
  readDistIdentity,
  wranglerGitDefine,
  wranglerGitFlags,
  wranglerGitVar,
} from '../src/commands/deploy.js';
import { CLIError } from '../src/utils/format.js';
import { getPaths } from '../src/utils/paths.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('wranglerGitDefine', () => {
  it('stamps a hex SHA as a JS string define', () => {
    expect(wranglerGitDefine(SHA)).toEqual(['--define', `WORKER_GIT_SHA:"${SHA}"`]);
  });

  it('skips empty or non-hex values', () => {
    expect(wranglerGitDefine('')).toEqual([]);
    expect(wranglerGitDefine('not-a-sha')).toEqual([]);
    expect(wranglerGitDefine('HEAD')).toEqual([]);
  });
});

describe('wranglerGitVar / wranglerGitFlags', () => {
  it('stamps a runtime GIT_SHA var and combines with the define', () => {
    expect(wranglerGitVar(SHA)).toEqual(['--var', `GIT_SHA:${SHA}`]);
    expect(wranglerGitFlags(SHA)).toEqual([
      '--define',
      `WORKER_GIT_SHA:"${SHA}"`,
      '--var',
      `GIT_SHA:${SHA}`,
    ]);
    expect(wranglerGitVar('HEAD')).toEqual([]);
  });
});

describe('gitHeadSha', () => {
  it('matches git rev-parse HEAD in the AXIS root', () => {
    const paths = getPaths();
    const sha = gitHeadSha(paths.root);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('assertGitProof / identity readers', () => {
  it('normalizes and extracts health.git', () => {
    expect(normalizeGitSha(` ${SHA.toUpperCase()} `)).toBe(SHA);
    expect(healthGitSha({ git: SHA, version: '2.28.0' })).toBe(SHA);
    expect(healthGitSha({ git: '' })).toBe('');
    expect(healthGitSha(null)).toBe('');
  });

  it('passes when live SHA equals HEAD', () => {
    expect(() => assertGitProof('Worker /health', SHA, SHA.toUpperCase())).not.toThrow();
  });

  it('fails when live SHA is empty or different', () => {
    expect(() => assertGitProof('Worker /health', SHA, '')).toThrow(CLIError);
    expect(() => assertGitProof('Worker /health', SHA, 'deadbeef'.repeat(5))).toThrow(CLIError);
    expect(() => assertGitProof('dist/version.json', '', SHA)).toThrow(CLIError);
  });

  it('reads dist/version.json git proof', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axis-dist-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'version.json'),
      `${JSON.stringify({ version: '2.28.0', git: SHA, gitShort: SHA.slice(0, 12), dirty: false, buildTime: 'x' }, null, 2)}\n`,
    );
    expect(readDistIdentity(dir)).toEqual({ version: '2.28.0', git: SHA });
  });
});
