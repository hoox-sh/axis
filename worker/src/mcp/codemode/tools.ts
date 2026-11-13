/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * The two model-facing Code Mode tools: `search` and `execute`.
 *
 * They are advertised only when `AXIS_MCP_CODE_MODE=1`, so an existing client
 * sees a byte-identical tool list when the flag is unset. Both take one
 * `code` string (a JavaScript async arrow function) and run it in a Dynamic
 * Worker with no bindings, no `env`, and no outbound network.
 *
 * @module worker/mcp/codemode/tools
 */

import { MCP_TOOLS } from '../catalog';
import type { Env } from '../../index';
import { jsonText, toolError, type McpToolDef, type McpToolResult } from '../protocol';
import type { ToolContext } from '../tools';
import { compactCatalog } from './catalog';
import { createCodeModeHandlers, type ToolInvoker } from './handlers';
import {
  DEFAULT_LIMITS,
  type SandboxRequest,
} from './protocol';
import { runInSandbox, type SandboxDeps } from './sandbox';

/** Names added by the flag. Exactly these two, never more. */
export const CODE_MODE_TOOL_NAMES = ['search', 'execute'] as const;

const CODE_FIELD = {
  type: 'string',
  minLength: 1,
  maxLength: DEFAULT_LIMITS.maxCodeChars,
  description:
    'JavaScript async arrow function with no parameters, for example `async () => ({ ok: true })`. It must return JSON-serializable data.',
};

const CODE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { code: CODE_FIELD },
  required: ['code'],
};

/** Tool definitions appended to `tools/list` when Code Mode is enabled. */
export const CODE_MODE_TOOL_DEFS: readonly McpToolDef[] = [
  {
    name: 'search',
    plane: 'worker',
    description:
      'Search the live AXIS MCP catalog by running JavaScript against it instead of loading every tool schema into context. `code` is an async arrow function; the binding `catalog` is an array of { name, short, plane, summary, args, required }. Filter it and return only the rows you need. Full input schemas stay behind execute. Runs in a Cloudflare Dynamic Worker with no bindings, no env, and no outbound network.',
    inputSchema: CODE_INPUT_SCHEMA,
  },
  {
    name: 'execute',
    plane: 'worker',
    description:
      "Run JavaScript that calls AXIS MCP tools, composes several calls, and returns only the data you need. `code` is an async arrow function. Binding: `axis.<short>(args)` (for example `axis.health()`, `axis.scripts_list()`, `axis.request({ method: 'GET', path: '/api/scripts' })`) or `axis.call('axis_health', {})`. Every call re-enters the parent Worker through the same authenticated tool path and allowlist as a direct call. Runs in a Cloudflare Dynamic Worker with no bindings, no env, and no outbound network; network-backed tools (onchain, market) execute in the parent.",
    inputSchema: CODE_INPUT_SCHEMA,
  },
];

/**
 * True when the operator opted in.
 *
 * `AXIS_MCP_CODE_MODE=1` is the documented switch; `true` is accepted because
 * Wrangler vars are strings and dashboards often store it that way.
 */
export function codeModeEnabled(env: Pick<Env, 'AXIS_MCP_CODE_MODE'> | undefined): boolean {
  const value = env?.AXIS_MCP_CODE_MODE;
  return value === '1' || value === 'true';
}

/**
 * Catalog used by `tools/list` and `axis://capabilities`.
 *
 * When disabled this returns the original readonly array, so serialization is
 * byte-identical to the pre-Code-Mode server.
 */
export function allToolDefs(enabled: boolean): readonly McpToolDef[] {
  return enabled ? [...MCP_TOOLS, ...CODE_MODE_TOOL_DEFS] : MCP_TOOLS;
}

/**
 * Handles one `search` / `execute` call.
 *
 * `invoke` is the parent's `callTool`; passing it in keeps this module free of
 * a runtime import cycle and gives tests a spy seam.
 *
 * @param ctx - Caller env, origin, auth, and execution context.
 * @param name - `search` or `execute`; anything else is rejected.
 * @param args - Raw `arguments` object from `tools/call`.
 * @param invoke - Authenticated tool dispatcher (`callTool`).
 * @param deps - Sandbox seams for tests (loader/dispatcher).
 */
export async function runCodeModeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
  invoke: ToolInvoker,
  deps: SandboxDeps = {},
): Promise<McpToolResult> {
  if (!codeModeEnabled(ctx.env)) return toolError(`Unknown tool: ${name}`);
  if (name !== 'search' && name !== 'execute') return toolError(`Unknown tool: ${name}`);

  const code = typeof args.code === 'string' ? args.code : '';
  if (!code.trim()) return toolError('code is required');

  const mode = name;
  const request: SandboxRequest = { mode, code };
  if (mode === 'search') request.catalog = compactCatalog();
  else request.handlers = createCodeModeHandlers(ctx, invoke);

  const sandboxDeps: SandboxDeps = {};
  if (ctx.env.LOADER) sandboxDeps.loader = ctx.env.LOADER;
  if (deps.makeDispatcher) sandboxDeps.makeDispatcher = deps.makeDispatcher;

  const result = await runInSandbox(request, sandboxDeps);
  if (!result.ok) {
    return toolError(`Code Mode ${mode} failed: ${result.message}`, {
      mode,
      duration_ms: result.durationMs,
    });
  }
  return jsonText(
    {
      ok: true,
      mode,
      value: result.value,
      calls: result.calls,
      logs: result.logs,
      truncated: result.truncated,
      duration_ms: result.durationMs,
    },
    true,
  );
}
