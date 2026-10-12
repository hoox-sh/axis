/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Git-native Pine script storage on Cloudflare Artifacts — no GitHub
 * credentials required.
 *
 * ## Model
 * One Artifacts repo per API-key user (`axis-scripts-<id12>`). Each script
 * is two files: `scripts/<id>.pine` (Pine Script™ source) and
 * `scripts/<id>.meta.json` (name/description/path). Every save commits with
 * a machine-readable marker (`[axis-script:<id>]`), so `repo.log()` **is**
 * the version history — real SHAs, branchable, cloneable.
 *
 * ## Layering
 * - D1 (or memory) keeps the live tip: fast list/get, unchanged API shape.
 * - This module mirrors each write as a git commit (best-effort, never
 *   fails the save) and serves history + clone credentials from git.
 * - The Workers binding cannot read/write file trees, so commits go through
 *   `isomorphic-git` over an in-memory FS (`git-memfs.ts`), exactly as the
 *   Cloudflare docs prescribe for Workers.
 *
 * ## Auth (no GitHub creds anywhere)
 * Callers authenticate with their existing AXIS API key (`requireApiKey`
 * partitions by hashed `userId`). The Worker mints short-lived repo-scoped
 * Artifacts tokens for `git clone/push` — the PWA and CLIs never touch
 * GitHub OAuth for script storage.
 *
 * Artifacts is in closed beta: the `SCRIPT_ARTIFACTS` binding is optional.
 * Unbound → D1/memory behavior only (existing code paths, zero change).
 *
 * @module worker/artifacts-git
 */

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { MemoryFS } from './git-memfs';

/** Repo name prefix — one git repo per API-key user. */
const REPO_PREFIX = 'axis-scripts-';
/** Pine source lives here inside the repo (sidecar `.meta.json` next to it). */
const SCRIPTS_DIR = 'scripts';
/** Marker embedded in every mirror commit message for history filtering. */
const MARKER_PREFIX = '[axis-script:';
/** Commit author stamped on mirror commits. */
const MIRROR_AUTHOR = { name: 'AXIS scripts', email: 'scripts@axis.hoox.sh' } as const;
/** `createToken` TTL bounds for clone credentials (seconds). */
export const CLONE_TOKEN_MIN_TTL = 60;
export const CLONE_TOKEN_MAX_TTL = 24 * 3600;
export const CLONE_TOKEN_DEFAULT_TTL = 3600;

// --- Minimal structural types for the Artifacts binding ------------------
// (Declared locally so this module compiles against @cloudflare/workers-types
// versions that predate the generated `Artifacts` global.)

export interface ArtifactsRepoInfo {
  name: string;
  remote: string;
  defaultBranch?: string;
  status?: string;
}

export interface ArtifactsCreatedRepo extends ArtifactsRepoInfo {
  /** Initial write token: `art_v1_<secret>?expires=<unix_seconds>`. */
  token: string;
}

export interface ArtifactsTokenResult {
  plaintext: string;
  expiresAt: number;
  id?: string;
}

export interface ArtifactsCommitMeta {
  oid?: string;
  hash?: string;
  message?: string;
  timestamp?: number;
  committedAt?: number;
  author?: { name?: string; email?: string; timestamp?: number };
  [key: string]: unknown;
}

export interface ArtifactsRepoHandle {
  info(): Promise<ArtifactsRepoInfo>;
  createToken(scope: 'read' | 'write', ttl?: number): Promise<ArtifactsTokenResult | string>;
  log(opts?: { ref?: string; limit?: number; offset?: number }): Promise<ArtifactsCommitMeta[]>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
}

/** Subset of the Artifacts Workers binding surface used by script storage. */
export interface ArtifactsNamespace {
  create(
    name: string,
    opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string },
  ): Promise<ArtifactsCreatedRepo>;
  get(name: string): Promise<ArtifactsRepoHandle>;
  delete(name: string): Promise<boolean>;
}

// --- Naming / paths / markers --------------------------------------------

/** `axis-scripts-<12hex>` — safe repo name derived from the hashed user id. */
export function userRepoName(userId: string): string {
  const clean = String(userId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${REPO_PREFIX}${clean.slice(0, 12) || 'default'}`;
}

/** Script ids are `s_<base36>` plus `_draft`-style locals — keep them path-safe. */
export function safeScriptId(id: string): string {
  const clean = String(id || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  return clean || 'untitled';
}

export function scriptFilePath(id: string): string {
  return `${SCRIPTS_DIR}/${safeScriptId(id)}.pine`;
}

export function scriptMetaPath(id: string): string {
  return `${SCRIPTS_DIR}/${safeScriptId(id)}.meta.json`;
}

export function saveCommitMessage(name: string, id: string): string {
  return `Save ${name || 'script'} ${MARKER_PREFIX}${safeScriptId(id)}]`;
}

export function deleteCommitMessage(name: string, id: string): string {
  return `Remove ${name || 'script'} ${MARKER_PREFIX}${safeScriptId(id)}] [axis-delete]`;
}

export function restoreCommitMessage(name: string, id: string, sha: string): string {
  return `Restore ${name || 'script'} from ${String(sha).slice(0, 7)} ${MARKER_PREFIX}${safeScriptId(id)}]`;
}

export interface ScriptMarker {
  id: string;
  deleted: boolean;
}

/** Extract the machine marker from a mirror commit message (null when foreign). */
export function parseScriptMarker(message: string): ScriptMarker | null {
  const m = String(message || '').match(/\[axis-script:([A-Za-z0-9._-]{1,80})\]/);
  if (!m || !m[1]) return null;
  return { id: m[1], deleted: message.includes('[axis-delete]') };
}

/** Human line for history: strip machine markers, keep the verb + name. */
export function displayMessage(message: string, fallbackName: string): string {
  const stripped = String(message || '')
    .replace(/\[axis-script:[^\]]*\]/g, '')
    .replace(/\[axis-delete\]/g, '')
    .trim();
  return stripped || `Save ${fallbackName}`;
}

/** Split `art_v1_<secret>?expires=<unix_seconds>` into secret + expiry ms. */
export function splitTokenSecret(token: string): { secret: string; expiresAtMs: number | null } {
  const raw = String(token || '');
  const idx = raw.indexOf('?expires=');
  if (idx < 0) return { secret: raw, expiresAtMs: null };
  const expires = Number(raw.slice(idx + '?expires='.length));
  return {
    secret: raw.slice(0, idx),
    expiresAtMs: Number.isFinite(expires) && expires > 0 ? expires * 1000 : null,
  };
}

/** Normalize seconds-or-ms epoch stamps to ms (git/auth timestamps vary). */
export function epochToMs(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return Date.now();
  return ts < 1_000_000_000_000 ? ts * 1000 : ts;
}

// --- Repo handle lifecycle (no `using`: lib predates Explicit Resources) --

function releaseHandle(repo: ArtifactsRepoHandle): void {
  try {
    const disposeKey = (Symbol as unknown as Record<string, symbol | undefined>)['dispose'];
    if (typeof disposeKey !== 'undefined') {
      const fn = (repo as unknown as Record<symbol, unknown>)[disposeKey];
      if (typeof fn === 'function') {
        (fn as () => void).call(repo);
        return;
      }
    }
  } catch {
    /* ignore — handle release is best-effort */
  }
}

async function withRepo<T>(
  ns: ArtifactsNamespace,
  name: string,
  fn: (repo: ArtifactsRepoHandle) => Promise<T>,
): Promise<T> {
  const repo = await ns.get(name);
  try {
    return await fn(repo);
  } finally {
    releaseHandle(repo);
  }
}

/** Fetch repo metadata, creating the per-user repo on first use. */
export async function ensureUserRepo(
  ns: ArtifactsNamespace,
  userId: string,
): Promise<ArtifactsRepoInfo> {
  const name = userRepoName(userId);
  try {
    return await withRepo(ns, name, (repo) => repo.info());
  } catch {
    /* missing → create below */
  }
  try {
    const created = await ns.create(name, {
      description: 'AXIS Pine script library (per-API-key git repo)',
      setDefaultBranch: 'main',
    });
    return created;
  } catch {
    // Lost a create race (or transient): the repo should exist now.
    return withRepo(ns, name, (repo) => repo.info());
  }
}

/** Read-only metadata lookup — null when the user has no repo yet. */
export async function getUserRepo(
  ns: ArtifactsNamespace,
  userId: string,
): Promise<ArtifactsRepoInfo | null> {
  try {
    return await withRepo(ns, userRepoName(userId), (repo) => repo.info());
  } catch {
    return null;
  }
}

// --- Clone credentials (the no-GitHub-creds path) -------------------------

export interface CloneCredential {
  remote: string;
  repo: string;
  scope: 'read' | 'write';
  /** Token as `art_v1_<secret>?expires=<ts>` (extraHeader) or bare secret (URL). */
  token: string;
  secret: string;
  expiresAt: number;
}

export function clampCloneTtl(ttl: unknown): number {
  const n = Number(ttl);
  if (!Number.isFinite(n)) return CLONE_TOKEN_DEFAULT_TTL;
  return Math.min(CLONE_TOKEN_MAX_TTL, Math.max(CLONE_TOKEN_MIN_TTL, Math.floor(n)));
}

export async function mintCloneToken(
  ns: ArtifactsNamespace,
  userId: string,
  scope: 'read' | 'write' = 'read',
  ttl: number = CLONE_TOKEN_DEFAULT_TTL,
): Promise<CloneCredential> {
  const repo = await ensureUserRepo(ns, userId);
  const res = await withRepo(ns, repo.name, (r) => r.createToken(scope, ttl));
  if (typeof res === 'string') {
    const { secret, expiresAtMs } = splitTokenSecret(res);
    return {
      remote: repo.remote,
      repo: repo.name,
      scope,
      token: res,
      secret,
      expiresAt: expiresAtMs ?? Date.now() + ttl * 1000,
    };
  }
  return {
    remote: repo.remote,
    repo: repo.name,
    scope,
    token: res.plaintext,
    secret: splitTokenSecret(res.plaintext).secret,
    expiresAt: epochToMs(res.expiresAt),
  };
}

// --- Version history from git log ------------------------------------------

export interface GitScriptVersion {
  sha: string;
  revision: string;
  shortSha: string;
  message: string;
  committedAt: number;
  name: string;
}

/**
 * Newest-first history for one script, derived from `repo.log()` filtered
 * by commit marker. Same projection as the D1 `versions` endpoint so the
 * caller can swap backends transparently. Delete markers are excluded —
 * they carry no restorable content.
 */
export async function listScriptHistory(
  ns: ArtifactsNamespace,
  userId: string,
  scriptId: string,
  limit = 50,
): Promise<GitScriptVersion[]> {
  const repo = await getUserRepo(ns, userId);
  if (!repo) return [];
  const commits = await withRepo(ns, repo.name, (r) =>
    r.log({ ref: repo.defaultBranch || 'main', limit: Math.min(500, limit * 3 + 20) }),
  );
  const want = safeScriptId(scriptId);
  const out: GitScriptVersion[] = [];
  for (const c of commits) {
    const marker = parseScriptMarker(String(c.message || ''));
    if (!marker || marker.id !== want || marker.deleted) continue;
    const sha = String(c.oid || c.hash || '');
    if (!sha) continue;
    const name = displayMessage(String(c.message || ''), want).replace(/^Save\s+/, '') || want;
    out.push({
      sha,
      revision: sha,
      shortSha: sha.slice(0, 7),
      message: displayMessage(String(c.message || ''), want),
      committedAt: epochToMs(Number(c.timestamp ?? c.committedAt ?? 0)),
      name,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export interface ScriptAtCommit {
  content: string;
  name: string;
  description?: string;
  path?: string;
  revision: string;
}

/** Full script source + meta at a historical commit (null when absent). */
export async function readScriptAtCommit(
  ns: ArtifactsNamespace,
  userId: string,
  scriptId: string,
  sha: string,
): Promise<ScriptAtCommit | null> {
  const repo = await getUserRepo(ns, userId);
  if (!repo) return null;
  const want = safeScriptId(scriptId);
  const [file, meta] = await withRepo(ns, repo.name, async (r) => {
    const f = await r.readFile({ ref: sha, path: scriptFilePath(want) }).catch(() => null);
    const m = await r.readFile({ ref: sha, path: scriptMetaPath(want) }).catch(() => null);
    return [f, m] as const;
  });
  if (!file) return null;
  const out: ScriptAtCommit = {
    content: await file.text(),
    name: want,
    revision: sha,
  };
  if (meta) {
    try {
      const parsed = JSON.parse(await meta.text()) as {
        name?: string;
        description?: string;
        path?: string;
      };
      if (parsed.name) out.name = String(parsed.name);
      if (parsed.description) out.description = String(parsed.description);
      if (parsed.path) out.path = String(parsed.path);
    } catch {
      /* sidecar is advisory — source already loaded */
    }
  }
  return out;
}

// --- Mirroring writes as git commits ----------------------------------------

export interface ScriptSnapshot {
  id: string;
  name: string;
  description?: string | null | undefined;
  path?: string | null | undefined;
  content: string;
}

export interface TreePushInput {
  remote: string;
  tokenSecret: string;
  branch: string;
  /** repo-relative path → content; `null` removes the file. */
  files: Record<string, string | null>;
  message: string;
  author: { name: string; email: string };
}

export interface GitTreePusher {
  pushTree(input: TreePushInput): Promise<{ sha: string }>;
}

type AuthCb = () => { username: string; password: string } | void;

/** Production pusher: fresh clone into MemoryFS, apply tree, commit, push. */
async function isomorphicPushTree(input: TreePushInput): Promise<{ sha: string }> {
  const attempt = async (): Promise<string> => {
    const fs = new MemoryFS();
    const dir = '/repo';
    const onAuth: AuthCb = () => ({ username: 'x', password: input.tokenSecret });
    try {
      await git.clone({
        fs,
        http,
        dir,
        url: input.remote,
        ref: input.branch,
        singleBranch: true,
        onAuth,
      });
    } catch {
      // Empty / brand-new repo — start from scratch on the default branch.
      await git.init({ fs, dir, defaultBranch: input.branch });
    }
    for (const [filepath, content] of Object.entries(input.files)) {
      if (content === null) {
        try {
          await git.remove({ fs, dir, filepath });
        } catch {
          /* already absent */
        }
        continue;
      }
      await fs.promises.writeFile(`${dir}/${filepath}`, content);
      await git.add({ fs, dir, filepath });
    }
    const sha = await git.commit({ fs, dir, message: input.message, author: input.author });
    await git.push({ fs, http, dir, remote: 'origin', ref: input.branch, onAuth });
    return sha;
  };
  try {
    return { sha: await attempt() };
  } catch {
    // Lost a push race (non-fast-forward) or transient: re-clone once.
    return { sha: await attempt() };
  }
}

let treePusher: GitTreePusher = { pushTree: isomorphicPushTree };

/** Test seam — swap the network pusher for a fake (restored with `null`). */
export function _setGitTreePusher(pusher: GitTreePusher | null): void {
  treePusher = pusher ?? { pushTree: isomorphicPushTree };
}

/**
 * Mirror one script save (or delete / restore) as a git commit.
 *
 * Saves are deduped first: when both files already match HEAD, the
 * expensive clone+push is skipped and the existing SHA is returned — this
 * keeps repeated identical saves (and retries) from spamming history.
 * Resolves with the commit SHA; throws on failure — callers treat this as
 * best-effort and never fail the user-visible save.
 */
export async function commitScriptSave(
  ns: ArtifactsNamespace,
  userId: string,
  snap: ScriptSnapshot,
  opts?: { delete?: boolean; restoreFrom?: string },
): Promise<{ sha: string; remote: string; deduped: boolean }> {
  const repo = await ensureUserRepo(ns, userId);
  const branch = repo.defaultBranch || 'main';
  const want = safeScriptId(snap.id);
  const message = opts?.delete
    ? deleteCommitMessage(snap.name, want)
    : opts?.restoreFrom
      ? restoreCommitMessage(snap.name, want, opts.restoreFrom)
      : saveCommitMessage(snap.name, want);
  const metaJson = JSON.stringify(
    {
      name: snap.name,
      ...(snap.description ? { description: snap.description } : {}),
      ...(snap.path ? { path: snap.path } : {}),
    },
    null,
    2,
  );
  const files: Record<string, string | null> = opts?.delete
    ? { [scriptFilePath(want)]: null, [scriptMetaPath(want)]: null }
    : { [scriptFilePath(want)]: snap.content, [scriptMetaPath(want)]: metaJson };

  // Cheap HEAD compare (two binding reads) before the clone+push.
  const head = await withRepo(ns, repo.name, async (r) => {
    const recent = await r.log({ ref: branch, limit: 1 }).catch(() => []);
    const tip = recent[0];
    const tipSha = tip ? String(tip.oid || tip.hash || '') : '';
    if (!tipSha) return null;
    const current: Record<string, string | null> = {};
    for (const path of Object.keys(files)) {
      const blob = await r.readFile({ ref: tipSha, path }).catch(() => null);
      current[path] = blob ? await blob.text() : null;
    }
    return { sha: tipSha, current };
  }).catch(() => null);
  if (head && Object.keys(files).every((path) => head.current[path] === files[path])) {
    return { sha: head.sha, remote: repo.remote, deduped: true };
  }

  const credential = await withRepo(ns, repo.name, (r) => r.createToken('write', 600));
  const initial =
    typeof credential === 'string'
      ? credential
      : String(credential.plaintext || '');
  const { secret } = splitTokenSecret(initial);
  const { sha } = await treePusher.pushTree({
    remote: repo.remote,
    tokenSecret: secret,
    branch,
    files,
    message,
    author: { ...MIRROR_AUTHOR },
  });
  return { sha, remote: repo.remote, deduped: false };
}
