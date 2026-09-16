/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * MCP tools, resources, and prompts advertised by the AXIS Worker server.
 *
 * Worker-plane tools execute in this isolate (existing JSON APIs).
 * App-plane tools RPC to a connected PWA via {@link McpBridgeDO}.
 *
 * @module worker/mcp/catalog
 */

import type { McpPromptDef, McpResourceDef, McpToolDef } from './protocol';

const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});

const str = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  description,
  ...extra,
});

const optStr = (description: string) => str(description);

const optObj = (description: string) => ({
  type: 'object',
  additionalProperties: true,
  description,
});

/** All tools the AXIS MCP server exposes. */
export const MCP_TOOLS: readonly McpToolDef[] = [
  {
    name: 'axis_health',
    plane: 'worker',
    description:
      'Worker health JSON: status, version, and feature flags (scripts, d1, keys, onchain, market, mcp).',
    inputSchema: object({}),
  },
  {
    name: 'axis_request',
    plane: 'worker',
    description:
      'Call an allowlisted AXIS Worker HTTP API and return status + JSON body. Use for any Worker path (run, scripts, onchain, market, keys, usage, health). Not an open proxy.',
    inputSchema: object(
      {
        method: str('HTTP method', { enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' }),
        path: str('Worker path starting with / (e.g. /api/scripts, /api/onchain/llama/protocols)'),
        query: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
          description: 'Query string parameters',
        },
        body: {
          description: 'JSON body for POST/PUT',
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Extra headers (X-Admin-Token, If-Match, X-Exchange-Key, …). Authorization is injected.',
        },
      },
      ['path'],
    ),
  },
  {
    name: 'axis_run',
    plane: 'worker',
    description:
      'Run Pine Script™ against OHLCV bars via POST /api/run (Worker proxy or in-worker Pyodide). Returns plots, strategy events, and errors.',
    inputSchema: object(
      {
        script: str('Pine source (//@version=6 indicator/strategy)'),
        data: {
          type: 'array',
          description: 'OHLCV rows: {time, open, high, low, close, volume?}. time is unix seconds.',
          items: optObj('bar'),
        },
        ticker: optStr('Symbol label (e.g. BTCUSDT)'),
        timeframe: optStr('Interval (e.g. 1h)'),
        inputs: optObj('input.* overrides keyed by title'),
      },
      ['script'],
    ),
  },
  {
    name: 'axis_scripts_list',
    plane: 'worker',
    description: 'List cloud script library metadata (no source). Bearer-partitioned.',
    inputSchema: object({}),
  },
  {
    name: 'axis_scripts_get',
    plane: 'worker',
    description: 'Read one cloud script including Pine source.',
    inputSchema: object({ id: str('Script id') }, ['id']),
  },
  {
    name: 'axis_scripts_put',
    plane: 'worker',
    description: 'Create or upsert a cloud script. Optional If-Match / revision for optimistic concurrency.',
    inputSchema: object(
      {
        id: optStr('Script id; omit on create to mint s_<base36>'),
        name: str('Display name'),
        content: str('Pine source'),
        description: optStr('Optional blurb'),
        path: optStr('Optional virtual path'),
        revision: optStr('If-Match revision (409 CONFLICT on mismatch)'),
      },
      ['name', 'content'],
    ),
  },
  {
    name: 'axis_scripts_delete',
    plane: 'worker',
    description: 'Delete a cloud script by id.',
    inputSchema: object({ id: str('Script id') }, ['id']),
  },
  {
    name: 'axis_keys_validate',
    plane: 'worker',
    description: 'Validate the current Bearer API key (or an explicit key).',
    inputSchema: object({ key: optStr('Override key; default is the MCP session key') }),
  },
  {
    name: 'axis_keys_create',
    plane: 'worker',
    description: 'Mint a pn_… API key. Requires X-Admin-Token (pass adminToken).',
    inputSchema: object({
      tier: str('Plan tier', {
        enum: ['free', 'hobby', 'pro', 'team', 'enterprise'],
        default: 'hobby',
      }),
      adminToken: str('ADMIN_TOKEN for /api/keys create'),
    }),
  },
  {
    name: 'axis_usage',
    plane: 'worker',
    description: 'Usage counters for the current API key (calls used / remaining).',
    inputSchema: object({}),
  },
  {
    name: 'axis_onchain',
    plane: 'worker',
    description:
      'Allowlisted on-chain proxy. path is the suffix after /api/onchain (e.g. health, llama/protocols, llama/protocol/aave, gecko/search/pools).',
    inputSchema: object(
      {
        path: str('Suffix after /api/onchain, no leading slash required'),
        query: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
      },
      ['path'],
    ),
  },
  {
    name: 'axis_market',
    plane: 'worker',
    description:
      'Allowlisted CEX market proxy. path is the suffix after /api/market (e.g. health, binance/klines, mexc/ticker/24hr).',
    inputSchema: object(
      {
        path: str('Suffix after /api/market'),
        query: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
      },
      ['path'],
    ),
  },
  {
    name: 'app_capabilities',
    plane: 'app',
    description:
      'List live-app capabilities (chart, editor, indicators, alerts, library, plugins, …) from a connected PWA session.',
    inputSchema: object({
      session: optStr('Bridge session id; default is SHA-256 prefix of the API key'),
    }),
  },
  {
    name: 'app_invoke',
    plane: 'app',
    description:
      'Invoke a named PWA capability and wait for the JSON result. Covers nearly every AXIS surface: chart, editor, indicators, alerts, watchlist, library, results, panels, plugins, theme, drawings, workspace, logs, screenshots. See app_capabilities.',
    inputSchema: object(
      {
        capability: str('Capability id (e.g. chart.load, editor.set, alerts.create)'),
        payload: { description: 'Capability-specific JSON payload' },
        session: optStr('Bridge session id; default is the API-key partition'),
      },
      ['capability'],
    ),
  },
  {
    name: 'app_get',
    plane: 'app',
    description:
      'Read a sanitized live-app state slice (symbol, interval, layout, scripts, last run summary, logs, panels). Optional path is a dot path (e.g. symbol, live.active, lastRun.meta).',
    inputSchema: object({
      path: optStr('Optional dotted path into the snapshot'),
      session: optStr('Bridge session id'),
    }),
  },
  {
    name: 'app_set',
    plane: 'app',
    description:
      'Patch allowlisted live-app state (symbol, interval, theme, panels, live, chart type, editor doc, …). Unknown paths are rejected.',
    inputSchema: object(
      {
        path: str('Dotted path (e.g. symbol, interval, live.active, editor.doc)'),
        value: { description: 'New value' },
        session: optStr('Bridge session id'),
      },
      ['path'],
    ),
  },
  {
    name: 'app_session_status',
    plane: 'worker',
    description: 'Whether a PWA is connected to the MCP bridge for this API key (or an explicit session id).',
    inputSchema: object({
      session: optStr('Bridge session id; default is the API-key partition'),
    }),
  },
];

export const MCP_RESOURCES: readonly McpResourceDef[] = [
  {
    uri: 'axis://health',
    name: 'Worker health',
    description: 'Same payload as GET /health',
    mimeType: 'application/json',
  },
  {
    uri: 'axis://capabilities',
    name: 'MCP tool catalog',
    description: 'Tools, resources, and prompts this server exposes',
    mimeType: 'application/json',
  },
  {
    uri: 'axis://allowlist',
    name: 'HTTP allowlist',
    description: 'Paths axis_request may call',
    mimeType: 'application/json',
  },
  {
    uri: 'axis://session',
    name: 'App bridge session',
    description: 'Connected PWA count for this API key',
    mimeType: 'application/json',
  },
];

export const MCP_PROMPTS: readonly McpPromptDef[] = [
  {
    name: 'run_script',
    description: 'Run a Pine script on the current (or supplied) OHLCV and summarize plots / strategy / errors.',
    arguments: [
      { name: 'script', description: 'Pine source', required: true },
      { name: 'symbol', description: 'Symbol if the app should load bars first', required: false },
      { name: 'interval', description: 'Bar interval', required: false },
    ],
  },
  {
    name: 'debug_last_run',
    description: 'Inspect the last script run (errors, logs, plots) on a connected PWA or via last /api/run result.',
  },
  {
    name: 'analyze_strategy',
    description: 'Read strategy results (equity, trades, stats) from the connected app and explain them.',
  },
  {
    name: 'load_symbol',
    description: 'Load a symbol/interval on the connected chart and confirm bar count + last close.',
    arguments: [
      { name: 'symbol', description: 'e.g. BTCUSDT', required: true },
      { name: 'interval', description: 'e.g. 1h', required: false },
    ],
  },
  {
    name: 'audit_workspace',
    description: 'Snapshot the connected AXIS workspace (layout, scripts, plugins, alerts) and report what is active.',
  },
];

export function findTool(name: string): McpToolDef | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

export function findPrompt(name: string): McpPromptDef | undefined {
  return MCP_PROMPTS.find((p) => p.name === name);
}

export function findResource(uri: string): McpResourceDef | undefined {
  return MCP_RESOURCES.find((r) => r.uri === uri);
}
