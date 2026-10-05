#!/usr/bin/env bun
/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Cross-compile the datafeed sidecar into single-file executables (bun build
 * --compile) for the release platforms. Output:
 * dist-bin/axis-datafeed-<version>-<target> (".exe" appended for windows).
 * When the host's native target is among the built ones, that binary is
 * smoke-tested (boot + GET /health) before the script exits — executing a
 * foreign-target ELF fails, so the smoke only ever runs on a matching host.
 *
 * Mirrors packages/cli/scripts/build-binaries.ts (same TARGETS + arg filter).
 * Bun has no recursive rmdir/mkdir API, so directory prep stays on node:fs;
 * everything else (version read, compile, smoke) is Bun-native.
 *
 * Usage: bun scripts/build-binaries.ts [target ...]
 *   no args  → all default targets
 *   e.g.     → bun scripts/build-binaries.ts bun-linux-x64
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "dist-bin");

const VERSION = process.env.AXIS_DATAFEED_VERSION?.trim() ||
  (JSON.parse(await Bun.file(join(ROOT, "package.json")).text()) as { version: string })
    .version;

/** target → binary file name suffix (windows needs .exe). */
const TARGETS: { target: string; ext?: string }[] = [
  { target: "bun-linux-x64" },
  { target: "bun-linux-arm64" },
  { target: "bun-linux-x64-musl" },
  { target: "bun-linux-arm64-musl" },
  { target: "bun-darwin-x64" },
  { target: "bun-darwin-arm64" },
  { target: "bun-windows-x64", ext: ".exe" },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const wanted = only.length
  ? TARGETS.filter((t) => only.includes(t.target))
  : TARGETS;
if (only.length && wanted.length !== only.length) {
  const missing = only.filter((o) => !TARGETS.some((t) => t.target === o));
  console.error(`unknown target(s): ${missing.join(", ")}`);
  console.error(`known: ${TARGETS.map((t) => t.target).join(", ")}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let failed = 0;
for (const { target, ext } of wanted) {
  const name = `axis-datafeed-${VERSION}-${target}${ext ?? ""}`;
  process.stdout.write(`compile ${target} → ${name} … `);
  const proc = Bun.spawnSync({
    cmd: [
      process.execPath,
      "build",
      "--compile",
      `--target=${target}`,
      "./src/index.ts",
      `--outfile=${join(OUT, name)}`,
    ],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    failed++;
    console.error("FAILED");
    console.error(proc.stderr.toString());
    continue;
  }
  console.error("ok");
}

// Smoke-test only the host-native target when it was built: boot the binary
// on an ephemeral port and expect GET /health → { status: "ok" }.
const HOST_TARGET =
  process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32'
    ? `bun-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
    : undefined;
const nativeTarget = wanted.find((t) => t.target === HOST_TARGET);
if (nativeTarget) {
  const native = join(OUT, `axis-datafeed-${VERSION}-${nativeTarget.target}${nativeTarget.ext ?? ''}`);
  const port = 50981;
  const proc = Bun.spawn([native], {
    cwd: ROOT,
    env: { ...process.env, DATAFEED_PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  let ok = false;
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(200);
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      const body = (await res.json()) as { status?: string };
      if (res.ok && body.status === "ok") { ok = true; break; }
    } catch {
      /* not up yet */
    }
  }
  proc.kill();
  await proc.exited;
  if (!ok) {
    failed++;
    console.error("smoke FAILED: /health never returned { status: 'ok' }");
    console.error(proc.stderr.toString().slice(-2000));
  } else {
    console.error(`smoke ok: ${native} → /health ok`);
  }
} else {
  console.error(
    `smoke skipped: no native binary for ${process.platform}/${process.arch} in this build`,
  );
}

if (failed > 0) process.exit(1);
console.error(`done: ${wanted.length - failed}/${wanted.length} binaries in dist-bin/`);
