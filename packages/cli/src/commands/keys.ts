/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis keys — mint / validate Worker API keys (pn_…) for cloud script storage.
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { getTomlVar, hasTomlVar } from "../services/wrangler-toml.js";
import {
  assertHttpsForSecret,
  defaultWorkerUrl,
  mintWorkerApiKey,
  validateWorkerApiKey,
} from "../services/health.js";
import { promptSecret } from "../utils/prompt.js";
import { mintPyneKey, validatePyneKey } from "../services/pyne-auth.js";
import { defaultPyneUrl } from "../services/prewarm.js";
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

function adminTokenHint(tomlCollision: boolean): string {
  const lines = [
    "Pass --admin-token, AXIS_ADMIN_TOKEN, or enter it when prompted (CLI cannot read Worker secrets).",
  ];
  if (tomlCollision) {
    lines.push(
      "wrangler.toml still has [vars] ADMIN_TOKEN — that blocks secret put (10053) and leaves the Worker with an empty token. Run: axis secret put ADMIN_TOKEN"
    );
  } else {
    lines.push("If minting 403s: axis secret put ADMIN_TOKEN, then retry.");
  }
  return lines.join(" ");
}

async function resolveAdminToken(
  explicit: string | undefined,
  opts: GlobalOpts
): Promise<{ token: string; tomlCollision: boolean }> {
  const paths = getPaths();
  const tomlCollision =
    existsSync(paths.wranglerToml) && hasTomlVar(paths.wranglerToml, "ADMIN_TOKEN");
  const fromFlag = String(explicit || "").trim();
  if (fromFlag) return { token: fromFlag, tomlCollision };
  const fromEnv = String(process.env.AXIS_ADMIN_TOKEN || "").trim();
  if (fromEnv) return { token: fromEnv, tomlCollision };
  if (existsSync(paths.wranglerToml)) {
    const fromToml = getTomlVar(paths.wranglerToml, "ADMIN_TOKEN");
    if (fromToml) return { token: fromToml, tomlCollision };
  }
  if (process.stdin.isTTY && !opts.json) {
    printInfo(
      "Enter the ADMIN_TOKEN you set with `axis secret put ADMIN_TOKEN`.",
      opts.quiet
    );
    try {
      const typed = (await promptSecret("Admin token: ")).trim();
      return { token: typed, tomlCollision };
    } catch {
      return { token: "", tomlCollision };
    }
  }
  return { token: "", tomlCollision };
}

export async function runKeysCreate(
  opts: GlobalOpts,
  flags: { url?: string; adminToken?: string; tier?: string; pyne?: boolean }
): Promise<void> {
  if (flags.pyne) {
    await runPyneKeysCreate(opts, flags);
    return;
  }
  printHeader("AXIS keys create", opts.quiet);
  const base = flags.url || defaultWorkerUrl();
  // The admin token is a Bearer-equivalent secret — never cleartext off-host.
  assertHttpsForSecret(base, "axis keys create");
  const { token, tomlCollision } = await resolveAdminToken(flags.adminToken, opts);
  if (!token) {
    throw new CLIError(
      "ADMIN_TOKEN required to mint keys",
      ExitCode.UNAUTHENTICATED,
      adminTokenHint(tomlCollision)
    );
  }
  if (tomlCollision) {
    printWarn(
      "[vars] ADMIN_TOKEN is still set (often empty). axis secret put ADMIN_TOKEN will comment it out, deploy, then set the secret.",
      opts.quiet
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
        ? adminTokenHint(tomlCollision)
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

/**
 * `axis keys create --pyne` — mint on the calculation host.
 *
 * The PYNE admin token is read from `--admin-token` / `AXIS_ADMIN_TOKEN` only:
 * it is a different secret from the Worker's, and the host's `ADMIN_TOKEN` env
 * is what it is compared against.
 */
async function runPyneKeysCreate(
  opts: GlobalOpts,
  flags: { url?: string; adminToken?: string; tier?: string }
): Promise<void> {
  const base = (flags.url || defaultPyneUrl()).replace(/\/$/, "");
  printHeader("AXIS keys create (PYNE)", opts.quiet);
  assertHttpsForSecret(base, "axis keys create --pyne");
  const token = String(
    flags.adminToken || process.env.AXIS_ADMIN_TOKEN || ""
  ).trim();
  if (!token) {
    throw new CLIError(
      "ADMIN_TOKEN required to mint PYNE keys",
      ExitCode.UNAUTHENTICATED,
      "Pass --admin-token or set AXIS_ADMIN_TOKEN (the PYNE host's ADMIN_TOKEN)"
    );
  }
  const tier = (flags.tier || "hobby").toLowerCase();
  const minted = await mintPyneKey(base, token, tier);
  if (!minted.ok || !minted.apiKey) {
    throw new CLIError(
      minted.error || "PYNE key mint failed",
      minted.status === 403 ? ExitCode.UNAUTHENTICATED : ExitCode.ERROR,
      minted.status === 403
        ? "Set ADMIN_TOKEN on the PYNE host, then retry"
        : "Check axis prewarm / axis health against this endpoint"
    );
  }
  if (opts.json) {
    printJson({
      ok: true,
      api_key: minted.apiKey,
      key_id: minted.keyId,
      tier: minted.tier,
      pyne: base,
    });
    return;
  }
  printOk(`Minted ${minted.tier || tier} PYNE key`, opts.quiet);
  printWarn("This value is shown once. Store it; the backend never returns it again.", opts.quiet);
  process.stdout.write(`${minted.apiKey}\n`);
  printInfo(`Use it as the engine API key for ${base}`, opts.quiet);
}

export async function runKeysValidate(
  opts: GlobalOpts,
  flags: { url?: string; key?: string; pyne?: boolean }
): Promise<void> {
  if (flags.pyne) {
    await runPyneKeysValidate(opts, flags);
    return;
  }
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
  // The API key is a Bearer secret — never cleartext off-host.
  assertHttpsForSecret(base, "axis keys validate");
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

/** `axis keys validate --pyne` — check a key against the calculation host. */
async function runPyneKeysValidate(
  opts: GlobalOpts,
  flags: { url?: string; key?: string }
): Promise<void> {
  const base = (flags.url || defaultPyneUrl()).replace(/\/$/, "");
  const key = String(flags.key || process.env.AXIS_PYNE_API_KEY || "").trim();
  printHeader("AXIS keys validate (PYNE)", opts.quiet);
  if (!key) {
    throw new CLIError(
      "API key required",
      ExitCode.INVALID_USAGE,
      "Pass --key pn_…  or  AXIS_PYNE_API_KEY"
    );
  }
  assertHttpsForSecret(base, "axis keys validate --pyne");
  const result = await validatePyneKey(base, key);
  if (!result.ok) {
    throw new CLIError(
      result.error || "invalid key",
      result.status === 401 ? ExitCode.UNAUTHENTICATED : ExitCode.ERROR,
      result.status === 401 ? "Mint a key with axis keys create --pyne" : undefined
    );
  }
  printOk(
    `Key valid${result.tier ? ` · tier=${result.tier}` : ""}` +
      (result.active === false ? " · inactive" : "") +
      (result.rateLimited ? " · rate-limited" : ""),
    opts.quiet
  );
  if (opts.json) {
    printJson({
      ok: true,
      key_id: result.keyId,
      tier: result.tier,
      active: result.active,
      rate_limited: result.rateLimited,
      pyne: base,
    });
  }
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
    .option("--pyne", "Mint on the PYNE host instead (POST /auth/create_key)")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        url?: string;
        adminToken?: string;
        tier?: string;
        pyne?: boolean;
      };
      await wrapAction((g) =>
        runKeysCreate(g, {
          url: o.url,
          adminToken: o.adminToken,
          tier: o.tier,
          pyne: o.pyne,
        })
      ).call(this);
    });

  keys
    .command("validate")
    .description("Validate a pn_… key against GET /api/keys")
    .option("--url <url>", "Worker base URL", defaultWorkerUrl())
    .option("--key <key>", "API key (else AXIS_API_KEY)")
    .option("--pyne", "Validate on the PYNE host instead (POST /auth/validate)")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        url?: string;
        key?: string;
        pyne?: boolean;
      };
      await wrapAction((g) =>
        runKeysValidate(g, { url: o.url, key: o.key, pyne: o.pyne })
      ).call(this);
    });
}
