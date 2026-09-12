#!/usr/bin/env bun
/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Stamp every version-carrying file from the single source of truth: `VERSION`.
 *
 * Bump flow: edit `VERSION`, then run `bun run sync:versions` (also runs as
 * part of `bun run build`). `bun run check:versions` asserts the same set.
 *
 * Stamped files:
 * - package.json
 * - src-tauri/tauri.conf.json
 * - src-tauri/Cargo.toml (top-level `version = "…"`)
 * - src-tauri/Cargo.lock (`axis` stanza)
 * - public/version.json (served at `/version.json`; polled by the update manager)
 * - src/version.ts (generated `APP_VERSION` for the app shell)
 * - worker/src/version.ts (generated `WORKER_VERSION` for `/health`)
 *
 * Usage: bun scripts/sync-versions.mjs [--check]
 *   --check  exit 1 on drift without writing (CI-friendly)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CHECK = process.argv.includes('--check');

function readVersion() {
  const v = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) {
    throw new Error(`VERSION: expected semver, got ${JSON.stringify(v)}`);
  }
  return v;
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function writeJson(rel, obj) {
  writeFileSync(join(ROOT, rel), `${JSON.stringify(obj, null, 2)}\n`);
}

function setCargoVersion(rel, version) {
  const path = join(ROOT, rel);
  // Windows runners check text files out with CRLF — normalize before matching.
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  // Scoped to the [package] section so a dependency `version = "…"` above it
  // is never stamped by accident.
  const section = text.match(/^\[package\][\s\S]*?(?=^\[|(?![\s\S]))/m);
  if (!section || !/^version\s*=\s*"[^"]+"/m.test(section[0])) {
    throw new Error(`${rel}: no [package] version = "..." found`);
  }
  const stamped = section[0].replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`,
  );
  writeFileSync(path, text.replace(section[0], () => stamped));
}

function setLockVersion(version) {
  const path = join(ROOT, 'src-tauri/Cargo.lock');
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const re = /\[\[package\]\]\nname = "axis"\nversion = "[^"]+"/;
  if (!re.test(text)) {
    throw new Error('src-tauri/Cargo.lock: no [[package]] name = "axis" stanza found');
  }
  writeFileSync(path, text.replace(re, `[[package]]\nname = "axis"\nversion = "${version}"`));
}

const LICENSE_HEADER = `/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */`;

function appVersionModule(version) {
  return `${LICENSE_HEADER}

/**
 * App version — GENERATED from the repo-root VERSION file. Do not edit.
 * Regenerate with 'bun run sync:versions'.
 *
 * VITE_APP_VERSION (stamped by Docker/CI at build time) wins when set so
 * release pipelines can stamp without rewriting source; otherwise the baked
 * VERSION value is used. Both derive from the same file.
 *
 * @module version
 */

/** Baked single source of truth (repo-root VERSION at sync time). */
export const BAKED_APP_VERSION: string = '${version}';

/** Running app version: build-time override or baked VERSION. */
export function appVersion(): string {
  try {
    const stamped =
      typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env
        ?.VITE_APP_VERSION;
    const v = String(stamped || '').trim();
    if (v) return v;
  } catch {
    /* non-Vite runtimes (bun tests) fall through to the baked value */
  }
  return BAKED_APP_VERSION;
}

/** Current app version (evaluated once at module load). */
export const APP_VERSION: string = appVersion();
`;
}

function workerVersionModule(version) {
  return `${LICENSE_HEADER}

/**
 * Worker version — GENERATED from the repo-root VERSION file. Do not edit.
 * Regenerate with 'bun run sync:versions'. Surfaced on '/' + '/health'.
 *
 * @module version
 */

/** Deployed worker version (repo-root VERSION at sync time). */
export const WORKER_VERSION: string = '${version}';
`;
}

const version = readVersion();
const drift = [];

function stamp(rel, get, set) {
  const current = get();
  if (current !== version) {
    drift.push(`${rel}: ${current} → ${version}`);
    if (!CHECK) set();
  }
}

// package.json / tauri.conf.json
stamp('package.json', () => String(readJson('package.json').version), () => {
  const pkg = readJson('package.json');
  pkg.version = version;
  writeJson('package.json', pkg);
});
stamp('src-tauri/tauri.conf.json', () => String(readJson('src-tauri/tauri.conf.json').version), () => {
  const conf = readJson('src-tauri/tauri.conf.json');
  conf.version = version;
  writeJson('src-tauri/tauri.conf.json', conf);
});

// Cargo.toml / Cargo.lock (regex helpers above)
{
  const text = readFileSync(join(ROOT, 'src-tauri/Cargo.toml'), 'utf8').replace(/\r\n/g, '\n');
  const section = text.match(/^\[package\][\s\S]*?(?=^\[|(?![\s\S]))/m);
  const m = section?.[0].match(/^version\s*=\s*"([^"]+)"/m);
  const current = m ? m[1] : '<missing>';
  if (current !== version) {
    drift.push(`src-tauri/Cargo.toml: ${current} → ${version}`);
    if (!CHECK) setCargoVersion('src-tauri/Cargo.toml', version);
  }
}
{
  const text = readFileSync(join(ROOT, 'src-tauri/Cargo.lock'), 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/\[\[package\]\]\nname = "axis"\nversion = "([^"]+)"/);
  const current = m ? m[1] : '<missing>';
  if (current !== version) {
    drift.push(`src-tauri/Cargo.lock: ${current} → ${version}`);
    if (!CHECK) setLockVersion(version);
  }
}

// public/version.json (served statically; update manager polls `version` only).
// buildTime records the last version bump, not the last build — it only
// refreshes on version drift so `bun run build` doesn't dirty git every run.
{
  let current = null;
  try {
    current = String(readJson('public/version.json').version);
  } catch {
    current = '<missing>';
  }
  if (current !== version) {
    drift.push(`public/version.json: ${current} → ${version}`);
    if (!CHECK) {
      writeJson('public/version.json', {
        version,
        buildTime: new Date().toISOString(),
      });
    }
  }
}

// Generated TS modules
{
  const targets = [
    ['src/version.ts', appVersionModule(version)],
    ['worker/src/version.ts', workerVersionModule(version)],
  ];
  for (const [rel, content] of targets) {
    let current = null;
    try {
      current = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      current = null;
    }
    if (current !== content) {
      drift.push(`${rel}: regenerate`);
      if (!CHECK) writeFileSync(join(ROOT, rel), content);
    }
  }
}

if (CHECK && drift.length > 0) {
  console.error(`version drift from VERSION (${version}):`);
  for (const d of drift) console.error(`  ${d}`);
  console.error('Fix: bun run sync:versions');
  process.exit(1);
}

if (drift.length === 0) {
  console.log(`versions in sync: ${version}`);
} else {
  console.log(CHECK ? `would stamp ${drift.length} file(s) to ${version}` : `stamped ${drift.length} file(s) to ${version}`);
  for (const d of drift) console.log(`  ${d}`);
}
