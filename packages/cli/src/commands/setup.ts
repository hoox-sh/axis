/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis setup — worker config, D1, API_KEYS KV, OAuth client ids, full bootstrap
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { runWrangler } from "../utils/run.js";
import {
  ensureWranglerToml,
  getD1DatabaseId,
  getKvBindingId,
  isPlaceholderId,
  parseKvNamespaceId,
  setTomlVar,
  upsertKvNamespace,
} from "../services/wrangler-toml.js";
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
import { runInstall } from "./install.js";

export type SetupResult = {
  steps: string[];
  wranglerCreated?: boolean;
  d1Applied?: "local" | "remote" | "both" | false;
  kvBound?: { binding: string; id: string; created: boolean } | false;
  oauthSet?: boolean;
};

const API_KEYS_BINDING = "API_KEYS";
const USAGE_BINDING = "USAGE";

async function setupWorkerToml(opts: GlobalOpts): Promise<boolean> {
  const paths = getPaths();
  const r = ensureWranglerToml(paths.wranglerToml, paths.wranglerExample);
  if (r.created) {
    printOk(`Created ${r.path} from example`, opts.quiet);
    printWarn(
      "Edit database_id / ALLOWED_ORIGIN / OAuth ids before production deploy",
      opts.quiet
    );
  } else {
    printOk(`wrangler.toml present: ${r.path}`, opts.quiet);
  }
  return r.created;
}

async function setupD1(
  opts: GlobalOpts,
  flags: { local?: boolean; remote?: boolean; create?: boolean }
): Promise<"local" | "remote" | "both" | false> {
  const paths = getPaths();
  if (!existsSync(paths.wranglerToml)) {
    throw new CLIError(
      "wrangler.toml missing",
      ExitCode.NOT_FOUND,
      "Run: axis setup worker"
    );
  }
  if (!existsSync(paths.d1Schema)) {
    throw new CLIError(`Schema missing: ${paths.d1Schema}`, ExitCode.NOT_FOUND);
  }

  const id = getD1DatabaseId(paths.wranglerToml);
  if (!id || id.includes("REPLACE")) {
    if (flags.create) {
      printInfo("Creating D1 database pynescript…", opts.quiet);
      await runWrangler(paths.worker, ["d1", "create", "pynescript"], {
        inherit: !opts.quiet,
      });
      printWarn(
        "Paste the new database_id into worker/wrangler.toml, then re-run: axis setup d1 --remote",
        opts.quiet
      );
      return false;
    }
    throw new CLIError(
      "D1 database_id is missing or a placeholder",
      ExitCode.ERROR,
      "Set database_id in wrangler.toml or: axis setup d1 --create"
    );
  }

  const { applyLocal, applyRemote } = d1ApplyPlan(flags);
  let applied: "local" | "remote" | "both" | false = false;

  if (applyLocal) {
    printInfo("Applying D1 schema (local)…", opts.quiet);
    await runWrangler(
      paths.worker,
      ["d1", "execute", "pynescript", "--local", "--file=schemas/scripts.sql"],
      { inherit: !opts.quiet }
    );
    applied = "local";
    printOk("Local D1 schema applied", opts.quiet);
  }

  if (applyRemote) {
    printInfo("Applying D1 schema (remote)…", opts.quiet);
    await runWrangler(
      paths.worker,
      ["d1", "execute", "pynescript", "--remote", "--file=schemas/scripts.sql"],
      { inherit: !opts.quiet }
    );
    applied = applied === "local" ? "both" : "remote";
    printOk("Remote D1 schema applied", opts.quiet);
  }

  return applied;
}

/** Apply `schemas/scripts.sql` (idempotent). Used by `axis setup d1` and deploy. */
export const applyScriptsSchema = setupD1;

function parseKvList(stdout: string): Array<{ id?: string; title?: string }> {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<{ id?: string; title?: string }>) : [];
  } catch {
    return [];
  }
}

async function findExistingKvId(
  workerDir: string,
  titleHint: string
): Promise<string | undefined> {
  const listed = await runWrangler(workerDir, ["kv", "namespace", "list"], {
    throwOnError: false,
  });
  if (listed.code !== 0) return undefined;
  const hint = titleHint.toLowerCase();
  for (const row of parseKvList(listed.stdout)) {
    const title = String(row.title || "").toLowerCase();
    const id = String(row.id || "");
    if (id && (title.includes(hint) || title.endsWith(`-${hint}`))) return id;
  }
  return undefined;
}

/**
 * Create (or reuse) a KV namespace and bind it in wrangler.toml.
 * Required for production `/api/scripts` when D1 is bound (`API_KEYS_REQUIRED`).
 */
export async function setupKv(
  opts: GlobalOpts,
  flags: { binding?: string } = {}
): Promise<{ binding: string; id: string; created: boolean }> {
  const paths = getPaths();
  if (!existsSync(paths.wranglerToml)) {
    throw new CLIError(
      "wrangler.toml missing",
      ExitCode.NOT_FOUND,
      "Run: axis setup worker"
    );
  }
  const binding = (flags.binding || API_KEYS_BINDING).trim() || API_KEYS_BINDING;
  const existing = getKvBindingId(paths.wranglerToml, binding);
  if (existing && !isPlaceholderId(existing)) {
    printOk(`KV ${binding} already bound (${existing})`, opts.quiet);
    return { binding, id: existing, created: false };
  }

  printInfo(`Looking up existing KV namespace for ${binding}…`, opts.quiet);
  let id = await findExistingKvId(paths.worker, binding);
  let created = false;
  if (!id) {
    printInfo(`Creating KV namespace ${binding}…`, opts.quiet);
    const createdRun = await runWrangler(
      paths.worker,
      ["kv", "namespace", "create", binding],
      { throwOnError: false }
    );
    const out = `${createdRun.stdout}\n${createdRun.stderr}`;
    id = parseKvNamespaceId(out);
    if (createdRun.code !== 0 || !id) {
      throw new CLIError(
        `Failed to create KV namespace ${binding}`,
        ExitCode.ERROR,
        out.trim() || "wrangler kv namespace create failed"
      );
    }
    created = true;
    printOk(`Created KV ${binding} id=${id}`, opts.quiet);
  } else {
    printOk(`Reusing existing KV ${binding} id=${id}`, opts.quiet);
  }

  const wrote = upsertKvNamespace(paths.wranglerToml, binding, id);
  if (wrote.changed) {
    printOk(`wrangler.toml: bound ${binding}`, opts.quiet);
  }
  printWarn("Redeploy the Worker so the binding goes live: axis deploy worker", opts.quiet);
  return { binding, id, created };
}

export function printCloudStorageNextSteps(quiet?: boolean): void {
  printInfo("Cloud script storage — remaining steps:", quiet);
  printInfo("  1. axis secret put ADMIN_TOKEN", quiet);
  printInfo("  2. axis deploy all              # D1 schema + Worker + Pages", quiet);
  printInfo("  3. axis keys create             # mint pn_… for Settings", quiet);
  printInfo("  4. axis health --scripts", quiet);
  printInfo("  5. Paste Worker URL + key in Settings → Script storage", quiet);
}

/** Default is local-only; `--remote` alone is remote-only; both flags apply both. */
export function d1ApplyPlan(flags: {
  local?: boolean;
  remote?: boolean;
}): { applyLocal: boolean; applyRemote: boolean } {
  const applyRemote = Boolean(flags.remote);
  const applyLocal = Boolean(flags.local) || !applyRemote;
  return { applyLocal, applyRemote };
}

async function setupOAuth(
  opts: GlobalOpts,
  flags: {
    githubClientId?: string;
    gitlabClientId?: string;
    asSecret?: boolean;
  }
): Promise<boolean> {
  const paths = getPaths();
  if (!existsSync(paths.wranglerToml)) {
    throw new CLIError(
      "wrangler.toml missing",
      ExitCode.NOT_FOUND,
      "Run: axis setup worker"
    );
  }

  let changed = false;

  if (flags.githubClientId) {
    if (flags.asSecret) {
      printInfo("Setting GITHUB_OAUTH_CLIENT_ID as Worker secret…", opts.quiet);
      await runWrangler(
        paths.worker,
        ["secret", "put", "GITHUB_OAUTH_CLIENT_ID"],
        { inherit: true, input: flags.githubClientId }
      );
      printOk("GITHUB_OAUTH_CLIENT_ID secret set", opts.quiet);
      changed = true;
    } else {
      const r = setTomlVar(
        paths.wranglerToml,
        "GITHUB_OAUTH_CLIENT_ID",
        flags.githubClientId
      );
      printOk(
        r.changed
          ? `GITHUB_OAUTH_CLIENT_ID → ${flags.githubClientId}`
          : "GITHUB_OAUTH_CLIENT_ID already set",
        opts.quiet
      );
      changed = r.changed || changed;
    }
  }

  if (flags.gitlabClientId) {
    if (flags.asSecret) {
      await runWrangler(
        paths.worker,
        ["secret", "put", "GITLAB_OAUTH_CLIENT_ID"],
        { inherit: true, input: flags.gitlabClientId }
      );
      printOk("GITLAB_OAUTH_CLIENT_ID secret set", opts.quiet);
      changed = true;
    } else {
      const r = setTomlVar(
        paths.wranglerToml,
        "GITLAB_OAUTH_CLIENT_ID",
        flags.gitlabClientId
      );
      printOk(
        r.changed
          ? `GITLAB_OAUTH_CLIENT_ID → ${flags.gitlabClientId}`
          : "GITLAB_OAUTH_CLIENT_ID already set",
        opts.quiet
      );
      changed = r.changed || changed;
    }
  }

  if (!flags.githubClientId && !flags.gitlabClientId) {
    throw new CLIError(
      "Pass --github-client-id and/or --gitlab-client-id",
      ExitCode.INVALID_USAGE,
      "Example: axis setup oauth --github-client-id Ov23li…"
    );
  }

  return changed;
}

export async function runSetupAll(
  opts: GlobalOpts,
  flags: {
    remoteD1?: boolean;
    githubClientId?: string;
    skipInstall?: boolean;
    kv?: boolean;
    prod?: boolean;
  }
): Promise<SetupResult> {
  printHeader("AXIS setup", opts.quiet);
  const steps: string[] = [];
  const result: SetupResult = { steps };
  const prod = Boolean(flags.prod);
  const remoteD1 = Boolean(flags.remoteD1 || prod);
  const doKv = Boolean(flags.kv || prod);

  if (!flags.skipInstall) {
    await runInstall(opts);
    steps.push("install");
  }

  result.wranglerCreated = await setupWorkerToml(opts);
  steps.push("worker");

  try {
    result.d1Applied = await setupD1(opts, {
      local: true,
      remote: remoteD1,
    });
    steps.push(remoteD1 ? "d1:local+remote" : "d1:local");
  } catch (e) {
    printWarn(
      e instanceof Error ? e.message : String(e),
      opts.quiet
    );
    result.d1Applied = false;
  }

  if (doKv) {
    try {
      result.kvBound = await setupKv(opts, { binding: API_KEYS_BINDING });
      steps.push("kv:API_KEYS");
    } catch (e) {
      printWarn(e instanceof Error ? e.message : String(e), opts.quiet);
      result.kvBound = false;
    }
  }

  if (flags.githubClientId) {
    result.oauthSet = await setupOAuth(opts, {
      githubClientId: flags.githubClientId,
    });
    steps.push("oauth");
  }

  printOk("Setup finished.", opts.quiet);
  if (doKv || remoteD1) printCloudStorageNextSteps(opts.quiet);
  else {
    printInfo("Next: axis doctor  ·  Prod cloud storage: axis setup --prod", opts.quiet);
  }

  if (opts.json) printJson({ ok: true, ...result });
  return result;
}

export function registerSetup(program: Command): void {
  const setup = program
    .command("setup")
    .description("Bootstrap AXIS (deps, wrangler.toml, D1, API_KEYS KV, OAuth)")
    .option("--remote-d1", "Also apply D1 schema to remote")
    .option("--kv", "Create and bind API_KEYS KV (required for prod /api/scripts)")
    .option("--prod", "Production bootstrap: remote D1 + API_KEYS KV")
    .option("--github-client-id <id>", "Set GITHUB_OAUTH_CLIENT_ID in toml")
    .option("--skip-install", "Skip bun install")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        remoteD1?: boolean;
        githubClientId?: string;
        skipInstall?: boolean;
        kv?: boolean;
        prod?: boolean;
      };
      await wrapAction(async (g) => {
        await runSetupAll(g, {
          remoteD1: o.remoteD1,
          githubClientId: o.githubClientId,
          skipInstall: o.skipInstall,
          kv: o.kv,
          prod: o.prod,
        });
      }).call(this);
    });

  setup
    .command("worker")
    .description("Ensure worker/wrangler.toml exists (copy from example)")
    .action(
      wrapAction(async (opts) => {
        printHeader("AXIS setup worker", opts.quiet);
        const created = await setupWorkerToml(opts);
        if (opts.json) printJson({ ok: true, created });
      })
    );

  setup
    .command("d1")
    .description("Apply D1 scripts schema (local and/or remote)")
    .option("--local", "Apply to local D1 (default if neither flag)")
    .option("--remote", "Apply to remote D1")
    .option("--create", "wrangler d1 create pynescript if id missing")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        local?: boolean;
        remote?: boolean;
        create?: boolean;
      };
      await wrapAction(async (g) => {
        printHeader("AXIS setup d1", g.quiet);
        const both = !o.local && !o.remote && !o.create;
        const applied = await setupD1(g, {
          local: o.local || both,
          remote: o.remote,
          create: o.create,
        });
        if (g.json) printJson({ ok: true, applied });
      }).call(this);
    });

  setup
    .command("kv")
    .description("Create and bind API_KEYS KV (prod script library auth)")
    .option("--binding <name>", "KV binding name", API_KEYS_BINDING)
    .option("--usage", `Also create/bind ${USAGE_BINDING}`)
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        binding?: string;
        usage?: boolean;
      };
      await wrapAction(async (g) => {
        printHeader("AXIS setup kv", g.quiet);
        const bound = await setupKv(g, { binding: o.binding || API_KEYS_BINDING });
        let usage: { binding: string; id: string; created: boolean } | undefined;
        if (o.usage) {
          usage = await setupKv(g, { binding: USAGE_BINDING });
        }
        printCloudStorageNextSteps(g.quiet);
        if (g.json) printJson({ ok: true, kv: bound, usage });
      }).call(this);
    });

  setup
    .command("oauth")
    .description("Set GitHub/GitLab OAuth App client ids")
    .option("--github-client-id <id>", "GitHub OAuth App client id")
    .option("--gitlab-client-id <id>", "GitLab OAuth application id")
    .option("--secret", "Use wrangler secret put instead of [vars]")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        githubClientId?: string;
        gitlabClientId?: string;
        secret?: boolean;
      };
      await wrapAction(async (g) => {
        printHeader("AXIS setup oauth", g.quiet);
        const changed = await setupOAuth(g, {
          githubClientId: o.githubClientId,
          gitlabClientId: o.gitlabClientId,
          asSecret: o.secret,
        });
        if (g.json) printJson({ ok: true, changed });
      }).call(this);
    });

}
