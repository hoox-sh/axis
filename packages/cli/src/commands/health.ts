/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Command } from "commander";
import {
  defaultWorkerUrl,
  probeHealth,
  probeOAuthStart,
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
  flags: { url?: string; oauth?: boolean }
): Promise<void> {
  const base = flags.url || defaultWorkerUrl();
  printHeader("AXIS health", opts.quiet);

  const health = await probeHealth(base);

  if (opts.json && !flags.oauth) {
    printJson({ ok: health.ok, health });
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
  }

  let oauthOk = true;
  if (flags.oauth) {
    const oauth = await probeOAuthStart(base);
    oauthOk = oauth.ok;
    if (!opts.quiet) {
      const icon = oauth.ok
        ? theme.success(icons.ok)
        : theme.error(icons.fail);
      process.stdout.write(`  ${icon} POST ${oauth.url}\n`);
      if (oauth.body && typeof oauth.body === "object") {
        const b = oauth.body as Record<string, unknown>;
        process.stdout.write(
          `      ${theme.dim(
            oauth.ok
              ? `user_code=${b.user_code ?? "?"} expires_in=${b.expires_in ?? "?"}`
              : JSON.stringify(b)
          )}\n`
        );
      }
      if (oauth.error) {
        process.stdout.write(`      ${theme.error(oauth.error)}\n`);
      }
    }
    if (opts.json) {
      printJson({ ok: health.ok && oauthOk, health, oauth });
    }
  } else if (opts.json) {
    printJson({ ok: health.ok, health });
  }

  if (!health.ok || !oauthOk) process.exit(ExitCode.ERROR);
}

export function registerHealth(program: Command): void {
  program
    .command("health")
    .description("Probe Worker /health (and optional OAuth device start)")
    .option("--url <url>", "Worker base URL", defaultWorkerUrl())
    .option("--oauth", "Also probe GitHub device OAuth start")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        url?: string;
        oauth?: boolean;
      };
      await wrapAction((g) =>
        runHealth(g, { url: o.url, oauth: o.oauth })
      ).call(this);
    });
}
