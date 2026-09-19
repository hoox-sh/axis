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
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;
let attempt = 0;
let connectGen = 0;

/** Matches Worker production key shape (`pn_` + 24 random bytes hex). */
const WORKER_API_KEY_RE = /^pn_[a-f0-9]{48}$/;
/** Must match `MCP_PREF_KEY` in `host.ts`. */
const MCP_CONNECT_PREF_KEY = 'pynescript.axis.mcp.v1';
const ROTATE_DEBOUNCE_MS = 300;
const BACKOFF_CEILING_ATTEMPT = 5;

export function isWellFormedWorkerApiKey(key: string): boolean {
  return WORKER_API_KEY_RE.test(key.trim());
}

function mcpConnectEnabled(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(MCP_CONNECT_PREF_KEY);
    if (!raw) return true;
    return (JSON.parse(raw) as { connect?: unknown }).connect !== false;
  } catch {
    return true;
  }
}

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
  const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt, BACKOFF_CEILING_ATTEMPT));
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectMcpBridge();
  }, delay);
}

function logReconnect(ceilingLevel: 'warn' | 'error', message: string): void {
  const atCeiling = attempt >= BACKOFF_CEILING_ATTEMPT;
  appendLog(
    atCeiling ? ceilingLevel : 'info',
    message,
    'mcp',
    atCeiling ? undefined : { toast: false },
  );
}

function teardownSocket(): void {
  stopTabsPoll();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const socket = ws;
  ws = null;
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
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

function idleNoKey(): void {
  teardownSocket();
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
}

async function mintBridgeTicket(cfg: { endpoint: string; apiKey: string }): Promise<string> {
  const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/api/mcp/bridge?issue=ticket`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`bridge ticket HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ticket?: unknown };
  const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
  if (!ticket) throw new Error('bridge ticket missing');
  return ticket;
}

/** Open (or refresh) the control-plane socket using the stored cloud API key. */
export async function connectMcpBridge(): Promise<void> {
  if (!mcpConnectEnabled()) {
    disconnectMcpBridge();
    return;
  }
  const cfg = resolveCloudConfig();
  const key = (cfg.apiKey || '').trim();
  if (!key) {
    stopped = true;
    idleNoKey();
    return;
  }
  if (!isWellFormedWorkerApiKey(key)) {
    stopped = true;
    teardownSocket();
    state = {
      status: 'idle',
      session: null,
      error:
        'Worker API key is incomplete — paste a full pn_… key in Settings → General → Worker (cloud + MCP).',
      lastEventAt: state.lastEventAt,
      tabs: null,
      lastInvokeAt: null,
      lastCapability: null,
    };
    emit();
    return;
  }
  const session = await sessionIdFromApiKey(key);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    if (state.session === session) return;
    teardownSocket();
  }
  stopped = false;
  const gen = ++connectGen;
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
    const ticket = await mintBridgeTicket({ endpoint: cfg.endpoint, apiKey: key });
    if (stopped || gen !== connectGen) return;
    const url = new URL(workerWsUrl(cfg.endpoint));
    url.searchParams.set('ticket', ticket);
    const socket = new WebSocket(url.toString());
    if (stopped || gen !== connectGen) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      return;
    }
    ws = socket;
    socket.addEventListener('open', () => {
      if (ws !== socket) return;
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
      if (ws !== socket) return;
      state = { ...state, lastEventAt: Date.now() };
      void handleFrame(String(ev.data || ''));
    });
    socket.addEventListener('close', () => {
      if (ws !== socket) return;
      ws = null;
      stopTabsPoll();
      state = { ...state, status: 'closed', tabs: null };
      emit();
      if (stopped) return;
      logReconnect('warn', 'MCP bridge closed — reconnecting');
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      if (ws !== socket) return;
      stopTabsPoll();
      state = { ...state, status: 'error', error: 'WebSocket error', tabs: null };
      emit();
      if (stopped) return;
      logReconnect('error', 'MCP bridge socket error');
    });
  } catch (err) {
    if (stopped || gen !== connectGen) return;
    stopTabsPoll();
    const message = err instanceof Error ? err.message : String(err);
    state = {
      status: 'error',
      session,
      error: message,
      lastEventAt: Date.now(),
      tabs: null,
      lastInvokeAt: state.lastInvokeAt,
      lastCapability: state.lastCapability,
    };
    emit();
    logReconnect('error', `MCP bridge ticket failed — ${message} — reconnecting`);
    scheduleReconnect();
  }
}

/**
 * Re-sync the bridge to the stored Worker key.
 * Debounced (~300ms) so Settings keystrokes do not open a socket on the first
 * typed character. Save / generate pass `{ immediate: true }`.
 */
export function rotateMcpBridge(opts?: { immediate?: boolean }): void {
  if (rotateTimer) {
    clearTimeout(rotateTimer);
    rotateTimer = null;
  }
  const run = (): void => {
    rotateTimer = null;
    void connectMcpBridge();
  };
  if (opts?.immediate) run();
  else rotateTimer = setTimeout(run, ROTATE_DEBOUNCE_MS);
}

export function disconnectMcpBridge(): void {
  stopped = true;
  connectGen += 1;
  if (rotateTimer) {
    clearTimeout(rotateTimer);
    rotateTimer = null;
  }
  teardownSocket();
  state = { ...state, status: 'closed', tabs: null };
  emit();
}
