/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Minimal wrangler.toml helpers (vars only — no full TOML parser).
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export function ensureWranglerToml(
  tomlPath: string,
  examplePath: string
): { created: boolean; path: string } {
  if (existsSync(tomlPath)) {
    return { created: false, path: tomlPath };
  }
  if (!existsSync(examplePath)) {
    throw new Error(
      `Missing ${tomlPath} and no example at ${examplePath}. Clone a full AXIS repo.`
    );
  }
  copyFileSync(examplePath, tomlPath);
  return { created: true, path: tomlPath };
}

export function readTomlText(tomlPath: string): string {
  if (!existsSync(tomlPath)) {
    throw new Error(`wrangler.toml not found: ${tomlPath}`);
  }
  return readFileSync(tomlPath, "utf-8");
}

/**
 * Set or insert a simple KEY = "value" under [vars].
 * Handles commented `# KEY = "..."` lines by uncommenting + replacing.
 */
export function setTomlVar(
  tomlPath: string,
  key: string,
  value: string
): { changed: boolean; previous?: string } {
  const text = readTomlText(tomlPath);
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const assign = `${key} = "${escaped}"`;

  // Active assignment
  const activeRe = new RegExp(
    `^(\\s*)${escapeRegExp(key)}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*'|[^#\\n]*)`,
    "m"
  );
  const active = text.match(activeRe);
  if (active) {
    const prev = stripQuotes(active[2]?.trim() ?? "");
    if (prev === value) return { changed: false, previous: prev };
    const next = text.replace(activeRe, `$1${assign}`);
    writeFileSync(tomlPath, next, "utf-8");
    return { changed: true, previous: prev };
  }

  // Commented assignment
  const commentRe = new RegExp(
    `^(\\s*)#\\s*${escapeRegExp(key)}\\s*=\\s*.*$`,
    "m"
  );
  if (commentRe.test(text)) {
    const next = text.replace(commentRe, `$1${assign}`);
    writeFileSync(tomlPath, next, "utf-8");
    return { changed: true };
  }

  // Insert after [vars]
  const varsIdx = text.search(/^\[vars\]\s*$/m);
  if (varsIdx >= 0) {
    const lineEnd = text.indexOf("\n", varsIdx);
    const insertAt = lineEnd >= 0 ? lineEnd + 1 : text.length;
    const next =
      text.slice(0, insertAt) + assign + "\n" + text.slice(insertAt);
    writeFileSync(tomlPath, next, "utf-8");
    return { changed: true };
  }

  const next = text.endsWith("\n")
    ? `${text}\n[vars]\n${assign}\n`
    : `${text}\n\n[vars]\n${assign}\n`;
  writeFileSync(tomlPath, next, "utf-8");
  return { changed: true };
}

export function getTomlVar(tomlPath: string, key: string): string | null {
  if (!existsSync(tomlPath)) return null;
  const text = readTomlText(tomlPath);
  const activeRe = new RegExp(
    `^\\s*${escapeRegExp(key)}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*'|[^#\\n]*)`,
    "m"
  );
  const m = text.match(activeRe);
  if (!m) return null;
  return stripQuotes(m[1]?.trim() ?? "") || null;
}

export function getTomlName(tomlPath: string): string | null {
  if (!existsSync(tomlPath)) return null;
  const text = readTomlText(tomlPath);
  const m = text.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return m?.[1] ?? null;
}

export function getD1DatabaseId(tomlPath: string): string | null {
  if (!existsSync(tomlPath)) return null;
  const text = readTomlText(tomlPath);
  // Prefer database_id after a [[d1_databases]] block with binding = "DB"
  const blocks = text.split(/\[\[d1_databases\]\]/);
  for (const block of blocks.slice(1)) {
    if (/binding\s*=\s*"DB"/.test(block) || /binding\s*=\s*'DB'/.test(block)) {
      const id = block.match(/database_id\s*=\s*"([^"]+)"/);
      if (id) return id[1];
    }
  }
  const any = text.match(/database_id\s*=\s*"([^"]+)"/);
  return any?.[1] ?? null;
}

/** True for empty / REPLACE_* placeholders (not a real Cloudflare id). */
export function isPlaceholderId(id: string | null | undefined): boolean {
  const s = String(id || "").trim();
  return !s || /REPLACE/i.test(s);
}

/**
 * Read `id` from an uncommented `[[kv_namespaces]]` block with the given binding.
 * Commented example blocks (the `# [[kv_namespaces]]` form) are ignored.
 */
export function getKvBindingId(tomlPath: string, binding: string): string | null {
  if (!existsSync(tomlPath)) return null;
  const lines = readTomlText(tomlPath).split(/\r?\n/);
  let inBlock = false;
  let currentBinding = "";
  let currentId = "";
  const finish = (): string | null =>
    currentBinding === binding && currentId ? currentId : null;

  for (const line of lines) {
    if (/^\s*#/.test(line)) continue;
    if (/^\[\[kv_namespaces\]\]\s*$/.test(line)) {
      const hit = finish();
      if (hit) return hit;
      inBlock = true;
      currentBinding = "";
      currentId = "";
      continue;
    }
    if (inBlock && /^\s*\[/.test(line)) {
      const hit = finish();
      if (hit) return hit;
      inBlock = false;
      currentBinding = "";
      currentId = "";
    }
    if (!inBlock) continue;
    const b = line.match(/^\s*binding\s*=\s*"([^"]+)"/);
    if (b) currentBinding = b[1] ?? "";
    const id = line.match(/^\s*id\s*=\s*"([^"]+)"/);
    if (id) currentId = id[1] ?? "";
  }
  return finish();
}

/**
 * Parse `id = "…"` / `"id": "…"` from `wrangler kv namespace create` output.
 */
export function parseKvNamespaceId(output: string): string | undefined {
  const m =
    output.match(/id\s*=\s*"([0-9a-f]{32})"/i) ||
    output.match(/"id"\s*:\s*"([0-9a-f]{32})"/i) ||
    output.match(/\bid\s*[:=]\s*([0-9a-f]{32})\b/i);
  return m?.[1];
}

function kvBlock(binding: string, id: string): string {
  return `[[kv_namespaces]]\nbinding = "${binding}"\nid = "${id}"\n`;
}

/**
 * Uncomment or insert a `[[kv_namespaces]]` binding with `id`.
 * Replaces a commented example block when present.
 */
export function upsertKvNamespace(
  tomlPath: string,
  binding: string,
  id: string
): { changed: boolean; previous?: string | null } {
  const previous = getKvBindingId(tomlPath, binding);
  if (previous === id) return { changed: false, previous };

  let text = readTomlText(tomlPath);
  const esc = escapeRegExp(binding);

  // Commented example: # [[kv_namespaces]] / # binding = "API_KEYS" / # id = "…"
  const commented = new RegExp(
    `^#\\s*\\[\\[kv_namespaces\\]\\]\\s*\\n#\\s*binding\\s*=\\s*"${esc}"\\s*\\n#\\s*id\\s*=\\s*"[^"]*"\\s*\\n?`,
    "m"
  );
  if (commented.test(text)) {
    text = text.replace(commented, kvBlock(binding, id));
    writeFileSync(tomlPath, text, "utf-8");
    return { changed: true, previous };
  }

  // Active block with this binding — replace id only.
  const active = new RegExp(
    `(^\\[\\[kv_namespaces\\]\\]\\s*\\nbinding\\s*=\\s*"${esc}"\\s*\\nid\\s*=\\s*")[^"]*(")`,
    "m"
  );
  if (active.test(text)) {
    text = text.replace(active, `$1${id}$2`);
    writeFileSync(tomlPath, text, "utf-8");
    return { changed: true, previous };
  }

  const d1 = text.search(/^\[\[d1_databases\]\]/m);
  const insertAt = d1 >= 0 ? d1 : text.length;
  const prefix = text.slice(0, insertAt);
  const suffix = text.slice(insertAt);
  const pad =
    prefix.endsWith("\n\n") || prefix.length === 0
      ? ""
      : prefix.endsWith("\n")
        ? "\n"
        : "\n\n";
  writeFileSync(tomlPath, `${prefix}${pad}${kvBlock(binding, id)}${suffix}`, "utf-8");
  return { changed: true, previous };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}
