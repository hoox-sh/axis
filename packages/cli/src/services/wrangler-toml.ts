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
