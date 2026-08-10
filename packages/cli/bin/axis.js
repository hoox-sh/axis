#!/usr/bin/env bun
/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * AXIS CLI binary. Prefers dist/, falls back to src/ for dev (Bun compiles TS).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, "..", "dist", "index.js");
const srcEntry = resolve(here, "..", "src", "index.ts");

const forceSrc = process.env.AXIS_CLI_SRC === "1";
const entry =
  forceSrc && existsSync(srcEntry)
    ? srcEntry
    : existsSync(distEntry)
      ? distEntry
      : existsSync(srcEntry)
        ? srcEntry
        : null;

if (!entry) {
  console.error(
    `axis: no entry point found.\n  looked for:\n  - ${distEntry}\n  - ${srcEntry}\n` +
      `Run bun install in packages/cli, or bun run build.`
  );
  process.exit(1);
}

const mod = await import(entry);
if (typeof mod.main === "function") {
  await mod.main();
}
