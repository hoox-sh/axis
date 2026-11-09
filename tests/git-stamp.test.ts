/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Deploy identity: VERSION + `git rev-parse HEAD` (or CI SHA env).
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGitStamp, versionJsonBody } from '../scripts/git-stamp.mjs';

const ROOT = join(import.meta.dir, '..');

function gitHead(): string {
  const r = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(r.status).toBe(0);
  return String(r.stdout ?? '').trim();
}

describe('git-stamp', () => {
  it('reads semver from VERSION and SHA from git HEAD', () => {
    const version = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
    const head = gitHead();
    const stamp = readGitStamp();
    expect(stamp.version).toBe(version);
    expect(stamp.git).toBe(head);
    expect(stamp.gitShort).toBe(head.slice(0, 12));
    expect(stamp.git).toMatch(/^[0-9a-f]{40}$/);
  });

  it('version.json body carries version + git proof', () => {
    const stamp = readGitStamp();
    const body = versionJsonBody(stamp);
    expect(body.version).toBe(stamp.version);
    expect(body.git).toBe(stamp.git);
    expect(body.gitShort).toBe(stamp.gitShort);
    expect(typeof body.buildTime).toBe('string');
    expect(body.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('CLI stamp script prints the same SHA as git rev-parse HEAD', () => {
    const head = gitHead();
    const r = spawnSync('bun', ['scripts/git-stamp.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    const body = JSON.parse(r.stdout) as { git: string; version: string };
    expect(body.git).toBe(head);
    expect(body.version).toBe(readFileSync(join(ROOT, 'VERSION'), 'utf8').trim());
  });
});
