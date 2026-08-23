/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis secret — wrangler secret put / list / delete wrappers
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { runWrangler } from "../utils/run.js";
import {
  CLIError,
  ExitCode,
  printHeader,
  printInfo,
  printJson,
  printOk,
  wrapAction,
  type GlobalOpts,
} from "../utils/format.js";

/** Production-oriented secrets commonly set on the AXIS Worker. */
export const KNOWN_SECRETS = [
  "ADMIN_TOKEN",
  "EXTERNAL_BACKEND",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITLAB_OAUTH_CLIENT_ID",
] as const;

function requireWorkerToml(): string {
  const paths = getPaths();
  if (!existsSync(paths.wranglerToml)) {
    throw new CLIError(
      "worker/wrangler.toml missing",
      ExitCode.NOT_FOUND,
      "Run: axis setup worker"
    );
  }
  return paths.worker;
}

export async function secretPut(
  opts: GlobalOpts,
  name: string,
  value?: string
): Promise<void> {
  const worker = requireWorkerToml();
  const key = name.trim();
  if (!key) {
    throw new CLIError("Secret name required", ExitCode.INVALID_USAGE);
  }

  printHeader(`AXIS secret put ${key}`, opts.quiet);

  if (value != null && value !== "") {
    await runWrangler(worker, ["secret", "put", key], {
      inherit: true,
      input: value,
    });
  } else if (!process.stdin.isTTY) {
    // Read from stdin pipe
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const v = Buffer.concat(chunks).toString("utf-8").replace(/\n$/, "");
    if (!v) {
      throw new CLIError(
        "Empty secret value (pipe a value or pass --value)",
        ExitCode.INVALID_USAGE
      );
    }
    await runWrangler(worker, ["secret", "put", key], {
      inherit: true,
      input: v,
    });
  } else {
    // Interactive wrangler prompt
    printInfo("Enter secret value when wrangler prompts…", opts.quiet);
    await runWrangler(worker, ["secret", "put", key], { inherit: true });
  }

  printOk(`Secret ${key} set`, opts.quiet);
  if (opts.json) printJson({ ok: true, name: key });
}

export async function secretList(opts: GlobalOpts): Promise<void> {
  const worker = requireWorkerToml();
  printHeader("AXIS secrets", opts.quiet);
  const r = await runWrangler(worker, ["secret", "list"], {
    throwOnError: false,
  });
  if (r.code !== 0) {
    throw new CLIError(
      "Failed to list secrets",
      ExitCode.ERROR,
      r.stderr || r.stdout
    );
  }
  if (opts.json) {
    try {
      printJson(JSON.parse(r.stdout));
    } catch {
      printJson({ ok: true, raw: r.stdout });
    }
    return;
  }
  process.stdout.write(r.stdout || "(no secrets)\n");
  printInfo(
    `Common keys: ${KNOWN_SECRETS.join(", ")}`,
    opts.quiet
  );
}

export async function secretDelete(
  opts: GlobalOpts,
  name: string
): Promise<void> {
  const worker = requireWorkerToml();
  const key = name.trim();
  if (!key) {
    throw new CLIError("Secret name required", ExitCode.INVALID_USAGE);
  }
  printHeader(`AXIS secret delete ${key}`, opts.quiet);
  await runWrangler(worker, ["secret", "delete", key], {
    inherit: !opts.quiet,
    input: opts.yes ? "y\n" : undefined,
  });
  printOk(`Secret ${key} deleted`, opts.quiet);
  if (opts.json) printJson({ ok: true, deleted: key });
}

export function registerSecrets(program: Command): void {
  const secret = program
    .command("secret")
    .alias("secrets")
    .description("Manage Worker secrets (wrangler secret *)");

  secret
    .command("put <name>")
    .description("Set a secret (value via --value, stdin, or prompt)")
    .option("--value <value>", "Secret value (prefer stdin for CI)")
    .action(async function (this: Command, name: string) {
      const o = this.optsWithGlobals() as GlobalOpts & { value?: string };
      await wrapAction((g) => secretPut(g, name, o.value)).call(this);
    });

  secret
    .command("list")
    .description("List secret names on the Worker")
    .action(wrapAction(secretList));

  secret
    .command("delete <name>")
    .description("Delete a secret")
    .action(async function (this: Command, name: string) {
      await wrapAction((g) => secretDelete(g, name)).call(this);
    });
}
