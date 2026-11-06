/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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

/**
 * Registers one palette runner so the MCP `app.command` capability can fire a palette id
 * without importing the Solid command palette at module load.
 *
 * @param id Palette command id as listed by `listPaletteCommandIds`; later calls overwrite.
 * @param run Runner invoked on dispatch; may be async and is awaited by the host.
 */
export function setPaletteCommand(id: string, run: CommandRun): void {
  runners.set(id, run);
}

/**
 * Replaces the whole palette runner registry in one call, so a remount never leaves stale ids
 * dispatchable from MCP.
 *
 * @param cmds Full snapshot of palette runners; the previous registry is cleared first.
 */
export function setPaletteCommands(cmds: Array<{ id: string; run: CommandRun }>): void {
  runners.clear();
  for (const c of cmds) runners.set(c.id, c.run);
}

/**
 * Drops every registered palette runner, used when the palette unmounts so MCP dispatch
 * fails closed instead of calling into disposed UI.
 */
export function clearPaletteCommands(): void {
  runners.clear();
}

/**
 * Lists dispatchable palette ids so MCP clients can discover valid `app.command` targets.
 *
 * @returns Ids currently in the registry, in insertion order.
 */
export function listPaletteCommandIds(): string[] {
  return [...runners.keys()];
}

/**
 * Runs a registered palette command by id; the host calls this for the MCP `app.command`
 * capability and treats `false` as "unknown id" rather than an error.
 *
 * @param id Palette command id previously registered through `setPaletteCommand(s)`.
 * @returns `true` when a runner existed and finished, `false` when the id is unknown.
 * @throws Whatever the runner throws — failures propagate so the host can map them to a
 * JSON-RPC error instead of a silent success.
 */
export async function runPaletteCommand(id: string): Promise<boolean> {
  const run = runners.get(id);
  if (!run) return false;
  await run();
  return true;
}
