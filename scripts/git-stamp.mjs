#!/usr/bin/env bun
/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Deploy identity: semver from repo-root `VERSION` plus the git commit this
 * tree is on. Semver is the release name; git SHA is the proof that this
 * build matches a commit. `public/version.json` stays semver-only so
 * `bun run build` does not dirty git; Vite writes `dist/version.json` with
 * `{ version, git, gitShort, dirty, buildTime }`.
 *
 * SHA source (first match):
 *   1. `CF_PAGES_COMMIT_SHA` (Cloudflare Pages Git build)
 *   2. `GITHUB_SHA` (GitHub Actions)
 *   3. `git rev-parse HEAD`
 *
 * Usage: bun scripts/git-stamp.mjs
 * Prints JSON to stdout. Imported by vite.config.ts and tests.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function git(args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (r.status !== 0) return '';
  return String(r.stdout ?? '').trim();
}

function shaFromCi() {
  for (const key of ['CF_PAGES_COMMIT_SHA', 'GITHUB_SHA']) {
    const v = String(process.env[key] ?? '').trim();
    if (SHA_RE.test(v)) return v.toLowerCase();
  }
  return '';
}

/**
 * @returns {{ version: string, git: string, gitShort: string, dirty: boolean, buildTime: string }}
 */
export function readGitStamp() {
  const version = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`VERSION: expected semver, got ${JSON.stringify(version)}`);
  }
  const gitFull = shaFromCi() || git(['rev-parse', 'HEAD']);
  const gitShort =
    gitFull.length >= 12 ? gitFull.slice(0, 12) : git(['rev-parse', '--short=12', 'HEAD']) || gitFull;
  const porcelain = git(['status', '--porcelain']);
  return {
    version,
    git: gitFull,
    gitShort,
    dirty: porcelain.length > 0,
    buildTime: new Date().toISOString(),
  };
}

export function versionJsonBody(stamp) {
  return {
    version: stamp.version,
    git: stamp.git,
    gitShort: stamp.gitShort,
    dirty: stamp.dirty,
    buildTime: stamp.buildTime,
  };
}

if (import.meta.main) {
  const stamp = readGitStamp();
  process.stdout.write(`${JSON.stringify(versionJsonBody(stamp), null, 2)}\n`);
}
