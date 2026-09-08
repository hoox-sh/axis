/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * CLI installation self-check ("is this axis install healthy?").
 *
 * Runs on every command start (see index.ts preAction hook) and as the
 * `cli-install` row of `axis doctor`. Purely local — no network, no spawns —
 * so it can never slow down or break a command. Findings are warnings only;
 * hard failures belong to `axis doctor`'s required checks.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPaths } from "./paths.js";
import { ownPackage } from "../own-package.js";

export type InstallContext =
  | "repo-checkout"
  | "npm-install"
  | "npx-cache"
  | "binary"
  | "unknown";

export type PreflightReport = {
  /** True when nothing worth warning about was found. */
  ok: boolean;
  /** Human-readable one-liner for doctor's detail column. */
  summary: string;
  /** Warnings to print on stderr (empty when ok). */
  warnings: string[];
  context: InstallContext;
  cliVersion: string;
  /** Repo packages/cli version when newer than this install, else null. */
  driftFrom: string | null;
};

/** Own package metadata — embedded at bundle/compile time (see own-package.ts). */
function readOwnPackageJson(): { version: string; engines?: Record<string, string> } {
  return {
    version: ownPackage.version,
    engines: ownPackage.engines,
  };
}

/** Minimal semver-ish compare for `major.minor.patch` strings. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** Where is this CLI running from? Derived from the module's own URL. */
export function detectInstallContext(
  moduleUrl: string = import.meta.url
): InstallContext {
  const p = (() => {
    try {
      return fileURLToPath(moduleUrl);
    } catch {
      return moduleUrl;
    }
  })();
  if (p.includes("/_npx/") || p.includes("/npm-cache/")) return "npx-cache";
  if (p.includes("/node_modules/@hoox-sh/axis-cli/")) return "npm-install";
  if (p.includes("/packages/cli/")) return "repo-checkout";
  // bun build --compile: bundled code lives in the virtual $bunfs
  // (file:///$bunfs/... on unix, B:\$bunfs\... on windows).
  if (p.toLowerCase().includes("$bunfs")) return "binary";
  return "unknown";
}

/** Parse "major[.minor]" out of an engines constraint like ">=1.2" / ">=20". */
function parseConstraint(v: string, fallback: [number, number]): [number, number] {
  const m = v.match(/(\d+)(?:\.(\d+))?/);
  if (!m) return fallback;
  return [Number.parseInt(m[1], 10), m[2] !== undefined ? Number.parseInt(m[2], 10) : 0];
}

/**
 * Engine compliance vs package.json `engines` (node >=20, bun >=1.2).
 * Injectable for tests; defaults to the live runtime.
 */
export function checkEngines(
  versions: { bun?: string; node?: string } = process.versions as {
    bun?: string;
    node?: string;
  },
  engines: Record<string, string> = readOwnPackageJson().engines ?? {}
): { ok: boolean; detail: string } {
  const [minNodeMajor, minNodeMinor] = parseConstraint(engines.node ?? ">=20", [20, 0]);
  const [minBunMajor, minBunMinor] = parseConstraint(engines.bun ?? ">=1.2", [1, 2]);

  if (versions.bun) {
    const [major, minor] = parseConstraint(versions.bun, [0, 0]);
    if (major < minBunMajor || (major === minBunMajor && minor < minBunMinor)) {
      return {
        ok: false,
        detail: `bun ${versions.bun} < required ${engines.bun ?? ">=1.2"} — https://bun.sh`,
      };
    }
    return { ok: true, detail: `bun ${versions.bun}` };
  }

  const [nodeMajor, nodeMinor] = parseConstraint(versions.node ?? "0", [0, 0]);
  if (nodeMajor < minNodeMajor || (nodeMajor === minNodeMajor && nodeMinor < minNodeMinor)) {
    return {
      ok: false,
      detail: `node ${versions.node ?? "?"} < required ${engines.node ?? ">=20"} — use bun or upgrade node`,
    };
  }
  return { ok: true, detail: `node ${versions.node}` };
}

const CONTEXT_LABEL: Record<InstallContext, string> = {
  "repo-checkout": "repo checkout (packages/cli)",
  "npm-install": "npm install (@hoox-sh/axis-cli)",
  "npx-cache": "npx cache",
  binary: "standalone binary (bun compile)",
  unknown: "unknown install location",
};

/**
 * Collect the full self-check. Never throws — a broken environment yields
 * warnings, not a crash, so `axis --version` / `axis doctor` still respond.
 */
export async function collectPreflight(options?: {
  moduleUrl?: string;
  cliVersion?: string;
}): Promise<PreflightReport> {
  const own = readOwnPackageJson();
  const cliVersion = options?.cliVersion ?? own.version;
  const context = detectInstallContext(options?.moduleUrl);
  const warnings: string[] = [];

  const engines = checkEngines();
  if (!engines.ok) warnings.push(`axis: ${engines.detail}`);

  // Version drift: a repo checkout whose bundled CLI is newer than this install.
  let driftFrom: string | null = null;
  try {
    const repoCliPkg = JSON.parse(
      readFileSync(`${getPaths().cli}/package.json`, "utf-8")
    ) as { version?: string };
    const repoVersion = repoCliPkg.version;
    if (
      repoVersion &&
      context !== "repo-checkout" &&
      compareSemver(repoVersion, cliVersion) > 0
    ) {
      driftFrom = repoVersion;
      warnings.push(
        `axis: CLI ${cliVersion} is older than this repo's CLI ${repoVersion} — update: npm i -g @hoox-sh/axis-cli`
      );
    }
  } catch {
    /* not inside an axis repo (or unreadable) — drift not applicable */
  }

  const summary = driftFrom
    ? `${CONTEXT_LABEL[context]} · v${cliVersion} (repo has v${driftFrom} — update)`
    : `${CONTEXT_LABEL[context]} · v${cliVersion} · ${engines.detail}`;

  return {
    ok: warnings.length === 0,
    summary,
    warnings,
    context,
    cliVersion,
    driftFrom,
  };
}
