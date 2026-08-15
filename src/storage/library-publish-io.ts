// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persist / resolve published Pine libraries (local cache + git).
 *
 * Git is the source of truth when a token + repo are configured. The local
 * cache always updates so Pyodide / offline runs can resolve imports.
 *
 * @module storage/library-publish-io
 */

import { resolveGitConfig, type GitConfig } from './git-config';
import * as gh from './git-github';
import * as gl from './git-gitlab';
import {
  PUBLISHED_CACHE_KEY,
  buildPublishedRecord,
  defaultPublishNamespace,
  emptyPublishedIndex,
  latestPublished,
  nextPublishedVersion,
  parseLibraryDeclaration,
  parseLibraryImports,
  publishedIndexPath,
  publishedLibPath,
  publishedManifestPath,
  toEngineLibrary,
  type LibraryImportSpec,
  type PublishedIndex,
  type PublishedLibrary,
} from './library-publish';

export interface PublishLibraryResult {
  library: PublishedLibrary;
  skipped: boolean;
  remote: boolean;
  importSnippet: string;
}

interface CacheBag {
  version: 1;
  index: PublishedIndex;
  sources: Record<string, string>;
}

function specKey(ns: string, name: string, ver: number): string {
  return `${ns}/${name}/${ver}`;
}

function readCache(): CacheBag {
  const empty: CacheBag = { version: 1, index: emptyPublishedIndex(), sources: {} };
  try {
    if (typeof localStorage === 'undefined') return empty;
    const raw = localStorage.getItem(PUBLISHED_CACHE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as CacheBag;
    if (!parsed || parsed.version !== 1 || !parsed.index) return empty;
    if (!Array.isArray(parsed.index.libraries)) parsed.index.libraries = [];
    if (!parsed.sources || typeof parsed.sources !== 'object') parsed.sources = {};
    return parsed;
  } catch {
    return empty;
  }
}

function writeCache(bag: CacheBag): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PUBLISHED_CACHE_KEY, JSON.stringify(bag));
  } catch {
    /* quota / private mode */
  }
}

function upsertCache(lib: PublishedLibrary): void {
  const bag = readCache();
  const key = specKey(lib.namespace, lib.name, lib.version);
  bag.sources[key] = lib.source;
  const rest = bag.index.libraries.filter(
    (e) => !(e.namespace === lib.namespace && e.name === lib.name && e.version === lib.version),
  );
  const { source: _src, ...meta } = lib;
  bag.index.libraries = [...rest, meta];
  writeCache(bag);
}

function gitReady(cfg: GitConfig): boolean {
  if (!cfg.token) return false;
  if (cfg.provider === 'github') return !!(cfg.owner && cfg.repo);
  return !!(cfg.projectId || (cfg.owner && cfg.repo));
}

async function gitGetFile(
  cfg: GitConfig,
  path: string,
): Promise<{ content: string } | null> {
  return cfg.provider === 'gitlab' ? gl.gitlabGetFile(cfg, path) : gh.githubGetFile(cfg, path);
}

async function gitPutFile(
  cfg: GitConfig,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  if (cfg.provider === 'gitlab') {
    const existing = await gl.gitlabGetFile(cfg, path);
    await gl.gitlabPutFile(cfg, path, content, message, !!existing);
    return;
  }
  const existing = await gh.githubGetFile(cfg, path);
  await gh.githubPutFile(cfg, path, content, message, existing?.sha);
}

async function readRemoteIndex(cfg: GitConfig): Promise<PublishedIndex> {
  const file = await gitGetFile(cfg, publishedIndexPath(cfg));
  if (!file) return emptyPublishedIndex();
  try {
    const parsed = JSON.parse(file.content) as PublishedIndex;
    if (!parsed || !Array.isArray(parsed.libraries)) return emptyPublishedIndex();
    return { version: 1, libraries: parsed.libraries };
  } catch {
    return emptyPublishedIndex();
  }
}

function mergeIndexes(a: PublishedIndex, b: PublishedIndex): PublishedIndex {
  const map = new Map<string, PublishedIndex['libraries'][number]>();
  for (const e of [...a.libraries, ...b.libraries]) {
    const k = specKey(e.namespace, e.name, e.version);
    const prev = map.get(k);
    if (!prev || (e.publishedAt || 0) >= (prev.publishedAt || 0)) map.set(k, e);
  }
  return { version: 1, libraries: [...map.values()] };
}

/**
 * Publish a `library()` script. Increments the version folder (1, 2, 3, …)
 * unless `origin === 'auto'` and the latest version has the same content.
 */
export async function publishLibrary(
  code: string,
  opts?: {
    namespace?: string;
    origin?: 'manual' | 'auto';
    config?: Record<string, unknown>;
  },
): Promise<PublishLibraryResult> {
  const decl = parseLibraryDeclaration(code);
  if (!decl) {
    throw new Error('Publish: script is not a Pine library() — use library("Name")');
  }
  const origin = opts?.origin === 'auto' ? 'auto' : 'manual';
  const cfg = resolveGitConfig(opts?.config);
  const namespace = opts?.namespace?.trim()
    ? opts.namespace.trim()
    : defaultPublishNamespace(cfg);

  const local = readCache();
  const remote = gitReady(cfg) ? await readRemoteIndex(cfg) : emptyPublishedIndex();
  const index = mergeIndexes(local.index, remote);

  const latest = latestPublished(index, namespace, decl.name);
  if (origin === 'auto' && latest) {
    const existing = await resolvePublishedLibrary(
      { namespace, name: decl.name, version: latest.version, alias: decl.name },
      { config: opts?.config },
    );
    const rec = buildPublishedRecord(code, {
      namespace,
      version: latest.version,
      origin,
    });
    if (existing && rec && existing.contentSha === rec.contentSha) {
      return {
        library: existing,
        skipped: true,
        remote: gitReady(cfg),
        importSnippet: `import ${existing.namespace}/${existing.name}/${existing.version} as ${existing.name}`,
      };
    }
  }

  const version = nextPublishedVersion(index, namespace, decl.name);
  const rec = buildPublishedRecord(code, {
    namespace,
    version,
    origin,
    path: publishedVersionDirSafe(cfg, namespace, decl.name, version),
  });
  if (!rec) throw new Error('Publish: could not parse library declaration');

  upsertCache(rec);

  if (gitReady(cfg)) {
    const msg = `feat(lib): publish ${namespace}/${decl.name}/${version}`;
    await gitPutFile(cfg, publishedLibPath(cfg, namespace, decl.name, version), code, msg);
    await gitPutFile(
      cfg,
      publishedManifestPath(cfg, namespace, decl.name, version),
      JSON.stringify(
        {
          namespace: rec.namespace,
          name: rec.name,
          version: rec.version,
          pineVersion: rec.pineVersion ?? null,
          publishedAt: rec.publishedAt,
          contentSha: rec.contentSha,
          origin: rec.origin,
        },
        null,
        2,
      ) + '\n',
      msg,
    );
    const nextIndex = mergeIndexes(await readRemoteIndex(cfg), {
      version: 1,
      libraries: [stripSource(rec)],
    });
    await gitPutFile(
      cfg,
      publishedIndexPath(cfg),
      JSON.stringify(nextIndex, null, 2) + '\n',
      `${msg} (index)`,
    );
  }

  return {
    library: rec,
    skipped: false,
    remote: gitReady(cfg),
    importSnippet: `import ${rec.namespace}/${rec.name}/${rec.version} as ${rec.name}`,
  };
}

function stripSource(lib: PublishedLibrary): Omit<PublishedLibrary, 'source'> {
  const { source: _s, ...meta } = lib;
  return meta;
}

function publishedVersionDirSafe(
  cfg: GitConfig,
  ns: string,
  name: string,
  version: number,
): string {
  return publishedLibPath(cfg, ns, name, version).replace(/\/lib\.pyne$/, '');
}

/** Look up one published version (cache, then git). */
export async function resolvePublishedLibrary(
  spec: LibraryImportSpec,
  opts?: { config?: Record<string, unknown> },
): Promise<PublishedLibrary | null> {
  const key = specKey(spec.namespace, spec.name, spec.version);
  const bag = readCache();
  const cachedSrc = bag.sources[key];
  const cachedMeta = bag.index.libraries.find(
    (e) => e.namespace === spec.namespace && e.name === spec.name && e.version === spec.version,
  );
  if (cachedSrc) {
    return {
      ...(cachedMeta || {
        namespace: spec.namespace,
        name: spec.name,
        version: spec.version,
        publishedAt: 0,
        contentSha: '',
        origin: 'manual' as const,
      }),
      source: cachedSrc,
    };
  }

  const cfg = resolveGitConfig(opts?.config);
  if (!gitReady(cfg)) return null;
  const file = await gitGetFile(cfg, publishedLibPath(cfg, spec.namespace, spec.name, spec.version));
  if (!file) return null;
  const rec = buildPublishedRecord(file.content, {
    namespace: spec.namespace,
    version: spec.version,
    origin: 'manual',
    path: publishedVersionDirSafe(cfg, spec.namespace, spec.name, spec.version),
  });
  if (rec) upsertCache(rec);
  return rec;
}

/** Resolve every `import` in `code` to engine-ready library payloads. */
export async function resolveLibrariesForScript(
  code: string,
  opts?: { config?: Record<string, unknown> },
): Promise<{
  libraries: ReturnType<typeof toEngineLibrary>[];
  missing: LibraryImportSpec[];
}> {
  const specs = parseLibraryImports(code);
  const libraries: ReturnType<typeof toEngineLibrary>[] = [];
  const missing: LibraryImportSpec[] = [];
  for (const spec of specs) {
    const rec = await resolvePublishedLibrary(spec, opts);
    if (rec) libraries.push(toEngineLibrary(rec));
    else missing.push(spec);
  }
  return { libraries, missing };
}

/** Local + remote catalog (metadata only). */
export async function listPublishedLibraries(opts?: {
  config?: Record<string, unknown>;
}): Promise<PublishedIndex> {
  const local = readCache();
  const cfg = resolveGitConfig(opts?.config);
  if (!gitReady(cfg)) return local.index;
  try {
    const remote = await readRemoteIndex(cfg);
    return mergeIndexes(local.index, remote);
  } catch {
    return local.index;
  }
}

/** @internal tests */
export function _resetPublishedCacheForTests(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PUBLISHED_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export { formatImportSnippet } from './library-publish';
