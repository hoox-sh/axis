/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PWA → Worker MCP bridge WebSocket. Receives `{ type: "invoke" }` frames
 * and replies with `{ type: "result" | "error" }`.
 *
 * @module mcp/bridge
 */

import { resolveCloudConfig } from '../storage/cloud-config';
import { appendLog } from '../store';
import { invokeCapability } from './dispatch';
import { McpInvokeError, sessionIdFromApiKey } from './protocol';

export type McpBridgeStatus = 'idle' | 'connecting' | 'open' | 'error' | 'closed';

export interface McpBridgeState {
  status: McpBridgeStatus;
  session: string | null;
  error: string | null;
  lastEventAt: number | null;
  /** PWA tabs attached to this key's Worker session (null = unknown). */
  tabs: number | null;
  /** Last agent invoke received on this socket (null = none yet). */
  lastInvokeAt: number | null;
  /** Capability of the last agent invoke. */
  lastCapability: string | null;
}

let ws: WebSocket | null = null;
let state: McpBridgeState = {
  status: 'idle',
  session: null,
  error: null,
  lastEventAt: null,
  tabs: null,
  lastInvokeAt: null,
  lastCapability: null,
};
const listeners = new Set<(s: McpBridgeState) => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;
let attempt = 0;

function emit(): void {
  const snap = { ...state };
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  }
}

export function mcpBridgeState(): McpBridgeState {
  return { ...state };
}

export function onMcpBridge(fn: (s: McpBridgeState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function workerWsUrl(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/api/mcp/bridge';
  u.search = '';
  u.hash = '';
  return u.toString();
}

async function handleFrame(raw: string): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = String(msg.type || '');
  if (type === 'ping') {
    ws?.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    return;
  }
  if (type !== 'invoke') return;
  const id = String(msg.id || '');
  const capability = String(msg.capability || '');
  state = { ...state, lastInvokeAt: Date.now(), lastCapability: capability || null };
  emit();
  const started = Date.now();
  try {
    const result = await invokeCapability(capability, msg.payload);
    appendLog('info', `mcp ${capability || '?'} → ok · ${Date.now() - started}ms`, 'mcp');
    ws?.send(JSON.stringify({ type: 'result', id, result }));
  } catch (err) {
    const code = err instanceof McpInvokeError ? err.code : 'APP_ERROR';
    const message = err instanceof Error ? err.message : String(err);
    appendLog('error', `mcp ${capability || '?'} → ${code} · ${message}`, 'mcp');
    ws?.send(JSON.stringify({ type: 'error', id, error: { code, message } }));
  }
}

function scheduleReconnect(): void {
  if (stopped) return;
  if (reconnectTimer) return;
  const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectMcpBridge();
  }, delay);
}

/** Attached-tab count for this key's Worker session (null = unknown). */
const TABS_POLL_MS = 20_000;
let tabsTimer: ReturnType<typeof setInterval> | null = null;

function setTabs(n: number | null): void {
  if (state.tabs === n) return;
  state = { ...state, tabs: n };
  emit();
  if (n != null) appendLog('info', `MCP session tabs attached: ${n}`, 'mcp');
}

function stopTabsPoll(): void {
  if (tabsTimer) {
    clearInterval(tabsTimer);
    tabsTimer = null;
  }
}

/**
 * Refresh the attached-tab count via `GET /api/mcp/bridge` (Bearer).
 * Transient failures keep the last-known value; callers clear on disconnect.
 */
export async function refreshBridgeTabs(): Promise<number | null> {
  const cfg = resolveCloudConfig();
  if (!cfg.apiKey) {
    setTabs(null);
    return null;
  }
  try {
    const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/api/mcp/bridge`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return state.tabs;
    const body = (await res.json()) as { connected?: unknown };
    const n = typeof body.connected === 'number' && Number.isFinite(body.connected) ? body.connected : null;
    if (n != null) setTabs(n);
    return n;
  } catch {
    return state.tabs;
  }
}

function startTabsPoll(): void {
  stopTabsPoll();
  void refreshBridgeTabs();
  tabsTimer = setInterval(() => {
    void refreshBridgeTabs();
  }, TABS_POLL_MS);
}

/**
 * Check for a deployed app update when the bridge (re)connects. Throttled to
 * one check per minute (reconnect backoff can fire every 15 s during an
 * outage). Dynamic import keeps the bridge free of update-manager cycles.
 */
const CONNECT_UPDATE_THROTTLE_MS = 60_000;

async function checkForUpdatesOnConnect(): Promise<void> {
  try {
    const { checkForUpdates, getUpdateState } = await import('../update/update-manager');
    if (Date.now() - getUpdateState().lastCheckedAt < CONNECT_UPDATE_THROTTLE_MS) return;
    await checkForUpdates();
  } catch {
    /* update prompt is best effort — never break the bridge */
  }
}

/** Open (or refresh) the control-plane socket using the stored cloud API key. */
export async function connectMcpBridge(): Promise<void> {
  stopped = false;
  const cfg = resolveCloudConfig();
  if (!cfg.apiKey) {
    stopTabsPoll();
    state = {
      status: 'idle',
      session: null,
      error:
        'No Worker API key — set one in Settings → General → Worker (cloud + MCP) to attach this tab.',
      lastEventAt: state.lastEventAt,
      tabs: null,
      lastInvokeAt: null,
      lastCapability: null,
    };
    emit();
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const session = await sessionIdFromApiKey(cfg.apiKey);
  const url = new URL(workerWsUrl(cfg.endpoint));
  url.searchParams.set('key', cfg.apiKey);
  state = {
    status: 'connecting',
    session,
    error: null,
    lastEventAt: Date.now(),
    tabs: null,
    lastInvokeAt: null,
    lastCapability: null,
  };
  emit();
  try {
    const socket = new WebSocket(url.toString());
    ws = socket;
    socket.addEventListener('open', () => {
      attempt = 0;
      state = {
        status: 'open',
        session,
        error: null,
        lastEventAt: Date.now(),
        tabs: null,
        lastInvokeAt: null,
        lastCapability: null,
      };
      emit();
      appendLog('ok', `MCP bridge open · session ${session.slice(0, 8)}… · this tab attached`, 'mcp');
      startTabsPoll();
      // A fresh socket means fresh Worker contact — a good moment to notice a
      // deployed app update (throttled; the interval poll is the backstop).
      void checkForUpdatesOnConnect();
    });
    socket.addEventListener('message', (ev) => {
      state = { ...state, lastEventAt: Date.now() };
      void handleFrame(String(ev.data || ''));
    });
    socket.addEventListener('close', () => {
      if (ws === socket) ws = null;
      stopTabsPoll();
      state = { ...state, status: 'closed', tabs: null };
      emit();
      appendLog('warn', 'MCP bridge closed — reconnecting', 'mcp');
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      stopTabsPoll();
      state = { ...state, status: 'error', error: 'WebSocket error', tabs: null };
      emit();
      appendLog('error', 'MCP bridge socket error', 'mcp');
    });
  } catch (err) {
    stopTabsPoll();
    state = {
      status: 'error',
      session,
      error: err instanceof Error ? err.message : String(err),
      lastEventAt: Date.now(),
      tabs: null,
      lastInvokeAt: state.lastInvokeAt,
      lastCapability: state.lastCapability,
    };
    emit();
    scheduleReconnect();
  }
}

export function disconnectMcpBridge(): void {
  stopped = true;
  stopTabsPoll();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  state = { ...state, status: 'closed', tabs: null };
  emit();
}
