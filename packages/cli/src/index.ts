#!/usr/bin/env bun
/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * AXIS CLI — install, doctor, setup, deploy, secrets, health.
 */

if (typeof Bun === "undefined") {
  process.stderr.write(
    "Error: the AXIS CLI requires Bun >= 1.2.\n" +
      "  Install: curl -fsSL https://bun.sh | bash\n" +
      "  Then:    bun packages/cli/bin/axis.js <command>\n"
  );
  process.exit(1);
}

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { theme } from "./utils/theme.js";
import { handleError } from "./utils/format.js";
import { registerInstall } from "./commands/install.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerSetup } from "./commands/setup.js";
import { registerDeploy } from "./commands/deploy.js";
import { registerSecrets } from "./commands/secrets.js";
import { registerHealth } from "./commands/health.js";
import { registerDev } from "./commands/dev.js";
import { registerWhoami } from "./commands/whoami.js";

const pkgVersion: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
).version;

export async function main(): Promise<void> {
  const program = new Command();

  program
    .name("axis")
    .description(
      "AXIS CLI — install, doctor, Worker setup (D1/OAuth), secrets, deploy, health"
    )
    .version(pkgVersion)
    .option("--json", "JSON output where supported")
    .option("--quiet", "Minimal output")
    .option("-y, --yes", "Skip confirmations")
    .addHelpText(
      "beforeAll",
      theme.heading("\nAXIS CLI") +
        theme.dim("  charting PWA · Cloudflare Worker · setup & deploy\n")
    )
    .addHelpText(
      "afterAll",
      `
${theme.dim("Typical flow:")}
  axis install
  axis doctor
  axis setup --github-client-id Ov23li…
  axis setup d1 --remote
  axis deploy worker
  axis health --oauth

${theme.dim("Secrets (prod):")}
  axis secret put ADMIN_TOKEN
  axis secret put EXTERNAL_BACKEND

${theme.dim("Docs:")} https://hoox.sh/axis/docs
`
    );

  registerInstall(program);
  registerDoctor(program);
  registerSetup(program);
  registerDeploy(program);
  registerSecrets(program);
  registerHealth(program);
  registerDev(program);
  registerWhoami(program);

  program.exitOverride();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // Commander uses exitOverride errors for --help / unknown commands
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "commander.helpDisplayed"
    ) {
      process.exit(0);
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "commander.version"
    ) {
      process.exit(0);
    }
    const opts = program.opts() as { json?: boolean };
    handleError(err, opts.json);
  }
}

if (import.meta.main) {
  await main();
}
