/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis keys — mint / validate Worker API keys (pn_…) for cloud script storage.
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { getTomlVar } from "../services/wrangler-toml.js";
import {
  defaultWorkerUrl,
  mintWorkerApiKey,
  validateWorkerApiKey,
} from "../services/health.js";
import {
  CLIError,
  ExitCode,
  printHeader,
  printInfo,
  printJson,
  printOk,
  printWarn,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

const TIERS = ["free", "hobby", "pro", "team", "enterprise"] as const;

function resolveAdminToken(explicit?: string): string {
  const fromFlag = String(explicit || "").trim();
  if (fromFlag) return fromFlag;
  const fromEnv = String(process.env.AXIS_ADMIN_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  const paths = getPaths();
  if (existsSync(paths.wranglerToml)) {
    const fromToml = getTomlVar(paths.wranglerToml, "ADMIN_TOKEN");
    if (fromToml) return fromToml;
  }
  return "";
}

export async function runKeysCreate(
  opts: GlobalOpts,
  flags: { url?: string; adminToken?: string; tier?: string }
): Promise<void> {
  printHeader("AXIS keys create", opts.quiet);
  const base = flags.url || defaultWorkerUrl();
  const token = resolveAdminToken(flags.adminToken);
  if (!token) {
    throw new CLIError(
      "ADMIN_TOKEN required to mint keys",
      ExitCode.UNAUTHENTICATED,
      "axis secret put ADMIN_TOKEN   or   --admin-token / AXIS_ADMIN_TOKEN"
    );
  }
  const tier = (flags.tier || "hobby").toLowerCase();
  if (!TIERS.includes(tier as (typeof TIERS)[number])) {
    throw new CLIError(
      `Unknown tier "${tier}"`,
      ExitCode.INVALID_USAGE,
      `Use one of: ${TIERS.join(", ")}`
    );
  }

  printInfo(`POST ${base}/api/keys  tier=${tier}`, opts.quiet);
  const minted = await mintWorkerApiKey(base, token, tier);
  if (!minted.ok || !minted.apiKey) {
    throw new CLIError(
      minted.error || "key mint failed",
      minted.status === 403 ? ExitCode.UNAUTHENTICATED : ExitCode.ERROR,
      minted.status === 403
        ? "ADMIN_TOKEN rejected — axis secret put ADMIN_TOKEN, then axis deploy worker"
        : minted.status === 503
          ? "Worker needs API_KEYS KV — axis setup kv && axis deploy worker"
          : "Check axis health and that the Worker is deployed"
    );
  }

  if (opts.json) {
    printJson({
      ok: true,
      api_key: minted.apiKey,
      tier: minted.tier,
      worker: base,
    });
    return;
  }

  printOk(`Minted ${minted.tier || tier} key — paste into Settings → Script storage`, opts.quiet);
  printWarn("This value is shown once. Store it; the Worker never returns it again.", opts.quiet);
  process.stdout.write(`${minted.apiKey}\n`);
  printInfo(`Worker URL: ${base}`, opts.quiet);
}

export async function runKeysValidate(
  opts: GlobalOpts,
  flags: { url?: string; key?: string }
): Promise<void> {
  printHeader("AXIS keys validate", opts.quiet);
  const key = String(flags.key || process.env.AXIS_API_KEY || "").trim();
  if (!key) {
    throw new CLIError(
      "API key required",
      ExitCode.INVALID_USAGE,
      "Pass --key pn_…  or  AXIS_API_KEY"
    );
  }
  const base = flags.url || defaultWorkerUrl();
  const result = await validateWorkerApiKey(base, key);
  if (!result.ok) {
    throw new CLIError(
      result.error || "invalid key",
      ExitCode.ERROR,
      result.status === 503
        ? "API_KEYS KV is not bound — axis setup kv && axis deploy worker"
        : "Mint a key with axis keys create"
    );
  }
  printOk(`Key valid${result.tier ? ` · tier=${result.tier}` : ""}`, opts.quiet);
  if (opts.json) printJson({ ok: true, tier: result.tier, worker: base });
}

export function registerKeys(program: Command): void {
  const keys = program
    .command("keys")
    .description("Mint and validate Worker API keys (cloud script storage)");

  keys
    .command("create")
    .description("Mint a pn_… key via POST /api/keys (needs ADMIN_TOKEN)")
    .option("--url <url>", "Worker base URL", defaultWorkerUrl())
    .option("--admin-token <token>", "Admin token (else AXIS_ADMIN_TOKEN / wrangler.toml)")
    .option("--tier <tier>", "free | hobby | pro | team | enterprise", "hobby")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        url?: string;
        adminToken?: string;
        tier?: string;
      };
      await wrapAction((g) =>
        runKeysCreate(g, {
          url: o.url,
          adminToken: o.adminToken,
          tier: o.tier,
        })
      ).call(this);
    });

  keys
    .command("validate")
    .description("Validate a pn_… key against GET /api/keys")
    .option("--url <url>", "Worker base URL", defaultWorkerUrl())
    .option("--key <key>", "API key (else AXIS_API_KEY)")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        url?: string;
        key?: string;
      };
      await wrapAction((g) =>
        runKeysValidate(g, { url: o.url, key: o.key })
      ).call(this);
    });
}
