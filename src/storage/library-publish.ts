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
 * Pine library publish emulator — versioned folders + import specs.
 *
 * Layout (git repo, under {@link GitConfig.basePath}):
 *
 * ```
 * published/index.json
 * published/{namespace}/{LibraryName}/{version}/lib.pyne
 * published/{namespace}/{LibraryName}/{version}/manifest.json
 * ```
 *
 * Import surface matches Pine: `import namespace/LibraryName/1 as alias`.
 *
 * @module storage/library-publish
 */

import { detectPineVersion, detectScriptKind } from '../indicators/script-meta';
import type { GitConfig } from './git-config';
import { sanitizeBasePath } from './git-config';

/** One `import ns/Name/ver [as alias]` found in a consumer script. */
export interface LibraryImportSpec {
  namespace: string
  name: string
  version: number
  alias: string
}

/** A published library version ready to register with the engine. */
export interface PublishedLibrary {
  namespace: string
  name: string
  version: number
  source: string
  pineVersion?: string
  publishedAt: number
  contentSha: string
  origin: 'manual' | 'auto'
  /** Repo-relative dir, when known. */
  path?: string
}

export interface PublishedIndex {
  version: 1
  libraries: Array<Omit<PublishedLibrary, 'source'>>
}

export const PUBLISHED_INDEX_VERSION = 1 as const

/** localStorage / IDB key for the offline published cache. */
export const PUBLISHED_CACHE_KEY = 'pynescript.axis.published.v1'

const IMPORT_RE =
  /^\s*import\s+([A-Za-z_][\w]*)\/([A-Za-z_][\w]*)\/(\d+)(?:\s+as\s+([A-Za-z_][\w]*))?/gm

const LIBRARY_DECL_RE = /\blibrary\s*\(\s*(['"])([^'"]+)\1/

/** Sanitize a Pine / git path identifier (`Foo Bar` → `Foo_Bar`). */
export function sanitizeIdent(raw: string): string {
  const s = String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!s) return 'Lib'
  return /^[A-Za-z_]/.test(s) ? s : `L_${s}`
}

/** FNV-1a 32-bit hex — skip republish when source is unchanged. */
export function contentSha(src: string): string {
  let h = 0x811c9dc5
  const s = String(src ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** `library("Title")` name, sanitized, or null when the script is not a library. */
export function parseLibraryDeclaration(code: string): { name: string } | null {
  if (detectScriptKind(code) !== 'library') return null
  const m = String(code ?? '').match(LIBRARY_DECL_RE)
  const name = sanitizeIdent(m?.[2] || 'Lib')
  return { name }
}

/** Every `import ns/Name/ver [as alias]` in source order (deduped by path). */
export function parseLibraryImports(code: string): LibraryImportSpec[] {
  const out: LibraryImportSpec[] = []
  const seen = new Set<string>()
  IMPORT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  const src = String(code ?? '')
  while ((m = IMPORT_RE.exec(src))) {
    const namespace = sanitizeIdent(m[1] || 'user')
    const name = sanitizeIdent(m[2] || 'Lib')
    const version = Number.parseInt(m[3] || '1', 10)
    if (!Number.isFinite(version) || version < 1) continue
    const key = `${namespace}/${name}/${version}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      namespace,
      name,
      version,
      alias: m[4] ? sanitizeIdent(m[4]) : name,
    })
  }
  return out
}

/** Import snippet a consumer pastes after a publish. */
export function formatImportSnippet(lib: Pick<PublishedLibrary, 'namespace' | 'name' | 'version'>): string {
  const alias = lib.name.length <= 12 ? lib.name.charAt(0).toLowerCase() + lib.name.slice(1) : 'lib'
  const safeAlias = /^[A-Za-z_]/.test(alias) ? alias : 'lib'
  return `import ${lib.namespace}/${lib.name}/${lib.version} as ${safeAlias}`
}

/** `{basePath}/published` */
export function publishedRoot(cfg: Pick<GitConfig, 'basePath'>): string {
  const base = sanitizeBasePath(cfg.basePath)
  return `${base}/published`.replace(/\/+/g, '/')
}

/** Catalog JSON at `{basePath}/published/index.json`. */
export function publishedIndexPath(cfg: Pick<GitConfig, 'basePath'>): string {
  return `${publishedRoot(cfg)}/index.json`
}

/** Version folder: `{basePath}/published/{ns}/{name}/{ver}`. */
export function publishedVersionDir(
  cfg: Pick<GitConfig, 'basePath'>,
  ns: string,
  name: string,
  version: number,
): string {
  return `${publishedRoot(cfg)}/${sanitizeIdent(ns)}/${sanitizeIdent(name)}/${version}`.replace(
    /\/+/g,
    '/',
  )
}

export function publishedLibPath(
  cfg: Pick<GitConfig, 'basePath'>,
  ns: string,
  name: string,
  version: number,
): string {
  return `${publishedVersionDir(cfg, ns, name, version)}/lib.pyne`
}

export function publishedManifestPath(
  cfg: Pick<GitConfig, 'basePath'>,
  ns: string,
  name: string,
  version: number,
): string {
  return `${publishedVersionDir(cfg, ns, name, version)}/manifest.json`
}

/** Next integer version for `ns/name` (1 if none published). */
export function nextPublishedVersion(
  index: PublishedIndex,
  ns: string,
  name: string,
): number {
  let max = 0
  for (const e of index.libraries) {
    if (e.namespace === ns && e.name === name && e.version > max) max = e.version
  }
  return max + 1
}

/** Latest published entry for `ns/name`, if any. */
export function latestPublished(
  index: PublishedIndex,
  ns: string,
  name: string,
): PublishedIndex['libraries'][number] | null {
  let best: PublishedIndex['libraries'][number] | null = null
  for (const e of index.libraries) {
    if (e.namespace !== ns || e.name !== name) continue
    if (!best || e.version > best.version) best = e
  }
  return best
}

export function emptyPublishedIndex(): PublishedIndex {
  return { version: PUBLISHED_INDEX_VERSION, libraries: [] }
}

/** Engine payload: `{ namespace, name, version, source }`. */
export function toEngineLibrary(lib: PublishedLibrary): {
  namespace: string
  name: string
  version: number
  source: string
} {
  return {
    namespace: lib.namespace,
    name: lib.name,
    version: lib.version,
    source: lib.source,
  }
}

/** Default publish namespace = git owner, else `user`. */
export function defaultPublishNamespace(cfg?: Pick<GitConfig, 'owner'> | null): string {
  const owner = String(cfg?.owner || '').trim()
  return owner ? sanitizeIdent(owner) : 'user'
}

export function buildPublishedRecord(
  code: string,
  opts: {
    namespace: string
    version: number
    origin: 'manual' | 'auto'
    path?: string
    publishedAt?: number
  },
): PublishedLibrary | null {
  const decl = parseLibraryDeclaration(code)
  if (!decl) return null
  const pineVersion = detectPineVersion(code) || undefined
  return {
    namespace: sanitizeIdent(opts.namespace),
    name: decl.name,
    version: opts.version,
    source: code,
    pineVersion,
    publishedAt: opts.publishedAt ?? Date.now(),
    contentSha: contentSha(code),
    origin: opts.origin,
    path: opts.path,
  }
}
