/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis doctor — toolchain + worker config diagnostics
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { runWrangler, which } from "../utils/run.js";
import {
  getD1DatabaseId,
  getTomlName,
  getTomlVar,
} from "../services/wrangler-toml.js";
import { defaultWorkerUrl, probeHealth } from "../services/health.js";
import { theme, icons } from "../utils/theme.js";
import {
  ExitCode,
  printHeader,
  printJson,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

export type DoctorCheck = {
  id: string;
  ok: boolean;
  required: boolean;
  label: string;
  detail?: string;
};

export async function collectDoctorChecks(options: {
  remote?: boolean;
  workerUrl?: string;
}): Promise<DoctorCheck[]> {
  const paths = getPaths();
  const checks: DoctorCheck[] = [];

  const bunPath = await which("bun");
  checks.push({
    id: "bun",
    ok: Boolean(bunPath),
    required: true,
    label: "Bun runtime",
    detail: bunPath ?? "missing — https://bun.sh",
  });

  checks.push({
    id: "repo",
    ok: existsSync(paths.packageJson) && existsSync(paths.worker),
    required: true,
    label: "AXIS repo root",
    detail: paths.root,
  });

  checks.push({
    id: "worker-deps",
    ok: existsSync(`${paths.worker}/node_modules`),
    required: true,
    label: "Worker node_modules",
    detail: existsSync(`${paths.worker}/node_modules`)
      ? "present"
      : "run: axis install",
  });

  const hasToml = existsSync(paths.wranglerToml);
  checks.push({
    id: "wrangler-toml",
    ok: hasToml,
    required: false,
    label: "worker/wrangler.toml",
    detail: hasToml
      ? paths.wranglerToml
      : "missing — expected until you run: axis setup  (copies worker/wrangler.toml.example)",
  });

  if (hasToml) {
    const name = getTomlName(paths.wranglerToml);
    checks.push({
      id: "worker-name",
      ok: name === "pynescript-axis",
      required: true,
      label: "Worker project name",
      detail: name ?? "(unset)",
    });

    const d1 = getD1DatabaseId(paths.wranglerToml);
    const d1Ok = Boolean(d1 && !d1.includes("REPLACE"));
    checks.push({
      id: "d1-id",
      ok: d1Ok,
      required: true,
      label: "D1 database_id",
      detail: d1Ok ? d1! : d1 ?? "missing — axis setup d1",
    });

    const gh = getTomlVar(paths.wranglerToml, "GITHUB_OAUTH_CLIENT_ID");
    checks.push({
      id: "github-oauth",
      ok: Boolean(gh && gh.length > 4),
      required: false,
      label: "GITHUB_OAUTH_CLIENT_ID",
      detail: gh
        ? `${gh.slice(0, 8)}…`
        : "unset — axis setup oauth --github-client-id <id>",
    });

    const allowOpen = getTomlVar(paths.wranglerToml, "ALLOW_OPEN_KEYS");
    checks.push({
      id: "allow-open-keys",
      ok: allowOpen !== "1",
      required: false,
      label: "ALLOW_OPEN_KEYS prod-safe",
      detail:
        allowOpen === "1"
          ? 'currently "1" (dev open) — set "0" for prod'
          : allowOpen ?? "(unset)",
    });
  }

  checks.push({
    id: "d1-schema-file",
    ok: existsSync(paths.d1Schema),
    required: true,
    label: "D1 schema file",
    detail: paths.d1Schema,
  });

  // Cloudflare auth
  let cfOk = false;
  let cfDetail = "not checked";
  try {
    const r = await runWrangler(paths.worker, ["whoami"], {
      throwOnError: false,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    cfOk =
      r.code === 0 && !/not (logged in|authenticated)/i.test(out);
    cfDetail = cfOk
      ? "authenticated"
      : "not logged in — CLOUDFLARE_API_TOKEN or wrangler login";
  } catch (e) {
    cfDetail = e instanceof Error ? e.message : String(e);
  }
  checks.push({
    id: "cloudflare-auth",
    ok: cfOk,
    required: false,
    label: "Cloudflare auth",
    detail: cfDetail,
  });

  if (options.remote) {
    const url = options.workerUrl || defaultWorkerUrl();
    const health = await probeHealth(url);
    checks.push({
      id: "remote-health",
      ok: health.ok,
      required: false,
      label: "Remote /health",
      detail: health.ok
        ? `${url} → healthy`
        : health.error || `HTTP ${health.status ?? "?"} ${url}`,
    });
  }

  // Optional: rust/cargo for Tauri
  const cargo = await which("cargo");
  checks.push({
    id: "cargo",
    ok: Boolean(cargo),
    required: false,
    label: "Rust/cargo (desktop)",
    detail: cargo ?? "optional for axis desktop:dev",
  });

  // pyne sibling hint
  const pyneSiblings = ["pynescript", "pyne"].map((name) =>
    join(paths.root, "..", name)
  );
  const pyneFound = pyneSiblings.find((p) => existsSync(p));
  checks.push({
    id: "pyne-sibling",
    ok: Boolean(pyneFound),
    required: false,
    label: "Sister PYNE repo",
    detail: pyneFound ?? "optional local engine at ../pyne (checkout sometimes named pynescript)",
  });

  return checks;
}

export async function runDoctor(
  opts: GlobalOpts,
  flags: { remote?: boolean; workerUrl?: string }
): Promise<void> {
  printHeader("AXIS doctor", opts.quiet);
  const checks = await collectDoctorChecks(flags);

  if (opts.json) {
    const failed = checks.filter((c) => c.required && !c.ok);
    printJson({
      ok: failed.length === 0,
      checks,
      root: getPaths().root,
    });
    if (failed.length) process.exit(ExitCode.ERROR);
    return;
  }

  for (const c of checks) {
    const icon = c.ok
      ? theme.success(icons.ok)
      : c.required
        ? theme.error(icons.fail)
        : theme.warn(icons.warn);
    process.stdout.write(
      `  ${icon} ${c.label.padEnd(28)} ${theme.dim(c.detail ?? "")}\n`
    );
  }

  const hardFail = checks.filter((c) => c.required && !c.ok);
  const soft = checks.filter((c) => !c.required && !c.ok);
  process.stdout.write("\n");
  if (hardFail.length === 0) {
    process.stdout.write(
      `${theme.success(icons.ok)} Required checks passed` +
        (soft.length ? theme.dim(` (${soft.length} optional warnings)`) : "") +
        "\n"
    );
  } else {
    process.stdout.write(
      `${theme.error(icons.fail)} ${hardFail.length} required check(s) failed\n`
    );
    process.stdout.write(
      `${theme.dim("Hint: axis install && axis setup")}\n`
    );
    process.exit(ExitCode.ERROR);
  }
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose toolchain, wrangler.toml, Cloudflare auth")
    .option("--remote", "Also probe deployed Worker /health")
    .option("--url <url>", "Worker base URL for --remote")
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals() as GlobalOpts & {
        remote?: boolean;
        url?: string;
      };
      await wrapAction((g) =>
        runDoctor(g, { remote: opts.remote, workerUrl: opts.url })
      ).call(this);
    });
}
