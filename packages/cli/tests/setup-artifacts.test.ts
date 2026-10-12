/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getArtifactsBinding,
  isValidArtifactsNamespace,
  upsertArtifactsBinding,
} from "../src/services/wrangler-toml.js";

describe("artifacts binding helpers", () => {
  let dir: string;
  let toml: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "axis-cli-artifacts-"));
    toml = join(dir, "wrangler.toml");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("isValidArtifactsNamespace accepts sane names", () => {
    expect(isValidArtifactsNamespace("axis-scripts")).toBe(true);
    expect(isValidArtifactsNamespace("ns1")).toBe(true);
    expect(isValidArtifactsNamespace("")).toBe(false);
    expect(isValidArtifactsNamespace("has space")).toBe(false);
    expect(isValidArtifactsNamespace('has"quote')).toBe(false);
    expect(isValidArtifactsNamespace("a".repeat(65))).toBe(false);
    expect(isValidArtifactsNamespace("semi;colon")).toBe(false);
  });

  test("upsert appends a block when none exists", () => {
    writeFileSync(toml, 'name = "worker-axis"\n');
    const r = upsertArtifactsBinding(toml, "SCRIPT_ARTIFACTS", "axis-scripts");
    expect(r.changed).toBe(true);
    expect(r.previous).toBeNull();
    expect(getArtifactsBinding(toml, "SCRIPT_ARTIFACTS")).toBe("axis-scripts");
    expect(readFileSync(toml, "utf-8")).toContain("[[artifacts]]");
  });

  test("upsert uncomments the shipped example block", () => {
    writeFileSync(
      toml,
      'name = "worker-axis"\n\n# [[artifacts]]\n# binding = "SCRIPT_ARTIFACTS"\n# namespace = "axis-scripts"\n'
    );
    const r = upsertArtifactsBinding(toml, "SCRIPT_ARTIFACTS", "custom-ns");
    expect(r.changed).toBe(true);
    expect(r.previous).toBeNull();
    const text = readFileSync(toml, "utf-8");
    expect(text).toContain('namespace = "custom-ns"');
    expect(text).not.toContain("# [[artifacts]]");
    expect(getArtifactsBinding(toml, "SCRIPT_ARTIFACTS")).toBe("custom-ns");
  });

  test("upsert is idempotent and renames namespaces", () => {
    writeFileSync(
      toml,
      'name = "x"\n\n[[artifacts]]\nbinding = "SCRIPT_ARTIFACTS"\nnamespace = "old"\n'
    );
    expect(
      upsertArtifactsBinding(toml, "SCRIPT_ARTIFACTS", "old").changed
    ).toBe(false);
    const r = upsertArtifactsBinding(toml, "SCRIPT_ARTIFACTS", "new");
    expect(r.changed).toBe(true);
    expect(r.previous).toBe("old");
    expect(getArtifactsBinding(toml, "SCRIPT_ARTIFACTS")).toBe("new");
  });

  test("getter ignores other bindings and missing files", () => {
    writeFileSync(
      toml,
      'name = "x"\n\n[[artifacts]]\nbinding = "OTHER"\nnamespace = "other-ns"\n'
    );
    expect(getArtifactsBinding(toml, "SCRIPT_ARTIFACTS")).toBeNull();
    expect(getArtifactsBinding(join(dir, "missing.toml"), "SCRIPT_ARTIFACTS")).toBeNull();
  });
});
