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
}

let ws: WebSocket | null = null;
let state: McpBridgeState = {
  status: 'idle',
  session: null,
  error: null,
  lastEventAt: null,
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

/** Open (or refresh) the control-plane socket using the stored cloud API key. */
export async function connectMcpBridge(): Promise<void> {
  stopped = false;
  const cfg = resolveCloudConfig();
  if (!cfg.apiKey) {
    state = {
      status: 'idle',
      session: null,
      error:
        'No Worker API key — set one in Settings → General → Worker (cloud + MCP) to attach this tab.',
      lastEventAt: state.lastEventAt,
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
  state = { status: 'connecting', session, error: null, lastEventAt: Date.now() };
  emit();
  try {
    const socket = new WebSocket(url.toString());
    ws = socket;
    socket.addEventListener('open', () => {
      attempt = 0;
      state = { status: 'open', session, error: null, lastEventAt: Date.now() };
      emit();
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
      state = { ...state, status: 'closed' };
      emit();
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      state = { ...state, status: 'error', error: 'WebSocket error' };
      emit();
    });
  } catch (err) {
    state = {
      status: 'error',
      session,
      error: err instanceof Error ? err.message : String(err),
      lastEventAt: Date.now(),
    };
    emit();
    scheduleReconnect();
  }
}

export function disconnectMcpBridge(): void {
  stopped = true;
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
  state = { ...state, status: 'closed' };
  emit();
}
