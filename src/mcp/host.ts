/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * In-page AXIS MCP host — `window.__AXIS_MCP__` plus optional Worker bridge.
 *
 * @module mcp/host
 */

import { invokeCapability, setMcpHostHooks, type McpHostHooks } from './dispatch';
import { buildAppSnapshot } from './snapshot';
import { APP_CAPABILITIES } from './catalog';
import { McpInvokeError } from './protocol';
import { resolveCloudConfig } from '../storage/cloud-config';
import {
  connectMcpBridge,
  disconnectMcpBridge,
  isWellFormedWorkerApiKey,
  mcpBridgeState,
} from './bridge';

export interface AxisMcpApi {
  invoke: (capability: string, payload?: unknown) => Promise<unknown>;
  snapshot: (opts?: { includeBars?: boolean }) => unknown;
  capabilities: () => typeof APP_CAPABILITIES;
  bridge: () => ReturnType<typeof mcpBridgeState>;
}

declare global {
  interface Window {
    __AXIS_MCP__?: AxisMcpApi;
  }
}

const MCP_PREF_KEY = 'pynescript.axis.mcp.v1';

export type McpPrefs = {
  /** Connect this tab to the Worker MCP bridge when an API key is set. */
  connect: boolean;
};

export function loadMcpPrefs(): McpPrefs {
  try {
    const raw = localStorage.getItem(MCP_PREF_KEY);
    if (!raw) return { connect: true };
    const p = JSON.parse(raw) as { connect?: unknown };
    return { connect: p.connect !== false };
  } catch {
    return { connect: true };
  }
}

export function saveMcpPrefs(prefs: McpPrefs): void {
  try {
    localStorage.setItem(MCP_PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* quota */
  }
}

async function invoke(capability: string, payload?: unknown): Promise<unknown> {
  try {
    return await invokeCapability(capability, payload);
  } catch (err) {
    if (err instanceof McpInvokeError) {
      throw err;
    }
    throw new McpInvokeError('INVOKE_FAILED', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Attach this tab to the Worker MCP bridge.
 * A missing or incomplete `pn_` key opens Settings → General instead.
 */
export function requestMcpConnect(): void {
  const { apiKey } = resolveCloudConfig();
  if (!isWellFormedWorkerApiKey(apiKey)) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('axis-open-settings'));
    }
    return;
  }
  if (!loadMcpPrefs().connect) saveMcpPrefs({ connect: true });
  void connectMcpBridge();
}

/** Install the in-page API and optionally open the Worker control-plane socket. */
export function startMcpHost(hooks: McpHostHooks): () => void {
  setMcpHostHooks(hooks);
  const api: AxisMcpApi = {
    invoke,
    snapshot: (opts) => buildAppSnapshot(opts),
    capabilities: () => APP_CAPABILITIES,
    bridge: () => mcpBridgeState(),
  };
  if (typeof window !== 'undefined') {
    window.__AXIS_MCP__ = api;
  }
  const prefs = loadMcpPrefs();
  if (prefs.connect) {
    void connectMcpBridge();
  }
  return () => {
    disconnectMcpBridge();
    if (typeof window !== 'undefined' && window.__AXIS_MCP__ === api) {
      delete window.__AXIS_MCP__;
    }
  };
}
