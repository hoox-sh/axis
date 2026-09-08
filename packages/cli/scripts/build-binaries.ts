#!/usr/bin/env bun
/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Cross-compile the AXIS CLI into single-file executables (bun build
 * --compile) for the release platforms. Output: dist-bin/axis-cli-<version>-<target>
 * (".exe" appended for windows). The native linux-x64 binary is smoke-tested
 * (`axis --version`, `--help`) before the script exits.
 *
 * Usage: bun scripts/build-binaries.ts [target ...]
 *   no args  → all default targets
 *   e.g.     → bun scripts/build-binaries.ts bun-linux-x64
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "dist-bin");

const VERSION = process.env.AXIS_CLI_VERSION?.trim() ||
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
  const name = `axis-cli-${VERSION}-${target}${ext ?? ""}`;
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

const native = join(OUT, `axis-cli-${VERSION}-bun-linux-x64`);
if (!only.length || only.includes("bun-linux-x64")) {
  const ver = Bun.spawnSync({ cmd: [native, "--version"] });
  const help = Bun.spawnSync({ cmd: [native, "--help"] });
  const verOk = ver.exitCode === 0 && ver.stdout.toString().trim() === VERSION;
  const helpOk = help.exitCode === 0 && help.stdout.toString().includes("deploy");
  if (!verOk || !helpOk) {
    failed++;
    console.error(`smoke FAILED (version=${verOk}, help=${helpOk})`);
    console.error(ver.stdout.toString(), ver.stderr.toString());
  } else {
    console.error(
      `smoke ok: ${native} → --version ${ver.stdout.toString().trim()} · --help lists deploy`,
    );
  }
}

if (failed > 0) process.exit(1);
console.error(`done: ${wanted.length - failed}/${wanted.length} binaries in dist-bin/`);
