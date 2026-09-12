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
 * Single source of truth: the repo-root `VERSION` file. Run
 * `bun run sync:versions` to stamp every file below from it (app stamps plus
 * Docker VERSION fallbacks in Dockerfile / docker-compose.yml / docker-bake.hcl).
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
  // Windows runners check text files out with CRLF — normalize before matching.
  const text = readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  // Scoped to the [package] section: an unscoped ^version match could hit a
  // dependency's `version = "…"` requirement above it instead.
  const section = text.match(/^\[package\][\s\S]*?(?=^\[|(?![\s\S]))/m);
  const m = section?.[0].match(/^version\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error(`${rel}: no [package] version = "..." found`);
  return m[1];
}

function readLockVersion() {
  const text = readFileSync(join(ROOT, 'src-tauri/Cargo.lock'), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  const m = text.match(/\[\[package\]\]\nname = "axis"\nversion = "([^"]+)"/);
  if (!m) throw new Error('src-tauri/Cargo.lock: no [[package]] name = "axis" stanza found');
  return m[1];
}

function readGeneratedConst(rel, name) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const m = text.match(new RegExp(`export const ${name}: string = ['"]([^'"]+)['"]`));
  if (!m) throw new Error(`${rel}: no exported const ${name} found (run bun run sync:versions)`);
  return m[1];
}

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

function readPatternVersion(rel, re) {
  const text = readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  const matches = [...text.matchAll(re)].map((m) => m[1]);
  if (matches.length === 0) {
    throw new Error(`${rel}: no VERSION fallback found (run bun run sync:versions)`);
  }
  const unique = new Set(matches);
  if (unique.size !== 1) {
    throw new Error(
      `${rel}: mixed VERSION fallbacks ${[...unique].join(', ')} (run bun run sync:versions)`,
    );
  }
  return matches[0];
}

const versions = new Map([
  ['VERSION', readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()],
  ['package.json', String(readJson('package.json').version)],
  ['src-tauri/tauri.conf.json', String(readJson('src-tauri/tauri.conf.json').version)],
  ['src-tauri/Cargo.toml', readCargoVersion('src-tauri/Cargo.toml')],
  ['src-tauri/Cargo.lock', readLockVersion()],
  ['public/version.json', String(readJson('public/version.json').version)],
  ['src/version.ts', readGeneratedConst('src/version.ts', 'BAKED_APP_VERSION')],
  ['worker/src/version.ts', readGeneratedConst('worker/src/version.ts', 'WORKER_VERSION')],
  [
    'Dockerfile ARG VERSION',
    readPatternVersion('Dockerfile', new RegExp(`^ARG VERSION=(${SEMVER})$`, 'gm')),
  ],
  [
    'docker-compose.yml VERSION fallback',
    readPatternVersion(
      'docker-compose.yml',
      new RegExp(String.raw`\$\{VERSION:-(${SEMVER})\}`, 'g'),
    ),
  ],
  [
    'docker-bake.hcl VERSION',
    readPatternVersion(
      'docker-bake.hcl',
      new RegExp(String.raw`variable\s+"VERSION"\s*\{\s*default\s*=\s*"(${SEMVER})"`, 'g'),
    ),
  ],
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
  'Fix: edit VERSION, then run `bun run sync:versions` to stamp package.json, ' +
    'src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, ' +
    'public/version.json, src/version.ts, worker/src/version.ts, Dockerfile ' +
    'ARG VERSION, docker-compose.yml VERSION fallback, and docker-bake.hcl ' +
    'variable "VERSION".',
);
process.exit(1);
