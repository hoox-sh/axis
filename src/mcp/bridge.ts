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
}

let ws: WebSocket | null = null;
let state: McpBridgeState = {
  status: 'idle',
  session: null,
  error: null,
  lastEventAt: null,
  tabs: null,
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
  try {
    const result = await invokeCapability(capability, msg.payload);
    ws?.send(JSON.stringify({ type: 'result', id, result }));
  } catch (err) {
    const code = err instanceof McpInvokeError ? err.code : 'APP_ERROR';
    const message = err instanceof Error ? err.message : String(err);
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
  state = { status: 'connecting', session, error: null, lastEventAt: Date.now(), tabs: null };
  emit();
  try {
    const socket = new WebSocket(url.toString());
    ws = socket;
    socket.addEventListener('open', () => {
      attempt = 0;
      state = { status: 'open', session, error: null, lastEventAt: Date.now(), tabs: null };
      emit();
      startTabsPoll();
      try {
        socket.send(JSON.stringify({ type: 'hello', session }));
      } catch {
        /* ignore */
      }
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
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      stopTabsPoll();
      state = { ...state, status: 'error', error: 'WebSocket error', tabs: null };
      emit();
    });
  } catch (err) {
    stopTabsPoll();
    state = {
      status: 'error',
      session,
      error: err instanceof Error ? err.message : String(err),
      lastEventAt: Date.now(),
      tabs: null,
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
