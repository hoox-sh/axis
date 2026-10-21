// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/scripts` — multi-tenant user Pine script library.
 *
 * ## Auth
 * Every route requires {@link requireApiKey}. Rows are partitioned by
 * `userId` (hashed key); clients never pass a user id.
 *
 * ## Storage
 * - **D1** (`env.DB`) when bound — schema in `schemas/scripts.sql`.
 * - **In-memory** Maps when unbound — per-isolate only (wrangler dev / tests).
 *   Reset via {@link _clearMemScripts} in unit tests.
 * - **Artifacts git mirror** (`env.SCRIPT_ARTIFACTS`) when bound — every
 *   save/delete commits `scripts/<id>.pine` + sidecar meta to the user's
 *   per-key repo (best-effort via `ctx.waitUntil`, never fails the save).
 *   History endpoints prefer git log; `GET /_git` + `POST /_git/token`
 *   hand out clone remotes and short-lived repo tokens — full git support
 *   with no GitHub credentials. See `artifacts-git.ts`.
 *
 * ## Routes (after `/api/scripts`)
 * | Method | Path        | Behavior |
 * |--------|-------------|----------|
 * | GET    | `/`         | List meta (no content), newest first |
 * | POST   | `/`         | Create; optional client `id`, else `s_<base36>` |
 * | GET    | `/:id`      | Full script + content |
 * | PUT    | `/:id`      | Upsert; optional `If-Match` / body `revision` → 409 `CONFLICT` |
 * | DELETE | `/:id`      | Remove; 404 if missing |
 * | GET    | `/_draft`   | Autosave draft or `null` |
 * | PUT    | `/_draft`   | Upsert draft content/name |
 * | GET    | `/:id/versions` | Version history (newest first, no content) |
 * | GET    | `/:id/versions/:rev` | Full script at a historical revision |
 * | POST   | `/:id/restore` | Resurrect a version as the new tip (recreates deleted scripts) |
 * | GET    | `/_git`     | Artifacts repo remote for `git clone` (503 when unbound) |
 * | POST   | `/_git/token` | Short-lived clone token (`read`/`write`, 503 when unbound) |
 *
 * Revisions are opaque (`rev_<time>_<rand>`). Optimistic concurrency uses
 * `If-Match` header or `revision` field; mismatch returns remote revision.
 * Every successful PUT snapshots the new tip into `script_versions` (FIFO 50).
 */

import type { Env } from './index';
import { requireApiKey } from './auth';
import { SCRIPTS_CORS, errorBody, readCappedJson, scopedJson, type JsonBuilder } from './http';
import {
  clampCloneTtl,
  commitScriptSave,
  ensureUserRepo,
  listScriptHistory,
  mintCloneToken,
  readScriptAtCommit,
} from './artifacts-git';

/** Fail closed before JSON.parse on script/draft writes (A9). */
const SCRIPTS_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Default / max page size for the collection list (A20 — list is bounded). */
const LIST_DEFAULT_LIMIT = 100;
const LIST_MAX_LIMIT = 500;

/** Full D1 / memory row including Pine source text. */
export interface ScriptRow {
  id: string;
  name: string;
  description?: string | null;
  path?: string | null;
  content: string;
  revision: string;
  created_at: number;
  updated_at: number;
}

/** List/meta projection without `content` (camelCase timestamps for clients). */
export interface ScriptMeta {
  id: string;
  name: string;
  description?: string;
  path?: string;
  revision: string;
  createdAt: number;
  updatedAt: number;
}

// --- In-memory fallback (per isolate; fine for local dev / unit tests) ---
/** Version snapshot stored alongside the live script row. */
export interface ScriptVersionRow {
  id: string;
  revision: string;
  name: string;
  description?: string | null;
  path?: string | null;
  content: string;
  created_at: number;
  message?: string;
}

/** FIFO cap on version snapshots per script (per user). */
const MAX_VERSIONS_PER_SCRIPT = 50;

/** userId → (scriptId → row) */
const memScripts = new Map<string, Map<string, ScriptRow>>();
/** userId → single autosave draft */
const memDrafts = new Map<string, { content: string; name?: string; updated_at: number }>();
/** userId → (scriptId → versions, newest last) */
const memVersions = new Map<string, Map<string, ScriptVersionRow[]>>();

function memUser(userId: string): Map<string, ScriptRow> {
  let m = memScripts.get(userId);
  if (!m) {
    m = new Map();
    memScripts.set(userId, m);
  }
  return m;
}

function memUserVersions(userId: string): Map<string, ScriptVersionRow[]> {
  let m = memVersions.get(userId);
  if (!m) {
    m = new Map();
    memVersions.set(userId, m);
  }
  return m;
}

function rowToVersion(row: ScriptRow, message?: string): ScriptVersionRow {
  const v: ScriptVersionRow = {
    id: row.id,
    revision: row.revision,
    name: row.name,
    content: row.content,
    created_at: row.updated_at,
  };
  if (row.description != null) v.description = row.description;
  if (row.path != null) v.path = row.path;
  if (message) v.message = message;
  else v.message = `Save ${row.name}`;
  return v;
}

function versionMeta(v: ScriptVersionRow) {
  const sha = v.revision;
  return {
    sha,
    revision: sha,
    shortSha: sha.slice(0, 7),
    message: v.message || `Save ${v.name}`,
    committedAt: v.created_at,
    name: v.name,
  };
}

function archiveMemVersion(userId: string, row: ScriptRow): void {
  const buckets = memUserVersions(userId);
  let list = buckets.get(row.id) || [];
  list = list.filter((x) => x.revision !== row.revision);
  list.push(rowToVersion(row));
  if (list.length > MAX_VERSIONS_PER_SCRIPT) {
    list = list.slice(list.length - MAX_VERSIONS_PER_SCRIPT);
  }
  buckets.set(row.id, list);
}

async function putVersionD1(db: D1Database, userId: string, row: ScriptRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO script_versions (user_id, id, revision, name, description, path, content, created_at, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id, revision) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         path = excluded.path,
         content = excluded.content,
         created_at = excluded.created_at,
         message = excluded.message`,
    )
    .bind(
      userId,
      row.id,
      row.revision,
      row.name,
      row.description ?? null,
      row.path ?? null,
      row.content,
      row.updated_at,
      `Save ${row.name}`,
    )
    .run();
}

async function trimVersionsD1(db: D1Database, userId: string, id: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM script_versions
       WHERE user_id = ? AND id = ?
         AND revision NOT IN (
           SELECT revision FROM script_versions
           WHERE user_id = ? AND id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )`,
    )
    .bind(userId, id, userId, id, MAX_VERSIONS_PER_SCRIPT)
    .run();
}

async function listVersionsD1(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ScriptVersionRow[]> {
  const res = await db
    .prepare(
      `SELECT id, revision, name, description, path, content, created_at, message
       FROM script_versions WHERE user_id = ? AND id = ?
       ORDER BY created_at DESC`,
    )
    .bind(userId, id)
    .all<ScriptVersionRow>();
  return res.results || [];
}

async function getVersionD1(
  db: D1Database,
  userId: string,
  id: string,
  rev: string,
): Promise<ScriptVersionRow | null> {
  return db
    .prepare(
      `SELECT id, revision, name, description, path, content, created_at, message
       FROM script_versions WHERE user_id = ? AND id = ? AND revision = ?`,
    )
    .bind(userId, id, rev)
    .first<ScriptVersionRow>();
}

async function archiveVersion(db: D1Database | undefined, userId: string, row: ScriptRow): Promise<void> {
  if (db) {
    try {
      await putVersionD1(db, userId, row);
      await trimVersionsD1(db, userId, row.id);
    } catch (err) {
      // Live write already succeeded — never fail the save, but never
      // swallow the archive failure silently either (A20).
      console.warn(JSON.stringify({
        type: 'script_version_archive_failed',
        id: row.id,
        revision: row.revision,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  } else {
    archiveMemVersion(userId, row);
  }
}

function rowToMeta(r: ScriptRow): ScriptMeta {
  const meta: ScriptMeta = {
    id: r.id,
    name: r.name,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.description) meta.description = r.description;
  if (r.path) meta.path = r.path;
  return meta;
}

function newRevision(): string {
  return `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function listD1(db: D1Database, userId: string, limit: number): Promise<ScriptMeta[]> {
  const res = await db
    .prepare(
      `SELECT id, name, description, path, revision, created_at, updated_at
       FROM scripts WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<Omit<ScriptRow, 'content'>>();
  return (res.results || []).map((r) => {
    const meta: ScriptMeta = {
      id: r.id,
      name: r.name,
      revision: r.revision,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
    if (r.description) meta.description = r.description;
    if (r.path) meta.path = r.path;
    return meta;
  });
}

async function getD1(db: D1Database, userId: string, id: string): Promise<ScriptRow | null> {
  return db
    .prepare(
      `SELECT id, name, description, path, content, revision, created_at, updated_at
       FROM scripts WHERE user_id = ? AND id = ?`,
    )
    .bind(userId, id)
    .first<ScriptRow>();
}

async function putD1(db: D1Database, userId: string, row: ScriptRow): Promise<void> {  await db
    .prepare(
      `INSERT INTO scripts (user_id, id, name, description, path, content, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         path = excluded.path,
         content = excluded.content,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      row.id,
      row.name,
      row.description ?? null,
      row.path ?? null,
      row.content,
      row.revision,
      row.created_at,
      row.updated_at,
    )
    .run();
}

async function delD1(db: D1Database, userId: string, id: string): Promise<boolean> {
  const r = await db
    .prepare(`DELETE FROM scripts WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** JSON response with CORS headers required by the PWA (includes If-Match for revisions). */
const corsJson: JsonBuilder = scopedJson(SCRIPTS_CORS);

/** 413 envelope shared by the capped body reads below. */
function tooLarge(origin: string): Response {
  return corsJson(
    errorBody('PAYLOAD_TOO_LARGE', 'script body too large'),
    413,
    origin,
  );
}

/** Bounded `?limit=` for the collection list (default 100, hard cap 500). */
function parseListLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null || raw === '') return LIST_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return LIST_DEFAULT_LIMIT;
  return Math.min(LIST_MAX_LIMIT, Math.floor(n));
}

/**
 * Mirror a save/delete as a git commit on the user's Artifacts repo.
 * Best-effort: failures are logged, never surfaced — the D1/memory tip is
 * the source of truth for the API response. Runs via `ctx.waitUntil` when
 * available so saves stay fast; awaited inline otherwise (tests, ctx-less).
 */
function mirrorGit(
  env: Env,
  ctx: ExecutionContext | undefined,
  userId: string,
  row: ScriptRow,
  opts?: { delete?: boolean; restoreFrom?: string },
): Promise<void> | void {
  const ns = env.SCRIPT_ARTIFACTS;
  if (!ns) return;
  const task = commitScriptSave(
    ns,
    userId,
    {
      id: row.id,
      name: row.name,
      description: row.description,
      path: row.path,
      content: row.content,
    },
    opts,
  ).then(
    () => undefined,
    (err: unknown) => {
      console.warn(
        JSON.stringify({
          type: 'script_git_mirror_failed',
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    },
  );
  if (ctx?.waitUntil) {
    ctx.waitUntil(task);
    return;
  }
  return task;
}

function gitWarn(id: string, err: unknown): void {
  console.warn(
    JSON.stringify({
      type: 'script_git_read_failed',
      id,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/**
 * Dispatch `/api/scripts` and subpaths. `path` is the URL pathname (not full URL).
 * Missing D1 schema surfaces as 503 `NO_SCHEMA` with a wrangler hint.
 */
export async function handleScripts(
  req: Request,
  env: Env,
  origin: string,
  path: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const auth = await requireApiKey(req, env);
  if (!auth.ok) {
    return corsJson(errorBody(auth.code, auth.message), auth.status, origin);
  }
  const { userId } = auth.ctx;
  const db = env.DB;
  const url = new URL(req.url);

  // Path segments after /api/scripts: [], ['_draft'], or [':id']
  const rest = path.replace(/^\/api\/scripts\/?/, '');
  const parts = rest ? rest.split('/').filter(Boolean) : [];

  // --- Autosave draft (one per user) ---
  if (parts[0] === '_draft') {
    if (req.method === 'GET') {
      if (db) {
        const row = await db
          .prepare(`SELECT content, name, updated_at FROM script_drafts WHERE user_id = ?`)
          .bind(userId)
          .first<{ content: string; name: string | null; updated_at: number }>();
        if (!row) return corsJson({ status: 'success', draft: null }, 200, origin);
        return corsJson(
          { status: 'success', draft: { content: row.content, name: row.name || undefined } },
          200,
          origin,
        );
      }
      const d = memDrafts.get(userId);
      return corsJson(
        { status: 'success', draft: d ? { content: d.content, name: d.name } : null },
        200,
        origin,
      );
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const capped = await readCappedJson(req, SCRIPTS_MAX_BODY_BYTES);
      if (!capped.ok) return tooLarge(origin);
      const parsed = (capped.value ?? {}) as { content?: string; name?: string };
      const content = String(parsed.content ?? '');
      const name = parsed.name ? String(parsed.name) : undefined;
      const now = Date.now();
      if (db) {
        await db
          .prepare(
            `INSERT INTO script_drafts (user_id, content, name, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET content = excluded.content, name = excluded.name, updated_at = excluded.updated_at`,
          )
          .bind(userId, content, name ?? null, now)
          .run();
      } else {
        const draft: { content: string; name?: string; updated_at: number } = {
          content,
          updated_at: now,
        };
        if (name) draft.name = name;
        memDrafts.set(userId, draft);
      }
      return corsJson({ status: 'success' }, 200, origin);
    }
    return corsJson(errorBody('METHOD', 'GET or PUT required'), 405, origin);
  }

  // --- Git-native history + clone credentials (Artifacts, no GitHub creds) ---
  // `GET /_git` → repo remote for `git clone`; `POST /_git/token` → short-lived
  // repo-scoped token (read for clone/pull, write for push). Callers keep
  // using their AXIS API key — no GitHub OAuth involved.
  if (parts[0] === '_git') {
    const ns = env.SCRIPT_ARTIFACTS;
    if (!ns) {
      return corsJson(
        errorBody('GIT_BACKEND_UNAVAILABLE', 'Artifacts script repos not bound. Add [[artifacts]] SCRIPT_ARTIFACTS in wrangler.toml.'),
        503,
        origin,
      );
    }
    if (parts.length === 1 && req.method === 'GET') {
      const repo = await ensureUserRepo(ns, userId);
      return corsJson(
        {
          status: 'success',
          git: { repo: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch || 'main' },
        },
        200,
        origin,
      );
    }
    if (parts.length === 2 && parts[1] === 'token' && req.method === 'POST') {
      const capped = await readCappedJson(req, SCRIPTS_MAX_BODY_BYTES);
      if (!capped.ok) return tooLarge(origin);
      const parsed = (capped.value ?? {}) as { scope?: string; ttl?: number };
      const scope = parsed.scope === 'write' ? 'write' : 'read';
      const cred = await mintCloneToken(ns, userId, scope, clampCloneTtl(parsed.ttl));
      return corsJson(
        {
          status: 'success',
          git: {
            repo: cred.repo,
            remote: cred.remote,
            scope: cred.scope,
            token: cred.token,
            expiresAt: cred.expiresAt,
          },
        },
        200,
        origin,
      );
    }
    return corsJson(
      errorBody('METHOD', 'GET /api/scripts/_git or POST /api/scripts/_git/token required'),
      405,
      origin,
    );
  }

  // --- Collection: list / create ---
  if (parts.length === 0) {
    if (req.method === 'GET') {
      if (db) {
        try {
          const items = await listD1(db, userId, parseListLimit(url));
          return corsJson({ status: 'success', scripts: items }, 200, origin);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/no such table/i.test(msg)) {
            return corsJson(
              errorBody('NO_SCHEMA', 'D1 scripts table missing. Run schemas/scripts.sql'),
              503,
              origin,
            );
          }
          throw e;
        }
      }
      const items = [...memUser(userId).values()]
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, parseListLimit(url))
        .map(rowToMeta);
      return corsJson({ status: 'success', scripts: items, backend: 'memory' }, 200, origin);
    }
    if (req.method === 'POST') {
      // Create with server-generated id optional
      const capped = await readCappedJson(req, SCRIPTS_MAX_BODY_BYTES);
      if (!capped.ok) return tooLarge(origin);
      const body = (capped.value ?? {}) as Partial<ScriptRow> & { script?: string };
      const now = Date.now();
      const id = String(body.id || `s_${now.toString(36)}`);
      const row: ScriptRow = {
        id,
        name: String(body.name || 'Untitled'),
        description: body.description ?? null,
        path: body.path ?? null,
        content: String(body.content ?? body.script ?? ''),
        revision: newRevision(),
        created_at: now,
        updated_at: now,
      };
      if (db) await putD1(db, userId, row);
      else memUser(userId).set(id, row);
      await archiveVersion(db, userId, row);
      await mirrorGit(env, ctx, userId, row);
      return corsJson({ status: 'success', script: { ...rowToMeta(row), content: row.content } }, 201, origin);
    }
    return corsJson(errorBody('METHOD', 'GET or POST required'), 405, origin);
  }

  // --- Item /api/scripts/:id ---
  // Reached after the parts.length === 0 and parts[0] === '_draft' guards above.
  const id = decodeURIComponent(parts[0]!);

  // --- Restore: POST /api/scripts/:id/restore {revision} ---
  // Resurrects any restorable version as the new tip — including versions of
  // deleted scripts (recreates them). Resolves git-first, then D1/memory.
  if (parts[1] === 'restore') {
    if (req.method !== 'POST') {
      return corsJson(errorBody('METHOD', 'POST required'), 405, origin);
    }
    const capped = await readCappedJson(req, SCRIPTS_MAX_BODY_BYTES);
    if (!capped.ok) return tooLarge(origin);
    const rev = String(((capped.value ?? {}) as { revision?: string }).revision || '');
    if (!rev) {
      return corsJson(
        errorBody('VALIDATION', 'revision required'),
        400,
        origin,
      );
    }
    let found: {
      content: string;
      name: string;
      description?: string | null | undefined;
      path?: string | null | undefined;
    } | null = null;
    if (env.SCRIPT_ARTIFACTS) {
      try {
        found = await readScriptAtCommit(env.SCRIPT_ARTIFACTS, userId, id, rev);
      } catch (err) {
        gitWarn(id, err);
      }
    }
    if (!found && db) {
      try {
        const v = await getVersionD1(db, userId, id, rev);
        if (v) {
          found = {
            content: v.content,
            name: v.name,
            description: v.description || undefined,
            path: v.path || undefined,
          };
        }
      } catch {
        found = null;
      }
    }
    if (!found) {
      found = (memUserVersions(userId).get(id) || []).find((v) => v.revision === rev) || null;
    }
    if (!found) {
      return corsJson(
        errorBody('NOT_FOUND', `version ${rev} not found for ${id}`),
        404,
        origin,
      );
    }
    const now = Date.now();
    let prev: ScriptRow | null = null;
    if (db) prev = await getD1(db, userId, id);
    else prev = memUser(userId).get(id) || null;
    const row: ScriptRow = {
      id,
      name: String(found.name || prev?.name || 'Untitled'),
      description: found.description ?? prev?.description ?? null,
      path: found.path ?? prev?.path ?? null,
      content: found.content,
      revision: newRevision(),
      created_at: prev?.created_at || now,
      updated_at: now,
    };
    if (db) await putD1(db, userId, row);
    else memUser(userId).set(id, row);
    await archiveVersion(db, userId, row);
    await mirrorGit(env, ctx, userId, row, { restoreFrom: rev });
    return corsJson(
      {
        status: 'success',
        script: { ...rowToMeta(row), content: row.content },
        restoredFrom: rev,
      },
      prev ? 200 : 201,
      origin,
    );
  }

  // --- Versions: /api/scripts/:id/versions[/:rev] ---
  if (parts[1] === 'versions') {
    if (req.method !== 'GET') {
      return corsJson(errorBody('METHOD', 'GET required'), 405, origin);
    }
    const rev = parts[2] ? decodeURIComponent(parts[2]) : '';
    if (rev) {
      if (env.SCRIPT_ARTIFACTS) {
        try {
          const at = await readScriptAtCommit(env.SCRIPT_ARTIFACTS, userId, id, rev);
          if (at) {
            const hist = await listScriptHistory(env.SCRIPT_ARTIFACTS, userId, id, 50).catch(
              () => [],
            );
            const ts = hist.find((v) => v.sha === rev)?.committedAt ?? Date.now();
            return corsJson(
              {
                status: 'success',
                script: {
                  id,
                  name: at.name,
                  description: at.description,
                  path: at.path,
                  revision: at.revision,
                  createdAt: ts,
                  updatedAt: ts,
                  content: at.content,
                },
                backend: 'artifacts-git',
              },
              200,
              origin,
            );
          }
        } catch (err) {
          gitWarn(id, err);
        }
      }
      let row: ScriptVersionRow | null = null;
      if (db) {
        try {
          row = await getVersionD1(db, userId, id, rev);
        } catch {
          row = null;
        }
      } else {
        row = (memUserVersions(userId).get(id) || []).find((v) => v.revision === rev) || null;
      }
      if (!row) {
        return corsJson(
          errorBody('NOT_FOUND', `version ${rev} not found for ${id}`),
          404,
          origin,
        );
      }
      return corsJson(
        {
          status: 'success',
          script: {
            id: row.id,
            name: row.name,
            description: row.description || undefined,
            path: row.path || undefined,
            revision: row.revision,
            createdAt: row.created_at,
            updatedAt: row.created_at,
            content: row.content,
          },
        },
        200,
        origin,
      );
    }
    let rows: ScriptVersionRow[] = [];
    if (env.SCRIPT_ARTIFACTS) {
      try {
        const hist = await listScriptHistory(env.SCRIPT_ARTIFACTS, userId, id, 50);
        if (hist.length > 0) {
          return corsJson(
            { status: 'success', versions: hist, backend: 'artifacts-git' },
            200,
            origin,
          );
        }
      } catch (err) {
        gitWarn(id, err);
      }
    }
    if (db) {
      try {
        rows = await listVersionsD1(db, userId, id);
      } catch {
        rows = [];
      }
    } else {
      // Newest last in the archive buffer — reverse for newest-first listing.
      // Insertion order is the tie-breaker when two saves share a timestamp.
      rows = [...(memUserVersions(userId).get(id) || [])].reverse();
    }
    return corsJson(
      { status: 'success', versions: rows.map(versionMeta) },
      200,
      origin,
    );
  }

  if (req.method === 'GET') {
    let row: ScriptRow | null = null;
    if (db) row = await getD1(db, userId, id);
    else row = memUser(userId).get(id) || null;
    if (!row) {
      return corsJson(errorBody('NOT_FOUND', `script ${id} not found`), 404, origin);
    }
    return corsJson(
      {
        status: 'success',
        script: {
          ...rowToMeta(row),
          content: row.content,
        },
      },
      200,
      origin,
    );
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const capped = await readCappedJson(req, SCRIPTS_MAX_BODY_BYTES);
    if (!capped.ok) return tooLarge(origin);
    const body = (capped.value ?? {}) as Partial<ScriptRow> & {
      script?: string;
      revision?: string;
    };
    const ifMatch = req.headers.get('If-Match') || body.revision;
    const now = Date.now();

    // D1 path uses a single conditional UPDATE (compare-and-swap) so two
    // concurrent PUTs cannot both win silently (A12). The memory fallback is
    // isolate-local with no await between check and write — already atomic.
    if (db && ifMatch) {
      const next: ScriptRow = {
        id,
        name: '',
        description: body.description !== undefined ? body.description : null,
        path: body.path !== undefined ? body.path : null,
        content: '',
        revision: newRevision(),
        created_at: now,
        updated_at: now,
      };
      const current = await getD1(db, userId, id);
      if (!current) {
        return corsJson(errorBody('NOT_FOUND', `script ${id} not found`), 404, origin);
      }
      next.name = String(body.name || current.name || 'Untitled');
      if (body.description === undefined) next.description = current.description ?? null;
      if (body.path === undefined) next.path = current.path ?? null;
      next.content = String(body.content ?? body.script ?? current.content ?? '');
      next.created_at = current.created_at || now;
      const r = await db
        .prepare(
          `UPDATE scripts SET name = ?, description = ?, path = ?, content = ?,
            revision = ?, updated_at = ?
           WHERE user_id = ? AND id = ? AND revision = ?`,
        )
        .bind(
          next.name,
          next.description,
          next.path,
          next.content,
          next.revision,
          next.updated_at,
          userId,
          id,
          ifMatch,
        )
        .run();
      if ((r.meta?.changes ?? 0) === 0) {
        const remote = await getD1(db, userId, id);
        return corsJson(
          { ...errorBody('CONFLICT', 'revision mismatch'), remoteRevision: remote?.revision },
          409,
          origin,
        );
      }
      await archiveVersion(db, userId, next);
      await mirrorGit(env, ctx, userId, next);
      return corsJson(
        { status: 'success', script: { ...rowToMeta(next), content: next.content } },
        200,
        origin,
      );
    }

    let prev: ScriptRow | null = null;
    if (db) prev = await getD1(db, userId, id);
    else prev = memUser(userId).get(id) || null;

    if (ifMatch && prev && prev.revision !== ifMatch) {
      return corsJson(
        { ...errorBody('CONFLICT', 'revision mismatch'), remoteRevision: prev.revision },
        409,
        origin,
      );
    }

    const row: ScriptRow = {
      id,
      name: String(body.name || prev?.name || 'Untitled'),
      description: body.description !== undefined ? body.description : prev?.description ?? null,
      path: body.path !== undefined ? body.path : prev?.path ?? null,
      content: String(body.content ?? body.script ?? prev?.content ?? ''),
      revision: newRevision(),
      created_at: prev?.created_at || now,
      updated_at: now,
    };
    if (db) await putD1(db, userId, row);
    else memUser(userId).set(id, row);
    await archiveVersion(db, userId, row);
    await mirrorGit(env, ctx, userId, row);
    return corsJson(
      { status: 'success', script: { ...rowToMeta(row), content: row.content } },
      prev ? 200 : 201,
      origin,
    );
  }

  if (req.method === 'DELETE') {
    let deleted = false;
    let prev: ScriptRow | null = null;
    if (db) {
      prev = await getD1(db, userId, id);
      deleted = await delD1(db, userId, id);
    } else {
      prev = memUser(userId).get(id) || null;
      deleted = memUser(userId).delete(id);
    }
    if (!deleted) {
      return corsJson(errorBody('NOT_FOUND', `script ${id} not found`), 404, origin);
    }
    if (prev) await mirrorGit(env, ctx, userId, prev, { delete: true });
    return corsJson({ status: 'success' }, 200, origin);
  }

  return corsJson(errorBody('METHOD', 'unsupported method'), 405, origin);
}

/** Test-only: wipe isolate memory backends between cases. */
export function _clearMemScripts() {
  memScripts.clear();
  memDrafts.clear();
  memVersions.clear();
}
