/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Command-palette runner injected by CommandPalette so MCP can fire
 * palette ids without importing Solid UI at module load.
 *
 * @module mcp/commands
 */

type CommandRun = () => void | Promise<void>;

const runners = new Map<string, CommandRun>();

export function setPaletteCommand(id: string, run: CommandRun): void {
  runners.set(id, run);
}

export function setPaletteCommands(cmds: Array<{ id: string; run: CommandRun }>): void {
  runners.clear();
  for (const c of cmds) runners.set(c.id, c.run);
}

export function clearPaletteCommands(): void {
  runners.clear();
}

export function listPaletteCommandIds(): string[] {
  return [...runners.keys()];
}

export async function runPaletteCommand(id: string): Promise<boolean> {
  const run = runners.get(id);
  if (!run) return false;
  await run();
  return true;
}
