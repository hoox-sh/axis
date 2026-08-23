/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis setup — worker config, D1, OAuth client ids, full bootstrap
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { runWrangler } from "../utils/run.js";
import {
  ensureWranglerToml,
  getD1DatabaseId,
  setTomlVar,
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
  oauthSet?: boolean;
};

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
  }
): Promise<SetupResult> {
  printHeader("AXIS setup", opts.quiet);
  const steps: string[] = [];
  const result: SetupResult = { steps };

  if (!flags.skipInstall) {
    await runInstall(opts);
    steps.push("install");
  }

  result.wranglerCreated = await setupWorkerToml(opts);
  steps.push("worker");

  try {
    result.d1Applied = await setupD1(opts, {
      local: true,
      remote: flags.remoteD1,
    });
    steps.push(flags.remoteD1 ? "d1:local+remote" : "d1:local");
  } catch (e) {
    printWarn(
      e instanceof Error ? e.message : String(e),
      opts.quiet
    );
    result.d1Applied = false;
  }

  if (flags.githubClientId) {
    result.oauthSet = await setupOAuth(opts, {
      githubClientId: flags.githubClientId,
    });
    steps.push("oauth");
  }

  printOk(
    "Setup finished. Deploy: axis deploy worker  |  Diagnose: axis doctor --remote",
    opts.quiet
  );

  if (opts.json) printJson({ ok: true, ...result });
  return result;
}

export function registerSetup(program: Command): void {
  const setup = program
    .command("setup")
    .description("Bootstrap AXIS (deps, wrangler.toml, D1, OAuth)")
    .option("--remote-d1", "Also apply D1 schema to remote")
    .option("--github-client-id <id>", "Set GITHUB_OAUTH_CLIENT_ID in toml")
    .option("--skip-install", "Skip bun install")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        remoteD1?: boolean;
        githubClientId?: string;
        skipInstall?: boolean;
      };
      await wrapAction(async (g) => {
        await runSetupAll(g, {
          remoteD1: o.remoteD1,
          githubClientId: o.githubClientId,
          skipInstall: o.skipInstall,
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
