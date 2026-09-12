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
import { commentTomlVar, hasTomlVar } from "../services/wrangler-toml.js";
import { promptSecret } from "../utils/prompt.js";
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

/** Cloudflare Workers API code 10053 — name already bound as a plaintext var. */
export function isBindingNameInUse(output: string): boolean {
  return /already in use/i.test(output) && /\b10053\b/.test(output);
}

/**
 * Comment a colliding `[vars]` key and deploy so `wrangler secret put` can succeed.
 * Returns true when a deploy ran.
 */
export async function dropPlaintextVarForSecret(
  opts: GlobalOpts,
  key: string
): Promise<boolean> {
  const paths = getPaths();
  if (!existsSync(paths.wranglerToml) || !hasTomlVar(paths.wranglerToml, key)) {
    return false;
  }
  commentTomlVar(paths.wranglerToml, key);
  printWarn(
    `[vars] ${key} commented out — Cloudflare forbids the same name as a var and a secret (10053).`,
    opts.quiet
  );
  printInfo("Deploying Worker to drop the plaintext binding…", opts.quiet);
  const deployed = await runWrangler(paths.worker, ["deploy"], {
    inherit: !opts.quiet,
    throwOnError: false,
  });
  if (deployed.code !== 0) {
    throw new CLIError(
      `Failed to drop [vars] ${key} (deploy exit ${deployed.code})`,
      ExitCode.ERROR,
      deployed.stderr || deployed.stdout || "Comment the var in wrangler.toml, then: axis deploy worker"
    );
  }
  printOk("Plaintext var dropped", opts.quiet);
  return true;
}

async function readSecretValue(
  opts: GlobalOpts,
  value?: string
): Promise<string> {
  if (value != null && value !== "") return value;
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf-8").replace(/\n$/, "");
  }
  printInfo("Enter secret value (input hidden)…", opts.quiet);
  return (await promptSecret("Secret: ")).trim();
}

async function wranglerSecretPut(
  worker: string,
  key: string,
  secretValue: string,
  opts: GlobalOpts
) {
  const input = secretValue.endsWith("\n") ? secretValue : `${secretValue}\n`;
  return runWrangler(worker, ["secret", "put", key], {
    inherit: !opts.quiet,
    throwOnError: false,
    input,
  });
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
  const secretValue = await readSecretValue(opts, value);
  if (!secretValue) {
    throw new CLIError(
      "Empty secret value (pipe a value or pass --value)",
      ExitCode.INVALID_USAGE
    );
  }

  await dropPlaintextVarForSecret(opts, key);

  let put = await wranglerSecretPut(worker, key, secretValue, opts);
  if (put.code !== 0) {
    const detail = `${put.stderr}\n${put.stdout}`;
    printWarn(
      isBindingNameInUse(detail)
        ? "Cloudflare 10053: name still a plaintext var on the live Worker. Deploying to drop it, then retrying…"
        : `secret put exited ${put.code}; deploying Worker and retrying…`,
      opts.quiet
    );
    const deployed = await runWrangler(worker, ["deploy"], {
      inherit: !opts.quiet,
      throwOnError: false,
    });
    if (deployed.code !== 0) {
      throw new CLIError(
        `Failed to drop remote [vars] ${key} (deploy exit ${deployed.code})`,
        ExitCode.ERROR,
        deployed.stderr || deployed.stdout
      );
    }
    put = await wranglerSecretPut(worker, key, secretValue, opts);
  }

  if (put.code !== 0) {
    const detail = `${put.stderr}\n${put.stdout}`;
    throw new CLIError(
      `wrangler secret put ${key} failed (exit ${put.code})`,
      ExitCode.ERROR,
      isBindingNameInUse(detail)
        ? `Binding already a [vars] entry. Comment ${key} out of wrangler.toml, then: axis deploy worker && axis secret put ${key}`
        : "Comment any matching [vars] key, deploy the Worker, and retry."
    );
  }

  printOk(`Secret ${key} set`, opts.quiet);
  if (key === "ADMIN_TOKEN") {
    printInfo(
      "axis keys create cannot read Worker secrets — pass --admin-token, AXIS_ADMIN_TOKEN, or enter it when prompted.",
      opts.quiet
    );
  }
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
