#!/usr/bin/env bun
/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Assert the release version is identical across every version-stamped file.
 *
 * The v2.6.0 GitHub Release shipped desktop bundles named 2.4.1 because the
 * Tauri trio (tauri.conf.json / Cargo.toml / Cargo.lock) was never bumped
 * alongside the root package.json — tauri-action derives bundle versions from
 * the Tauri config, not the git tag. This guard fails CI on any drift.
 *
 * Usage: bun scripts/check-versions.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function readCargoVersion(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const m = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error(`${rel}: no top-level version = "..." found`);
  return m[1];
}

function readLockVersion() {
  const text = readFileSync(join(ROOT, 'src-tauri/Cargo.lock'), 'utf8');
  const m = text.match(/\[\[package\]\]\nname = "axis"\nversion = "([^"]+)"/);
  if (!m) throw new Error('src-tauri/Cargo.lock: no [[package]] name = "axis" stanza found');
  return m[1];
}

const versions = new Map([
  ['package.json', String(readJson('package.json').version)],
  ['src-tauri/tauri.conf.json', String(readJson('src-tauri/tauri.conf.json').version)],
  ['src-tauri/Cargo.toml', readCargoVersion('src-tauri/Cargo.toml')],
  ['src-tauri/Cargo.lock', readLockVersion()],
]);

const unique = new Set(versions.values());
if (unique.size === 1) {
  console.log(`versions in sync: ${[...unique][0]}`);
  for (const [file, v] of versions) console.log(`  ${v}  ${file}`);
  process.exit(0);
}

console.error('version mismatch across release-stamped files:');
for (const [file, v] of versions) console.error(`  ${v}  ${file}`);
console.error(
  'Fix: bump package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml ' +
    'and the axis stanza in src-tauri/Cargo.lock to the same version.',
);
process.exit(1);
