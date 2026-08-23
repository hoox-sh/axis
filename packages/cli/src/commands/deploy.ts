/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis deploy — Worker and/or Cloudflare Pages
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getPaths } from "../utils/paths.js";
import { run, runWrangler } from "../utils/run.js";
import { defaultWorkerUrl, probeHealth } from "../services/health.js";
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

const PAGES_PROJECT = "pynescript-axis";

/** Last workers.dev URL printed by `wrangler deploy`. */
export function parseDeployedWorkerUrl(output: string): string | undefined {
  const matches = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\/?/gi);
  if (!matches?.length) return undefined;
  return matches[matches.length - 1].replace(/\/$/, "");
}

export async function deployWorker(
  opts: GlobalOpts,
  flags: { skipHealth?: boolean; url?: string } = {}
): Promise<{ url?: string }> {
  const paths = getPaths();
  if (!existsSync(paths.wranglerToml)) {
    throw new CLIError(
      "worker/wrangler.toml missing",
      ExitCode.NOT_FOUND,
      "Run: axis setup worker"
    );
  }

  printHeader("AXIS deploy worker", opts.quiet);
  printInfo("wrangler deploy…", opts.quiet);

  // Always capture so a failure never re-invokes deploy, and so we can parse the URL.
  const result = await runWrangler(paths.worker, ["deploy"], {
    inherit: false,
    throwOnError: false,
  });

  if (result.code !== 0) {
    throw new CLIError(
      `Worker deploy failed (exit ${result.code})`,
      ExitCode.ERROR,
      result.stderr || result.stdout
    );
  }

  if (!opts.quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  const deployedUrl =
    flags.url ||
    parseDeployedWorkerUrl(`${result.stdout}\n${result.stderr}`) ||
    defaultWorkerUrl();

  if (!flags.skipHealth) {
    const health = await probeHealth(deployedUrl);
    if (health.ok) {
      printOk(`Health OK: ${health.url}`, opts.quiet);
    } else {
      printWarn(
        `Deployed but health check failed: ${health.error || health.status} (${deployedUrl})`,
        opts.quiet
      );
    }
  }

  printOk("Worker deployed", opts.quiet);
  if (opts.json) {
    printJson({ ok: true, target: "worker", url: deployedUrl });
  }
  return { url: deployedUrl };
}

export async function deployPages(opts: GlobalOpts): Promise<void> {
  const paths = getPaths();
  printHeader("AXIS deploy pages", opts.quiet);

  printInfo("Building Vite app…", opts.quiet);
  await run("bun", ["run", "build"], {
    cwd: paths.root,
    inherit: !opts.quiet,
  });

  if (!existsSync(paths.dist)) {
    throw new CLIError("dist/ missing after build", ExitCode.ERROR);
  }

  printInfo(`wrangler pages deploy → ${PAGES_PROJECT}…`, opts.quiet);
  // Prefer worker local wrangler
  try {
    await runWrangler(
      paths.worker,
      [
        "pages",
        "deploy",
        paths.dist,
        `--project-name=${PAGES_PROJECT}`,
      ],
      { inherit: !opts.quiet }
    );
  } catch {
    await run(
      "bunx",
      ["wrangler", "pages", "deploy", paths.dist, `--project-name=${PAGES_PROJECT}`],
      { cwd: paths.root, inherit: !opts.quiet }
    );
  }

  printOk("Pages deploy finished", opts.quiet);
  if (opts.json) printJson({ ok: true, target: "pages", project: PAGES_PROJECT });
}

export async function deployAll(opts: GlobalOpts): Promise<void> {
  await deployWorker(opts);
  await deployPages(opts);
  printOk("Deploy all complete", opts.quiet);
}

export function registerDeploy(program: Command): void {
  const deploy = program
    .command("deploy")
    .description("Deploy Worker and/or Cloudflare Pages")
    .option("--skip-health", "Skip post-deploy /health probe")
    .option("--url <url>", "Worker URL for health probe")
    .action(async function (this: Command) {
      // default: worker
      const o = this.optsWithGlobals() as GlobalOpts & {
        skipHealth?: boolean;
        url?: string;
      };
      await wrapAction(async (g) => {
        await deployWorker(g, { skipHealth: o.skipHealth, url: o.url });
      }).call(this);
    });

  deploy
    .command("worker")
    .description("Deploy Cloudflare Worker (pynescript-axis)")
    .option("--skip-health", "Skip post-deploy /health probe")
    .option("--url <url>", "Worker URL for health probe")
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        skipHealth?: boolean;
        url?: string;
      };
      await wrapAction(async (g) => {
        await deployWorker(g, { skipHealth: o.skipHealth, url: o.url });
      }).call(this);
    });

  deploy
    .command("pages")
    .description("Build Vite app and deploy Cloudflare Pages")
    .action(wrapAction(deployPages));

  deploy
    .command("all")
    .description("Deploy Worker then Pages")
    .action(wrapAction(deployAll));
}
