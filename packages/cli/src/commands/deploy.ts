/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis deploy — Worker and/or Cloudflare Pages
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { getPaths } from '../utils/paths.js';
import { run, runWrangler } from '../utils/run.js';
import { defaultWorkerUrl, healthFeatures, probeHealth } from '../services/health.js';
import {
  deployOpenKeysViolation,
  getKvBindingId,
  getTomlVar,
  hasD1DbBinding,
} from '../services/wrangler-toml.js';
import { applyScriptsSchema, printCloudStorageNextSteps } from './setup.js';
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
} from '../utils/format.js';

const PAGES_PROJECT = 'axis';
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Hex git SHA, or empty. */
export function normalizeGitSha(raw: unknown): string {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return SHA_RE.test(v) ? v : '';
}

/** `git rev-parse HEAD` in `cwd`, or empty when git is missing. */
export function gitHeadSha(cwd: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (r.status !== 0) return '';
  return normalizeGitSha(r.stdout);
}

/**
 * wrangler `--define WORKER_GIT_SHA:"<sha>"` so `/health` can prove the
 * deployed isolate matches a commit. Empty SHA → no define (local tests).
 * The value MUST be a quoted JS string: unquoted hex is an identifier and
 * `typeof WORKER_GIT_SHA === "string"` is then false.
 */
export function wranglerGitDefine(sha: string): string[] {
  const v = normalizeGitSha(sha);
  if (!v) return [];
  return ['--define', `WORKER_GIT_SHA:${JSON.stringify(v)}`];
}

/**
 * wrangler `--var GIT_SHA:<sha>` runtime binding. Vars are always strings, so
 * this survives when the esbuild `--define` substitution does not.
 */
export function wranglerGitVar(sha: string): string[] {
  const v = normalizeGitSha(sha);
  if (!v) return [];
  return ['--var', `GIT_SHA:${v}`];
}

/** Compile-time define + runtime var for one SHA. */
export function wranglerGitFlags(sha: string): string[] {
  return [...wranglerGitDefine(sha), ...wranglerGitVar(sha)];
}

/** `git` field from Worker `/health` JSON. */
export function healthGitSha(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  return normalizeGitSha((body as { git?: unknown }).git);
}

/** `version` + `git` from a Vite `dist/version.json`. */
export function readDistIdentity(distDir: string): { version: string; git: string } {
  const raw = readFileSync(join(distDir, 'version.json'), 'utf8');
  const body = JSON.parse(raw) as { version?: unknown; git?: unknown };
  return {
    version: String(body.version ?? '').trim(),
    git: normalizeGitSha(body.git),
  };
}

/**
 * Deploy identity proof: live (or dist) SHA must equal `git rev-parse HEAD`.
 * Empty expected SHA means git is unavailable — refuse to call this a match.
 */
export function assertGitProof(surface: string, expected: string, actual: string): void {
  const exp = normalizeGitSha(expected);
  const got = normalizeGitSha(actual);
  if (!exp) {
    throw new CLIError(
      `${surface}: local git SHA missing (git rev-parse HEAD failed)`,
      ExitCode.ERROR,
      'Run from an AXIS git checkout so deploy identity can be proven.',
    );
  }
  if (got !== exp) {
    throw new CLIError(
      `${surface} git mismatch: live ${got || '(empty)'} vs HEAD ${exp}`,
      ExitCode.ERROR,
      'Identity is VERSION + git SHA. Worker: wrangler --define WORKER_GIT_SHA and --var GIT_SHA. Pages: dist/version.json from scripts/git-stamp.mjs.',
    );
  }
}

/** Last workers.dev URL printed by `wrangler deploy`. */
export function parseDeployedWorkerUrl(output: string): string | undefined {
  const matches = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\/?/gi);
  if (!matches?.length) return undefined;
  return matches[matches.length - 1].replace(/\/$/, '');
}

/**
 * Deploys the Worker, applying the remote D1 schema first and health-checking after.
 *
 * Two guards run before wrangler: a missing `worker/wrangler.toml` aborts, and
 * {@link deployOpenKeysViolation} refuses a config where D1 is bound without
 * `API_KEYS` KV while open keys are on. A schema-apply failure is a warning, not a
 * hard stop, so a schema problem does not block the code deploy.
 *
 * @param opts - Global flags; `json` adds a `{ ok, target, url }` line, `quiet` hides
 *   the wrangler output.
 * @param flags - `skipHealth` skips the post-deploy probe, `url` overrides the probed
 *   URL (otherwise parsed from wrangler output, then {@link defaultWorkerUrl}),
 *   `skipSchema` skips the remote D1 apply.
 * @returns The URL that was probed or reported.
 * @throws {CLIError} When the toml is missing (`ExitCode.NOT_FOUND`), the open-keys
 *   guard trips, or `wrangler deploy` exits non-zero (with wrangler's stderr as the
 *   hint).
 */
export async function deployWorker(
  opts: GlobalOpts,
  flags: { skipHealth?: boolean; url?: string; skipSchema?: boolean } = {},
): Promise<{ url?: string }> {
  const paths = getPaths();
  if (!existsSync(paths.wranglerToml)) {
    throw new CLIError(
      'worker/wrangler.toml missing',
      ExitCode.NOT_FOUND,
      'Run: axis setup worker',
    );
  }

  printHeader('AXIS deploy worker', opts.quiet);

  const violation = deployOpenKeysViolation({
    d1Bound: hasD1DbBinding(paths.wranglerToml),
    apiKeysKvBound: Boolean(getKvBindingId(paths.wranglerToml, 'API_KEYS')),
    allowOpenKeys: getTomlVar(paths.wranglerToml, 'ALLOW_OPEN_KEYS'),
  });
  if (violation) {
    throw new CLIError(
      'Refusing to deploy: open API keys with D1 and no API_KEYS KV',
      ExitCode.ERROR,
      violation,
    );
  }

  if (!flags.skipSchema) {
    try {
      printInfo('Applying remote D1 scripts schema…', opts.quiet);
      await applyScriptsSchema(opts, { remote: true });
    } catch (e) {
      printWarn(`D1 schema not applied: ${e instanceof Error ? e.message : String(e)}`, opts.quiet);
      printWarn('Fix with: axis setup d1 --remote', opts.quiet);
    }
  }

  printInfo('wrangler deploy…', opts.quiet);

  const gitSha = gitHeadSha(paths.root);
  if (!gitSha) {
    throw new CLIError(
      `git rev-parse HEAD failed in ${paths.root}`,
      ExitCode.ERROR,
      'Refusing to deploy a Worker without a commit SHA proof.',
    );
  }
  printInfo(`Worker git SHA ${gitSha}`, opts.quiet);

  // Always capture so a failure never re-invokes deploy, and so we can parse the URL.
  const result = await runWrangler(paths.worker, ['deploy', ...wranglerGitFlags(gitSha)], {
    inherit: false,
    throwOnError: false,
  });

  if (result.code !== 0) {
    throw new CLIError(
      `Worker deploy failed (exit ${result.code})`,
      ExitCode.ERROR,
      result.stderr || result.stdout,
    );
  }

  if (!opts.quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  const deployedUrl =
    flags.url || parseDeployedWorkerUrl(`${result.stdout}\n${result.stderr}`) || defaultWorkerUrl();

  if (!flags.skipHealth) {
    const health = await probeHealth(deployedUrl);
    const reported = healthGitSha(health.body);
    printInfo(`Health git ${reported || '(empty)'}`, opts.quiet);
    if (health.ok) {
      printOk(`Health OK: ${health.url}`, opts.quiet);
      const feats = healthFeatures(health.body);
      if (feats.d1 && !feats.keys) {
        printWarn(
          'D1 is bound but API_KEYS KV is not — /api/scripts returns 503 API_KEYS_REQUIRED',
          opts.quiet,
        );
        printWarn('Fix: axis setup kv && axis deploy worker', opts.quiet);
      }
    } else {
      printWarn(
        `Deployed but health check failed: ${health.error || health.status} (${deployedUrl})`,
        opts.quiet,
      );
    }
    assertGitProof('Worker /health', gitSha, reported);
  }

  printOk('Worker deployed', opts.quiet);
  if (opts.json) {
    printJson({ ok: true, target: 'worker', url: deployedUrl });
  }
  return { url: deployedUrl };
}

/**
 * Builds the Vite app and uploads `dist/` to the `axis` Pages project.
 *
 * Exactly one deploy attempt is made — wrangler is never retried through a second
 * tool, because a half-finished upload would then be duplicated.
 *
 * @param opts - Global flags; `json` prints `{ ok, target, project }`, `quiet` hides
 *   build and upload output.
 * @throws {CLIError} `dist/ missing after build` when the build produced nothing.
 * @throws {Error} From {@link run} when the build fails, or from {@link runWrangler}
 *   when the upload fails.
 */
export async function deployPages(opts: GlobalOpts): Promise<void> {
  const paths = getPaths();
  printHeader('AXIS deploy pages', opts.quiet);

  printInfo('Building Vite app…', opts.quiet);
  await run('bun', ['run', 'build'], {
    cwd: paths.root,
    inherit: !opts.quiet,
  });

  if (!existsSync(paths.dist)) {
    throw new CLIError('dist/ missing after build', ExitCode.ERROR);
  }

  const gitSha = gitHeadSha(paths.root);
  let distIdentity: { version: string; git: string };
  try {
    distIdentity = readDistIdentity(paths.dist);
  } catch (e) {
    throw new CLIError(
      'dist/version.json missing or invalid after build',
      ExitCode.ERROR,
      e instanceof Error ? e.message : String(e),
    );
  }
  printInfo(
    `Pages identity ${distIdentity.version}+${distIdentity.git || '(no git)'}`,
    opts.quiet,
  );
  assertGitProof('dist/version.json', gitSha, distIdentity.git);

  printInfo(`wrangler pages deploy → ${PAGES_PROJECT}…`, opts.quiet);
  // Single attempt. runWrangler resolves the local worker wrangler first and
  // only falls back to a version-pinned bunx/npx when the binary is missing
  // (see wranglerCmd). A failed deploy is never retried through a second tool.
  await runWrangler(
    paths.worker,
    ['pages', 'deploy', paths.dist, `--project-name=${PAGES_PROJECT}`],
    { inherit: !opts.quiet },
  );

  printOk('Pages deploy finished', opts.quiet);
  if (opts.json) printJson({ ok: true, target: 'pages', project: PAGES_PROJECT });
}

/**
 * Deploys the Worker then Pages, then prints the remaining Cloudflare storage steps.
 *
 * Pages is skipped when the Worker deploy throws, so a broken backend never ships a
 * new frontend against it.
 *
 * @param opts - Global flags, forwarded to both deploys.
 * @param flags - Worker-only options (`skipHealth`, `url`, `skipSchema`); Pages has
 *   none.
 * @throws {CLIError} Whatever {@link deployWorker} raises.
 */
export async function deployAll(
  opts: GlobalOpts,
  flags: { skipHealth?: boolean; url?: string; skipSchema?: boolean } = {},
): Promise<void> {
  await deployWorker(opts, flags);
  await deployPages(opts);
  printOk('Deploy all complete', opts.quiet);
  printCloudStorageNextSteps(opts.quiet, 'after-deploy');
}

/**
 * Registers `axis deploy` plus `worker`, `pages`, and `all`.
 *
 * Bare `axis deploy` behaves like `deploy worker`; the subcommands exist so CI can
 * ship one target at a time.
 *
 * @param program - Root commander program to attach the command group to.
 */
export function registerDeploy(program: Command): void {
  const deploy = program
    .command('deploy')
    .description('Deploy Worker and/or Cloudflare Pages')
    .option('--skip-health', 'Skip post-deploy /health probe')
    .option('--skip-schema', 'Skip remote D1 schema apply before Worker deploy')
    .option('--url <url>', 'Worker URL for health probe')
    .action(async function (this: Command) {
      // default: worker
      const o = this.optsWithGlobals() as GlobalOpts & {
        skipHealth?: boolean;
        skipSchema?: boolean;
        url?: string;
      };
      await wrapAction(async (g) => {
        await deployWorker(g, {
          skipHealth: o.skipHealth,
          skipSchema: o.skipSchema,
          url: o.url,
        });
      }).call(this);
    });

  deploy
    .command('worker')
    .description('Deploy Cloudflare Worker (worker-axis)')
    .option('--skip-health', 'Skip post-deploy /health probe')
    .option('--skip-schema', 'Skip remote D1 schema apply before Worker deploy')
    .option('--url <url>', 'Worker URL for health probe')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        skipHealth?: boolean;
        skipSchema?: boolean;
        url?: string;
      };
      await wrapAction(async (g) => {
        await deployWorker(g, {
          skipHealth: o.skipHealth,
          skipSchema: o.skipSchema,
          url: o.url,
        });
      }).call(this);
    });

  deploy
    .command('pages')
    .description('Build Vite app and deploy Cloudflare Pages')
    .action(wrapAction(deployPages));

  deploy
    .command('all')
    .description('Deploy Worker then Pages (applies D1 schema first)')
    .option('--skip-health', 'Skip post-deploy /health probe')
    .option('--skip-schema', 'Skip remote D1 schema apply')
    .option('--url <url>', 'Worker URL for health probe')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals() as GlobalOpts & {
        skipHealth?: boolean;
        skipSchema?: boolean;
        url?: string;
      };
      await wrapAction(async (g) => {
        await deployAll(g, {
          skipHealth: o.skipHealth,
          skipSchema: o.skipSchema,
          url: o.url,
        });
      }).call(this);
    });
}
