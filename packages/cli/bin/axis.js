#!/usr/bin/env node
/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * AXIS CLI binary. Prefers dist/ (Node-compatible). Falls back to src/ when
 * running under Bun in a git checkout without a prior build.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, "..", "dist", "index.js");
const srcEntry = resolve(here, "..", "src", "index.ts");
const isBun = typeof Bun !== "undefined";
const forceSrc = process.env.AXIS_CLI_SRC === "1";

const entry =
  forceSrc && isBun && existsSync(srcEntry)
    ? srcEntry
    : existsSync(distEntry)
      ? distEntry
      : isBun && existsSync(srcEntry)
        ? srcEntry
        : null;

if (!entry) {
  process.stderr.write(
    `axis: no entry point found.\n  looked for:\n  - ${distEntry}\n  - ${srcEntry}\n` +
      (isBun
        ? "Run: bun install && bun run build  (in packages/cli)\n"
        : "This package needs a built dist/ (npm install) or Bun to run TypeScript src/.\n" +
          "  Install Bun: https://bun.sh\n" +
          "  Then: bun install && bun run build  (in packages/cli)\n")
  );
  process.exit(1);
}

const mod = await import(pathToFileURL(entry).href);
if (typeof mod.main !== "function") {
  process.stderr.write("axis: entry module does not export main()\n");
  process.exit(1);
}
await mod.main();
