/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Parent-side handlers exposed to `execute`.
 *
 * Every sandbox call lands here and is forwarded through the *same*
 * authenticated `callTool` path as a direct MCP tool call. The sandbox never
 * receives `env`, a binding, or an HTTP client; `axis_request` in particular
 * re-enters the Worker with the caller's bearer and the normal allowlist.
 *
 * @module worker/mcp/codemode/handlers
 */

import { MCP_TOOLS } from '../catalog';
import type { McpToolResult } from '../protocol';
import type { ToolContext } from '../tools';
import { shortToolName } from './catalog';
import type { CodeModeHandler, CodeModeHandlers } from './protocol';

/** Same dispatch the direct tools use; injectable so tests can spy on it. */
export type ToolInvoker = (
  ctx: ToolContext,
  name: string,
  args: unknown,
) => Promise<McpToolResult>;

function unwrap(result: McpToolResult): unknown {
  if (result.isError) {
    const text = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    throw new Error(text || 'tool call failed');
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Builds `{ shortName: handler }` for every catalog tool.
 *
 * Names are own properties of a null-prototype object, so the sandbox cannot
 * reach `constructor` or `__proto__` through the dispatcher.
 */
export function createCodeModeHandlers(
  ctx: ToolContext,
  invoke: ToolInvoker,
): CodeModeHandlers {
  const handlers: CodeModeHandlers = Object.create(null) as CodeModeHandlers;
  for (const tool of MCP_TOOLS) {
    const name: string = tool.name;
    const handler: CodeModeHandler = async (args) => unwrap(await invoke(ctx, name, args ?? {}));
    handlers[shortToolName(name)] = handler;
  }
  return handlers;
}
