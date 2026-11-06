/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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
import { getJson, setJson } from '../utils/storage';
import { resolveCloudConfig } from '../storage/cloud-config';
import {
  connectMcpBridge,
  disconnectMcpBridge,
  isWellFormedWorkerApiKey,
  mcpBridgeState,
} from './bridge';

/**
 * The `window.__AXIS_MCP__` surface handed to same-origin scripts: read-only capability
 * invocation plus snapshot/capabilities/bridge introspection. Mutating capabilities are
 * denied here — authenticated agent traffic goes through the Worker bridge instead.
 */
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

/**
 * Persisted MCP preferences for this browser, shared with the bridge through the same
 * localStorage key so a reconnect decision survives reloads.
 */
export type McpPrefs = {
  /** Connect this tab to the Worker MCP bridge when an API key is set. */
  connect: boolean;
};

/**
 * Reads MCP preferences, defaulting to connected when nothing has been stored so a fresh
 * browser attaches to the bridge as soon as a key exists.
 *
 * @returns Stored prefs, or `{ connect: true }` when unset or unreadable.
 */
export function loadMcpPrefs(): McpPrefs {
  const p = getJson<{ connect?: unknown }>(MCP_PREF_KEY);
  if (!p) return { connect: true };
  return { connect: p.connect !== false };
}

/**
 * Persists MCP preferences so the connect choice applies on the next load.
 *
 * @param prefs Preferences to store; `connect: false` keeps this tab off the bridge.
 */
export function saveMcpPrefs(prefs: McpPrefs): void {
  setJson(MCP_PREF_KEY, prefs);
}

async function invoke(capability: string, payload?: unknown): Promise<unknown> {
  try {
    // F22: the in-page API is reachable by any same-origin script, so
    // mutating capabilities are denied here (user-consent UX deferred).
    // Authenticated agent traffic flows through the Worker bridge instead.
    return await invokeCapability(capability, payload, { allowMutations: false });
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

/**
 * Installs `window.__AXIS_MCP__` and, when prefs allow, opens the Worker bridge socket.
 *
 * @param hooks Live editor hooks dispatch uses instead of importing Solid UI.
 * @returns Teardown that disconnects the bridge and removes the global when it is still ours.
 */
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
