/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Command } from "commander";
import {
  defaultWorkerUrl,
  healthFeatures,
  probeHealth,
  probeOAuthStart,
  probeScripts,
} from "../services/health.js";
import { theme, icons } from "../utils/theme.js";
import {
  ExitCode,
  printHeader,
  printJson,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

export async function runHealth(
  opts: GlobalOpts,
  flags: { url?: string; oauth?: boolean; scripts?: boolean; key?: string }
): Promise<void> {
  const base = flags.url || defaultWorkerUrl();
  printHeader("AXIS health", opts.quiet);

  const health = await probeHealth(base);
  const feats = healthFeatures(health.body);

  if (opts.json && !flags.oauth && !flags.scripts) {
    printJson({ ok: health.ok, health, features: feats });
    if (!health.ok) process.exit(ExitCode.ERROR);
    return;
  }

  if (!opts.quiet) {
    const icon = health.ok ? theme.success(icons.ok) : theme.error(icons.fail);
    process.stdout.write(`  ${icon} GET ${health.url}\n`);
    if (health.status) {
      process.stdout.write(
        `      status ${health.status}  ${theme.dim(JSON.stringify(health.body))}\n`
      );
    }
    if (health.error) {
      process.stdout.write(`      ${theme.error(health.error)}\n`);
    }
    if (health.ok && feats.d1 && !feats.keys) {
      process.stdout.write(
        `      ${theme.warn("D1 bound, API_KEYS KV missing — axis setup kv && axis deploy worker")}\n`
      );
    }
  }

  let oauthOk = true;
  let oauthResult: Awaited<ReturnType<typeof probeOAuthStart>> | undefined;
  if (flags.oauth) {
    oauthResult = await probeOAuthStart(base);
    oauthOk = oauthResult.ok;
    if (!opts.quiet) {
      const icon = oauthResult.ok
        ? theme.success(icons.ok)
        : theme.error(icons.fail);
      process.stdout.write(`  ${icon} POST ${oauthResult.url}\n`);
      if (oauthResult.body && typeof oauthResult.body === "object") {
        const b = oauthResult.body as Record<string, unknown>;
        process.stdout.write(
          `      ${theme.dim(
            oauthResult.ok
              ? `user_code=${b.user_code ?? "?"} expires_in=${b.expires_in ?? "?"}`
              : JSON.stringify(b)
          )}\n`
        );
      }
      if (oauthResult.error) {
        process.stdout.write(`      ${theme.error(oauthResult.error)}\n`);
      }
    }
  }

  let scriptsOk = true;
  let scriptsResult: Awaited<ReturnType<typeof probeScripts>> | undefined;
  if (flags.scripts) {
    scriptsResult = await probeScripts(base, flags.key);
    scriptsOk = scriptsResult.ok;
    if (!opts.quiet) {
      const icon = scriptsResult.ok
        ? theme.success(icons.ok)
        : theme.error(icons.fail);
      process.stdout.write(`  ${icon} GET ${scriptsResult.url}\n`);
      process.stdout.write(
        `      ${theme.dim(
          scriptsResult.ok
            ? flags.key
              ? "authorized"
              : "401 NO_KEY (route up — mint a key with axis keys create)"
            : scriptsResult.error || `HTTP ${scriptsResult.status ?? "?"}`
        )}\n`
      );
    }
  }

  if (opts.json && (flags.oauth || flags.scripts)) {
    printJson({
      ok: health.ok && oauthOk && scriptsOk,
      health,
      features: feats,
      ...(oauthResult ? { oauth: oauthResult } : {}),
      ...(scriptsResult ? { scripts: scriptsResult } : {}),
    });
  }

  if (!health.ok || !oauthOk || !scriptsOk) process.exit(ExitCode.ERROR);
}

export function registerHealth(program: Command): void {
  program
    .command("health")
    .description("Probe Worker /health (optional OAuth + /api/scripts)")
    .option("--url <url>", "Worker base URL", defaultWorkerUrl())
    .option("--oauth", "Also probe GitHub device OAuth start")
    .option("--scripts", "Also probe /api/scripts (cloud library route)")
    .option("--key <key>", "Bearer key for --scripts (else unauthenticated probe)")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        url?: string;
        oauth?: boolean;
        scripts?: boolean;
        key?: string;
      };
      await wrapAction((g) =>
        runHealth(g, {
          url: o.url,
          oauth: o.oauth,
          scripts: o.scripts,
          key: o.key,
        })
      ).call(this);
    });
}
