// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MCP stdio provider + `axis.mcp.showConfig` (KD-9 / Task 21).
 *
 * Soft-fail when CLI unresolved: empty definitions + one warning with a
 * "Show MCP Config" action. Key travels only via env `AXIS_API_KEY` — never
 * `--key` argv. package.json merge is deferred — see
 * `mcp-contributes.fragment.json`.
 */

import {
  commands,
  lm,
  window,
  workspace,
  type ExtensionContext,
  type McpServerDefinition,
  type McpServerDefinitionProvider,
  McpStdioServerDefinition,
} from 'vscode';
import { DEFAULT_WORKER_URL } from '../live/ticket';
import { SECRET_SLOTS } from '../secrets/slots';
import {
  resolveAxisCli,
  type AxisCliResolution,
  type ResolveAxisCliConfig,
  type WhichFn,
} from './resolve-cli';

/** Keep in sync with mcp-contributes.fragment.json (package.json merge later). */
export const MCP_PROVIDER_ID = 'axis.mcp';

export const MCP_COMMANDS = {
  showConfig: 'axis.mcp.showConfig',
} as const;

export const MCP_SOFT_FAIL_MESSAGE =
  'AXIS MCP CLI not found. Install @hoox-sh/axis-cli, set axis.mcp.command, or enable axis.mcp.allowNpx.';

export const MCP_SOFT_FAIL_ACTION = 'Show MCP Config';

/** Stdio server label shown in the MCP picker. */
export const MCP_STDIO_LABEL = 'AXIS';

let softFailWarned = false;

/** Reset one-shot soft-fail warning (unit tests). */
export function resetMcpSoftFailWarningForTests(): void {
  softFailWarned = false;
}

/** Strip trailing slash from a worker origin. */
export function normalizeWorkerBaseUrl(raw: string | undefined | null): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return DEFAULT_WORKER_URL;
  return s.replace(/\/$/, '') || DEFAULT_WORKER_URL;
}

/**
 * Args after the resolved command: `[...argsPrefix, 'mcp', '--url', base]`.
 * Pass the Worker **base** URL (CLI appends `/mcp` itself). Never include `--key`.
 */
export function buildMcpStdioArgs(
  resolved: AxisCliResolution,
  workerUrl: string,
): string[] {
  const base = normalizeWorkerBaseUrl(workerUrl);
  return [...resolved.argsPrefix, 'mcp', '--url', base];
}

/**
 * Env for the stdio child. Key only via `AXIS_API_KEY` (never argv).
 * Empty object when no key is stored.
 */
export function buildMcpStdioEnv(
  key: string | undefined | null,
): Record<string, string> {
  if (typeof key !== 'string') return {};
  const trimmed = key.trim();
  if (!trimmed) return {};
  return { AXIS_API_KEY: trimmed };
}

/** Assert argv never carries a secret-shaped flag (tests + defensive check). */
export function stdioArgsContainKeyFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--key' || a === '-k' || a.startsWith('--key=')) return true;
  }
  return false;
}

/**
 * Client config snippet for `axis.mcp.showConfig`.
 * Uses placeholders — never embeds SecretStorage plaintext.
 */
export function formatMcpConfigSnippet(workerUrl: string): string {
  const base = normalizeWorkerBaseUrl(workerUrl);
  const mcpUrl = `${base}/mcp`;
  const remote = {
    mcpServers: {
      axis: {
        url: mcpUrl,
        headers: { Authorization: 'Bearer pn_…' },
      },
    },
  };
  const stdio = {
    mcpServers: {
      axis: {
        command: 'axis',
        args: ['mcp', '--url', base],
        env: { AXIS_API_KEY: 'pn_…' },
      },
    },
  };
  return [
    '// AXIS MCP — paste into your client (Cursor / Claude / Inspector).',
    '// Key via env AXIS_API_KEY only for stdio — never --key in long-lived configs.',
    '// Set the Worker key in AXIS IDE: command "AXIS: Set Worker API Key".',
    '',
    '// --- Remote Streamable HTTP ---',
    JSON.stringify(remote, null, 2),
    '',
    '// --- Stdio (axis mcp) ---',
    JSON.stringify(stdio, null, 2),
    '',
  ].join('\n');
}

export type McpConfigReader = ResolveAxisCliConfig & {
  /** When false, provider returns no definitions. Default true. */
  stdioEnabled(): boolean;
  workerUrl(): string;
};

export type SoftFailUi = {
  showWarningMessage(
    message: string,
    ...items: string[]
  ): Thenable<string | undefined>;
  executeCommand(command: string, ...rest: unknown[]): Thenable<unknown>;
};

export type ProvideMcpDefinitionsDeps = {
  cfg: McpConfigReader;
  getWorkerKey: () => Promise<string | undefined>;
  which?: WhichFn;
  ui?: SoftFailUi;
  /**
   * Factory for the VS Code definition class — injectable so Bun tests can
   * avoid constructing the real `McpStdioServerDefinition` when desired.
   */
  createStdioDefinition?: (
    label: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => McpServerDefinition;
};

function readAxisConfig(): McpConfigReader {
  const axis = workspace.getConfiguration('axis');
  return {
    get<T>(section: string): T | undefined {
      return axis.get<T>(section);
    },
    stdioEnabled(): boolean {
      return axis.get<boolean>('mcp.stdio', true) !== false;
    },
    workerUrl(): string {
      const fromAxis = axis.get<string>('worker.url');
      if (typeof fromAxis === 'string' && fromAxis.trim()) return fromAxis.trim();
      // Prefer dedicated section when settings are split (live fragment).
      const worker = workspace.getConfiguration('axis.worker');
      const nested = worker.get<string>('url');
      if (typeof nested === 'string' && nested.trim()) return nested.trim();
      return DEFAULT_WORKER_URL;
    },
  };
}

function defaultSoftFailUi(): SoftFailUi {
  return {
    showWarningMessage(message, ...items) {
      return window.showWarningMessage(message, ...items);
    },
    executeCommand(command, ...rest) {
      return commands.executeCommand(command, ...rest);
    },
  };
}

function defaultCreateStdioDefinition(
  label: string,
  command: string,
  args: string[],
  env: Record<string, string>,
): McpServerDefinition {
  return new McpStdioServerDefinition(label, command, args, env);
}

/**
 * Core provide path — empty list when stdio disabled or CLI unresolved (soft-fail).
 */
export async function provideAxisMcpServerDefinitions(
  deps: ProvideMcpDefinitionsDeps,
): Promise<McpServerDefinition[]> {
  const cfg = deps.cfg;
  if (!cfg.stdioEnabled()) return [];

  const resolved = await resolveAxisCli(cfg, { which: deps.which });
  if (!resolved) {
    const ui = deps.ui ?? defaultSoftFailUi();
    if (!softFailWarned) {
      softFailWarned = true;
      void ui
        .showWarningMessage(MCP_SOFT_FAIL_MESSAGE, MCP_SOFT_FAIL_ACTION)
        .then((choice) => {
          if (choice === MCP_SOFT_FAIL_ACTION) {
            void ui.executeCommand(MCP_COMMANDS.showConfig);
          }
        });
    }
    return [];
  }

  const workerUrl = cfg.workerUrl();
  const args = buildMcpStdioArgs(resolved, workerUrl);
  if (stdioArgsContainKeyFlag(args)) {
    // Defensive: never advertise a definition that puts the key on argv.
    return [];
  }
  const key = await deps.getWorkerKey();
  const env = buildMcpStdioEnv(key);
  const create = deps.createStdioDefinition ?? defaultCreateStdioDefinition;
  return [create(MCP_STDIO_LABEL, resolved.command, args, env)];
}

/** Open an untitled document with the MCP client config snippet. */
export async function showMcpConfigSnippet(
  workerUrl?: string,
): Promise<string> {
  const url =
    typeof workerUrl === 'string' && workerUrl.trim()
      ? workerUrl
      : readAxisConfig().workerUrl();
  const text = formatMcpConfigSnippet(url);
  const doc = await workspace.openTextDocument({
    content: text,
    language: 'jsonc',
  });
  await window.showTextDocument(doc, { preview: true });
  return text;
}

/**
 * Register MCP provider id `axis.mcp` + `axis.mcp.showConfig`.
 * Call from activate (wiring agent merges fragment into package.json later).
 */
export function registerMcpProvider(context: ExtensionContext): {
  dispose(): void;
}[] {
  const getWorkerKey = async (): Promise<string | undefined> => {
    try {
      const v = await context.secrets.get(SECRET_SLOTS.cloudApiKey);
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  };

  const provider: McpServerDefinitionProvider = {
    provideMcpServerDefinitions: async () =>
      provideAxisMcpServerDefinitions({
        cfg: readAxisConfig(),
        getWorkerKey,
      }),
    resolveMcpServerDefinition: async (server) => server,
  };

  const disposables = [
    commands.registerCommand(MCP_COMMANDS.showConfig, () =>
      showMcpConfigSnippet(),
    ),
    lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider),
  ];
  context.subscriptions.push(...disposables);
  return disposables;
}
