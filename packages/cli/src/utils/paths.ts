/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Resolve the AXIS monorepo root from cwd (or AXIS_ROOT).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AxisPaths = {
  root: string;
  worker: string;
  wranglerToml: string;
  wranglerExample: string;
  d1Schema: string;
  dist: string;
  cli: string;
  packageJson: string;
};

function isAxisRoot(dir: string): boolean {
  const pkgPath = join(dir, "package.json");
  const workerDir = join(dir, "worker");
  if (!existsSync(pkgPath) || !existsSync(workerDir)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
    return pkg.name === "axis";
  } catch {
    return false;
  }
}

/** Walk up from start until package.json name is "axis" and worker/ exists. */
export function findAxisRoot(start: string = process.cwd()): string {
  const fromEnv = process.env.AXIS_ROOT?.trim();
  if (fromEnv) {
    const abs = resolve(fromEnv);
    if (isAxisRoot(abs)) return abs;
    throw new Error(
      `AXIS_ROOT=${fromEnv} is not an AXIS repo root (need package.json name "axis" + worker/)`
    );
  }

  let dir = resolve(start);
  for (let i = 0; i < 24; i++) {
    if (isAxisRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find AXIS repo root from ${start}. Run inside the axis clone or set AXIS_ROOT.`
  );
}

export function getPaths(root?: string): AxisPaths {
  const r = root ?? findAxisRoot();
  return {
    root: r,
    worker: join(r, "worker"),
    wranglerToml: join(r, "worker", "wrangler.toml"),
    wranglerExample: join(r, "worker", "wrangler.toml.example"),
    d1Schema: join(r, "worker", "schemas", "scripts.sql"),
    dist: join(r, "dist"),
    cli: join(r, "packages", "cli"),
    packageJson: join(r, "package.json"),
  };
}
