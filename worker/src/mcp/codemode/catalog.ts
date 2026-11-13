/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Compact, typed view of the AXIS MCP capability surface.
 *
 * `search` receives this array and filters it. Full input schemas, defaults,
 * and descriptions stay behind the direct tools; keeping the injected array
 * small is the whole point of Code Mode.
 *
 * @module worker/mcp/codemode/catalog
 */

import { MCP_TOOLS } from '../catalog';
import type { McpToolDef } from '../protocol';

/** One compact catalog row. */
export interface CodeModeCatalogRow {
  /** Catalog tool name, e.g. `axis_request`. */
  name: string;
  /** Sandbox client name, e.g. `request` (the `axis_` prefix is dropped). */
  short: string;
  /** Where the tool runs. */
  plane: 'worker' | 'app';
  /** First line of the description, whitespace-collapsed and capped. */
  summary: string;
  /** Input property names, in schema order. */
  args: string[];
  /** Required input property names. */
  required: string[];
}

/** Drops the `axis_` namespace prefix so sandbox code reads `axis.request()`. */
export function shortToolName(name: string): string {
  return name.startsWith('axis_') ? name.slice('axis_'.length) : name;
}

function schemaArgs(tool: McpToolDef): { args: string[]; required: string[] } {
  const schema = tool.inputSchema;
  const properties = schema.properties;
  const args =
    properties && typeof properties === 'object' && !Array.isArray(properties)
      ? Object.keys(properties as Record<string, unknown>)
      : [];
  const requiredRaw = schema.required;
  const required = Array.isArray(requiredRaw)
    ? requiredRaw.filter((v): v is string => typeof v === 'string')
    : [];
  return { args, required };
}

/**
 * Builds one compact row per catalog tool, in catalog order.
 *
 * @param tools - Tool definitions; defaults to the live AXIS catalog.
 */
export function compactCatalog(tools: readonly McpToolDef[] = MCP_TOOLS): CodeModeCatalogRow[] {
  return tools.map((tool) => {
    const { args, required } = schemaArgs(tool);
    return {
      name: tool.name,
      short: shortToolName(tool.name),
      plane: tool.plane,
      summary: tool.description.replace(/\s+/g, ' ').trim().slice(0, 160),
      args,
      required,
    };
  });
}
