/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/utils/run.js";
import { mcpClientConfig, mcpEndpoint } from "../src/commands/mcp.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "axis.js");

async function axis(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return run("bun", [bin, ...args], {
    throwOnError: false,
    cwd: join(here, ".."),
    env: { ...process.env, AXIS_CLI_SRC: "1" },
  });
}

describe("mcp helpers", () => {
  test("mcpEndpoint appends /mcp", () => {
    expect(mcpEndpoint("https://worker.axis.hoox.sh")).toBe("https://worker.axis.hoox.sh/mcp");
    expect(mcpEndpoint("https://worker.axis.hoox.sh/")).toBe("https://worker.axis.hoox.sh/mcp");
  });

  test("mcpClientConfig remote includes Authorization when key set", () => {
    const cfg = mcpClientConfig({ url: "https://worker.axis.hoox.sh/mcp", key: "pn_abc" });
    const axis = (cfg.mcpServers as { axis: { url: string; headers?: { Authorization?: string } } }).axis;
    expect(axis.url).toContain("/mcp");
    expect(axis.headers?.Authorization).toBe("Bearer pn_abc");
  });

  test("mcpClientConfig --stdio uses axis command", () => {
    const cfg = mcpClientConfig({
      url: "https://worker.axis.hoox.sh/mcp",
      key: "pn_abc",
      stdio: true,
    });
    const axis = (cfg.mcpServers as { axis: { command: string; args: string[] } }).axis;
    expect(axis.command).toBe("axis");
    expect(axis.args).toContain("mcp");
    expect(axis.args).toContain("pn_abc");
  });
});

describe("axis mcp", () => {
  test("--help lists mcp", async () => {
    const r = await axis(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("mcp");
  });

  test("mcp config prints JSON", async () => {
    const r = await axis(["mcp", "config", "--url", "https://worker.axis.hoox.sh"]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { mcpServers: { axis: { url: string } } };
    expect(parsed.mcpServers.axis.url).toBe("https://worker.axis.hoox.sh/mcp");
  });

  test("mcp without key exits usage", async () => {
    const r = await axis(["mcp", "--url", "https://worker.axis.hoox.sh"]);
    expect(r.code).not.toBe(0);
    expect((r.stdout + r.stderr).toLowerCase()).toContain("api key");
  });
});
