#!/usr/bin/env bun
/**
 * Copyright (C) 2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Parse Bun lcov and enforce coverage floors for packages/vscode-axis-ide.
 *
 * Usage:
 *   bun scripts/check-coverage.mjs [minPercent] [lcovPath]
 *
 * Ratchet:
 * - BASELINE — enforced floor for pure-host INCLUDE paths (fail on regression).
 * - TARGET_HOST / TARGET_PACKAGE — printed, not hard-failed yet.
 * - Protocol codecs under src/protocol/ always require 100% lines (excl. *.test.ts).
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Enforced floor for scoped pure-host lines. Measured after protocol landed. */
export const BASELINE = 100;

/** Design-table aspirational pure-host goal (90). Effective target is max(90, BASELINE). */
export const TARGET_HOST_DESIGN = 90;
export const TARGET_HOST = Math.max(TARGET_HOST_DESIGN, BASELINE);

/** Aspirational package-overall goal excl. vendor/LWC/generated (print only). */
export const TARGET_PACKAGE = 80;

/** Protocol codecs always hard-gated at 100%. */
export const PROTOCOL_MIN = 100;

/**
 * Pure-host INCLUDE — paths under these prefixes contribute to the BASELINE.
 * `src/protocol|host|secrets|editors|run|views` are live; `src/live/` is listed so
 * future live-bridge files join the gate automatically when they appear on disk.
 */
export const INCLUDE = [
  'src/protocol/',
  'src/host/',
  'src/secrets/',
  'src/editors/',
  'src/run/',
  'src/views/',
  'src/live/',
  'src/plugins/',
];

/** Unanchored substrings so relative SF paths like `out/x` still match. */
export const EXCLUDE = [
  '.test.ts',
  '.test.js',
  '.spec.ts',
  '.spec.js',
  'webview/',
  'vendor/',
  'node_modules/',
  'dist/',
  'out/',
  'lightweight-charts',
  // VS Code API shims — covered by electron; pure helpers live beside them.
  'editors/chart-editor.ts',
  'views/results-panel.ts',
  'views/results.ts',
  'views/strategy.ts',
  'views/trees.ts',
  'views/library.ts',
  'views/layers.ts',
  'views/indicators.ts',
  'views/workers.ts',
  'views/alerts.ts',
  'views/watchlist.ts',
  'plugins/index.ts',
  'plugins/tree.ts',
];

export function normalize(file) {
  return file.replace(/\\/g, '/');
}

export function excluded(file) {
  const f = normalize(file);
  return EXCLUDE.some((p) => f.includes(p));
}

export function includedHost(file) {
  const f = normalize(file);
  if (excluded(f)) return false;
  return INCLUDE.some((p) => f.includes(p));
}

export function isProtocol(file) {
  const f = normalize(file);
  if (excluded(f)) return false;
  return f.includes('src/protocol/');
}

export function isPackageSrc(file) {
  const f = normalize(file);
  if (excluded(f)) return false;
  return f.includes('/src/') || /(^|\/)src\//.test(f);
}

export function parseMinPercent(raw, fallback = BASELINE) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { error: `check-coverage: minPercent must be a finite number in 0–100, got ${String(raw)}` };
  }
  return n;
}

/** Walk package root for INCLUDE `*.ts` files that should appear in lcov. */
export function listIncludeFilesOnDisk(packageRoot) {
  const found = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'out' || name === 'dist' || name === 'coverage') {
          continue;
        }
        walk(full);
        continue;
      }
      if (!name.endsWith('.ts') && !name.endsWith('.js')) continue;
      const rel = normalize(relative(packageRoot, full));
      if (includedHost(rel) || includedHost(full)) {
        found.push(rel);
      }
    }
  }

  walk(packageRoot);
  return found.sort();
}

/**
 * @param {(file: string) => boolean} pred
 * @param {string} text
 */
export function accumulate(pred, text) {
  let found = 0;
  let hit = 0;
  let currentFile = '';
  let skip = true;
  const perFile = [];
  let fileFound = 0;
  let fileHit = 0;
  const sfFiles = [];

  function flushFile() {
    if (currentFile && !skip && fileFound > 0) {
      perFile.push({ file: currentFile, found: fileFound, hit: fileHit });
    }
    fileFound = 0;
    fileHit = 0;
  }

  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      flushFile();
      currentFile = line.slice(3).trim();
      sfFiles.push(normalize(currentFile));
      skip = !pred(currentFile);
      continue;
    }
    if (skip) continue;
    if (line.startsWith('DA:')) {
      const parts = line.slice(3).split(',');
      const n = Number(parts[1] || 0);
      found += 1;
      fileFound += 1;
      if (n > 0) {
        hit += 1;
        fileHit += 1;
      }
    }
  }
  flushFile();
  return { found, hit, perFile, sfFiles };
}

export function pct(hit, found) {
  return found === 0 ? 0 : (100 * hit) / found;
}

function printRows(log, label, rows) {
  log(label);
  for (const row of [...rows].sort((a, b) => a.file.localeCompare(b.file))) {
    const p = pct(row.hit, row.found);
    const short =
      row.file.split('/src/').pop() ||
      row.file.split('\\src\\').pop() ||
      row.file;
    log(`  ${p.toFixed(1).padStart(6)}%  ${row.hit}/${row.found}  ${short}`);
  }
}

function sfMatchesDisk(sfFile, diskRel) {
  const sf = normalize(sfFile);
  const rel = normalize(diskRel);
  return sf === rel || sf.endsWith(`/${rel}`) || sf.endsWith(rel);
}

/**
 * Core gate. Returns { ok, exitCode, lines } without exiting.
 * @param {{
 *   text: string,
 *   min: number,
 *   packageRoot: string,
 *   skipDiskCheck?: boolean,
 *   targetHost?: number,
 *   targetPackage?: number,
 *   protocolMin?: number,
 * }} opts
 */
export function evaluateCoverage(opts) {
  const {
    text,
    min,
    packageRoot,
    skipDiskCheck = false,
    targetHost = TARGET_HOST,
    targetPackage = TARGET_PACKAGE,
    protocolMin = PROTOCOL_MIN,
  } = opts;

  const lines = [];
  const log = (s) => lines.push(s);
  let failed = false;

  const host = accumulate(includedHost, text);
  const protocol = accumulate(isProtocol, text);
  const pkg = accumulate(isPackageSrc, text);

  if (!skipDiskCheck) {
    const onDisk = listIncludeFilesOnDisk(packageRoot);
    const missing = onDisk.filter(
      (rel) => !host.sfFiles.some((sf) => sfMatchesDisk(sf, rel)),
    );
    if (missing.length > 0) {
      log('check-coverage: FAIL INCLUDE files on disk missing from lcov:');
      for (const m of missing) log(`  ${m}`);
      failed = true;
    }
  }

  if (host.found === 0) {
    log('check-coverage: no DA lines found in scoped pure-host files');
    log(`INCLUDE globs: ${INCLUDE.join(', ')}`);
    return { ok: false, exitCode: 1, lines };
  }

  printRows(log, 'check-coverage pure-host packages:', host.perFile);
  const hostPct = pct(host.hit, host.found);
  log(
    `check-coverage: ${host.hit}/${host.found} pure-host lines hit = ${hostPct.toFixed(2)}% (BASELINE ${min}%, TARGET_HOST ${targetHost}%)`,
  );

  if (protocol.found === 0) {
    log('check-coverage: no protocol DA lines — src/protocol/ must be covered');
    return { ok: false, exitCode: 1, lines };
  }
  printRows(log, 'check-coverage protocol:', protocol.perFile);
  const protocolPct = pct(protocol.hit, protocol.found);
  log(
    `check-coverage: protocol ${protocol.hit}/${protocol.found} = ${protocolPct.toFixed(2)}% (hard min ${protocolMin}%)`,
  );

  const pkgPct = pct(pkg.hit, pkg.found);
  log(
    `check-coverage: package-overall ${pkg.hit}/${pkg.found} = ${pkgPct.toFixed(2)}% (aspirational TARGET_PACKAGE ${targetPackage}%, not enforced)`,
  );

  if (protocolPct + 1e-9 < protocolMin) {
    log(`check-coverage: FAIL protocol below ${protocolMin}%`);
    failed = true;
  }

  if (hostPct + 1e-9 < min) {
    log(`check-coverage: FAIL pure-host below BASELINE ${min}%`);
    failed = true;
  }

  if (hostPct + 1e-9 < targetHost) {
    const needed = Math.ceil((targetHost / 100) * host.found) - host.hit;
    log(
      `check-coverage: OK at the ${min}% BASELINE — reaching TARGET_HOST ${targetHost}% needs ${Math.max(0, needed)} more covered lines.`,
    );
  } else {
    log(
      `check-coverage: pure-host at or above TARGET_HOST ${targetHost}% (design table ${TARGET_HOST_DESIGN}% already met by BASELINE ${BASELINE}%).`,
    );
  }

  if (pkgPct + 1e-9 < targetPackage) {
    const needed = Math.ceil((targetPackage / 100) * pkg.found) - pkg.hit;
    log(
      `check-coverage: package-overall below aspirational ${targetPackage}% (needs ${Math.max(0, needed)} more lines; not failing).`,
    );
  } else {
    log(`check-coverage: package-overall at or above aspirational ${targetPackage}%.`);
  }

  return { ok: !failed, exitCode: failed ? 1 : 0, lines, hostPct, protocolPct, pkgPct };
}

export async function runCli(argv = process.argv.slice(2), io = {}) {
  const out = io.log ?? console.log;
  const err = io.error ?? console.error;
  const exit = io.exit ?? ((code) => process.exit(code));
  const cwd = io.cwd ?? process.cwd();

  const parsed = parseMinPercent(argv[0], BASELINE);
  if (typeof parsed === 'object' && parsed.error) {
    err(parsed.error);
    exit(1);
    return 1;
  }
  const min = parsed;
  const lcovPath = resolve(cwd, argv[1] || 'coverage/lcov.info');

  const lcovFile = Bun.file(lcovPath);
  if (!(await lcovFile.exists())) {
    err(`check-coverage: missing ${lcovPath}`);
    err(
      'Run: bun test --coverage --coverage-reporter=lcov --coverage-reporter=text --coverage-dir=coverage',
    );
    exit(1);
    return 1;
  }

  const text = await lcovFile.text();
  const result = evaluateCoverage({
    text,
    min,
    packageRoot: cwd,
  });
  for (const line of result.lines) out(line);
  exit(result.exitCode);
  return result.exitCode;
}

if (import.meta.main) {
  await runCli();
}
