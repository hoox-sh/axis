/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * axis mcp — stdio MCP proxy to the Worker Streamable HTTP endpoint,
 * plus client config snippets.
 */

import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import { assertHttpsForSecret, defaultWorkerUrl } from '../services/health.js';
import {
  CLIError,
  ExitCode,
  getGlobalOpts,
  handleError,
  printHeader,
  printJson,
} from '../utils/format.js';

/**
 * Builds the Streamable HTTP MCP URL for a Worker base.
 *
 * @param base - Worker base URL; one trailing slash is tolerated.
 * @returns `<base>/mcp`, the single endpoint the Worker exposes for MCP.
 */
export function mcpEndpoint(base: string): string {
  return `${base.replace(/\/$/, '')}/mcp`;
}

/**
 * Builds an `mcpServers` client config for Claude / Cursor / Inspector.
 *
 * Stdio mode passes the key through the `AXIS_API_KEY` env var rather than `--key`,
 * because argv is world-readable via `ps`; remote mode puts it in an
 * `Authorization: Bearer` header.
 *
 * @param opts - `url` is the `/mcp` endpoint, `key` is optional (`pn_…`), and
 *   `stdio` selects the local proxy shape over the remote URL shape.
 * @returns A `{ mcpServers: { axis: … } }` object ready to paste into a client
 *   config.
 */
export function mcpClientConfig(opts: {
  url: string;
  key?: string;
  stdio?: boolean;
}): Record<string, unknown> {
  if (opts.stdio) {
    // The key travels via AXIS_API_KEY env only — never as a `--key` argv
    // (argv is visible to other users via ps). The proxy still accepts
    // --key for explicit one-shot runs; generated configs must not use it.
    const args = ['mcp'];
    if (opts.url) args.push('--url', opts.url);
    return {
      mcpServers: {
        axis: {
          command: 'axis',
          args,
          env: opts.key ? { AXIS_API_KEY: opts.key } : undefined,
        },
      },
    };
  }
  const headers: Record<string, string> = {};
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`;
  return {
    mcpServers: {
      axis: {
        url: opts.url,
        headers: Object.keys(headers).length ? headers : undefined,
      },
    },
  };
}

/**
 * POSTs one JSON-RPC message to the Worker's `/mcp` endpoint.
 *
 * Non-JSON responses are wrapped as `{ parseError: true, text }` instead of
 * throwing, so the stdio proxy can still answer the client with a valid frame.
 *
 * @param url - Absolute `/mcp` endpoint.
 * @param body - The JSON-RPC message; serialized as-is.
 * @param key - `pn_…` API key; sent as a Bearer header when non-empty.
 * @returns HTTP status and the parsed body (or the parse-error wrapper), or `null`
 *   for an empty response.
 * @throws {CLIError} From {@link assertHttpsForSecret} when a key would cross plain
 *   http to a non-local host.
 * @throws {Error} On network failure or the 60 s timeout.
 */
export async function postMcp(
  url: string,
  body: unknown,
  key: string,
): Promise<{ status: number; json: unknown }> {
  // Every POST carries the Bearer key — never cleartext off-host.
  if (key) assertHttpsForSecret(url, 'axis mcp');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { parseError: true, text };
  }
  return { status: res.status, json };
}

/**
 * Bridges newline-delimited JSON-RPC on stdin to the Worker `/mcp` endpoint.
 *
 * Notifications (no `id`) are forwarded fire-and-forget; requests are answered on
 * stdout, and a `202 Accepted` means the Worker already replied out of band. Local
 * failures are turned into JSON-RPC error frames (`-32700` parse error, `-32603`
 * internal error) so the client always gets a response for every `id`.
 *
 * @param url - Absolute `/mcp` endpoint.
 * @param key - `pn_…` API key used for every POST.
 * @returns Resolves when stdin closes (the client disconnected).
 */
export async function runStdioProxy(url: string, key: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`,
      );
      continue;
    }
    const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    if (typeof rec.id === 'undefined') {
      // notification — still forward (initialized, cancelled)
      void postMcp(url, parsed, key).catch(() => {
        /* notifications are fire-and-forget */
      });
      continue;
    }
    try {
      const out = await postMcp(url, parsed, key);
      if (out.status === 202) continue;
      const payload = out.json ?? {
        jsonrpc: '2.0',
        id: rec.id ?? null,
        error: { code: -32603, message: `HTTP ${out.status}` },
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } catch (err) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: rec.id ?? null,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          },
        })}\n`,
      );
    }
  }
}

/**
 * Registers `axis mcp` (stdio proxy) and `axis mcp config` (client JSON).
 *
 * Bare `axis mcp` requires a key and then proxies until stdin closes;
 * `--print-config` short-circuits to the config JSON without needing one.
 *
 * @param program - Root commander program to attach the command group to.
 */
export function registerMcp(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('AXIS MCP server — stdio proxy to Worker /mcp, or print client config')
    .option('--url <url>', 'Worker base URL (default AXIS_WORKER_URL or production)')
    .option('--key <key>', 'API key (default AXIS_API_KEY)')
    .option('--print-config', 'Print MCP client JSON (remote HTTP) and exit')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const flags = this.opts() as { url?: string; key?: string; printConfig?: boolean };
        const base = flags.url || defaultWorkerUrl();
        const url = mcpEndpoint(base);
        const key = (flags.key || process.env.AXIS_API_KEY || '').trim();
        if (flags.printConfig) {
          const cfg = mcpClientConfig({ url, key });
          if (opts.json || opts.quiet) printJson(cfg);
          else {
            printHeader('AXIS MCP client config', false);
            printJson(cfg);
          }
          return;
        }
        if (!key) {
          throw new CLIError(
            'MCP requires an API key',
            ExitCode.INVALID_USAGE,
            'Pass --key, set AXIS_API_KEY, or mint one with: axis keys create',
          );
        }
        await runStdioProxy(url, key);
      } catch (err) {
        handleError(err, opts.json);
      }
    });

  mcp
    .command('config')
    .description('Print MCP client JSON for Claude / Cursor / Inspector')
    .option('--url <url>', 'Worker base URL')
    .option('--key <key>', 'API key')
    .option('--stdio', 'Emit stdio (axis mcp) config instead of remote URL')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const flags = this.opts() as { url?: string; key?: string; stdio?: boolean };
        const base = flags.url || defaultWorkerUrl();
        const url = mcpEndpoint(base);
        const key = (flags.key || process.env.AXIS_API_KEY || '').trim();
        printJson(mcpClientConfig({ url, key, stdio: flags.stdio }));
      } catch (err) {
        handleError(err, opts.json);
      }
    });
}
