/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `VERSION` is the single source of truth: the generated app/worker modules
 * and the served `version.json` must match it.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION, BAKED_APP_VERSION } from '../src/version';
import { WORKER_VERSION } from '../worker/src/version';

const ROOT = join(import.meta.dir, '..');
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();

describe('VERSION single source of truth', () => {
  it('is semver', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('matches the generated app module', () => {
    expect(BAKED_APP_VERSION).toBe(VERSION);
    expect(APP_VERSION).toBe(VERSION);
  });

  it('matches the generated worker module', () => {
    expect(WORKER_VERSION).toBe(VERSION);
  });

  it('matches the served version.json', () => {
    const served = JSON.parse(readFileSync(join(ROOT, 'public/version.json'), 'utf8')) as {
      version: string;
    };
    expect(served.version).toBe(VERSION);
  });

  it('matches the release-stamped manifests', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const tauri = JSON.parse(
      readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe(VERSION);
    expect(tauri.version).toBe(VERSION);
  });
});
