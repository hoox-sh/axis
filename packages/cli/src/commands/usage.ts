/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Command } from "commander";
import { assertHttpsForSecret } from "../services/health.js";
import { fetchPyneUsage } from "../services/pyne-auth.js";
import { defaultPyneUrl } from "../services/prewarm.js";
import { theme, icons } from "../utils/theme.js";
import {
  ExitCode,
  printHeader,
  printJson,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

export async function runUsage(
  opts: GlobalOpts,
  flags: { endpoint?: string; key?: string }
): Promise<void> {
  const base = (flags.endpoint || defaultPyneUrl()).replace(/\/$/, "");
  const key = String(flags.key || process.env.AXIS_PYNE_API_KEY || "").trim();
  printHeader("AXIS usage", opts.quiet);

  if (!key) {
    process.stderr.write(
      `${theme.error(icons.fail)} API key required — pass --key pn_… or set AXIS_PYNE_API_KEY\n`
    );
    process.exit(ExitCode.INVALID_USAGE);
  }
  // The key is a Bearer secret — never cleartext off-host.
  assertHttpsForSecret(base, "axis usage --key");

  const r = await fetchPyneUsage(base, key);

  if (opts.json) {
    printJson(r);
    if (!r.ok) process.exit(ExitCode.ERROR);
    return;
  }

  if (!opts.quiet) {
    const icon = r.ok ? theme.success(icons.ok) : theme.error(icons.fail);
    process.stdout.write(`  ${icon} GET ${base}/auth/usage\n`);
    if (r.ok) {
      process.stdout.write(
        `      tier=${r.tier ?? "?"} key=${r.keyId ?? "?"}\n` +
          `      calls ${r.callsUsed ?? "?"}` +
          (r.callsLimit != null ? ` / ${r.callsLimit}` : "") +
          (r.callsRemaining != null ? ` · ${r.callsRemaining} remaining` : "") +
          "\n"
      );
    } else if (r.error) {
      process.stdout.write(`      ${theme.error(r.error)}\n`);
    }
  }

  if (!r.ok) process.exit(ExitCode.ERROR);
}

export function registerUsage(program: Command): void {
  program
    .command("usage")
    .description("Show PYNE API usage for a key (GET /auth/usage)")
    .option("--endpoint <url>", "PYNE base URL", defaultPyneUrl())
    .option("--key <key>", "API key (else AXIS_PYNE_API_KEY)")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & { endpoint?: string; key?: string };
      await wrapAction((g) => runUsage(g, { endpoint: o.endpoint, key: o.key })).call(this);
    });
}
