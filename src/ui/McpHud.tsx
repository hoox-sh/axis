// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MCP bridge capsule for the status bar.
 *
 * Two dots:
 * - **Session dot** — bridge socket state (green open, amber connecting,
 *   red error/closed, dim idle) plus the attached-tab count for this key's
 *   Worker session.
 * - **Activity dot** — lights accent while an agent invoke is in flight
 *   (recently received on the socket), dim outline otherwise. MCP clients
 *   are stateless HTTP, so socket invokes are the only presence signal.
 *
 * Click opens Settings (MCP section lives on the General tab).
 *
 * @module ui/McpHud
 */

import { type Component, createSignal, onCleanup, onMount } from 'solid-js';
import { mcpBridgeState, onMcpBridge, type McpBridgeState } from '../mcp/bridge';

/** Activity window: an invoke counts as "active" this long after receipt. */
export const MCP_ACTIVITY_WINDOW_MS = 6000;

function dotClass(status: McpBridgeState['status']): string {
  switch (status) {
    case 'open':
      return 'bg-accent-2';
    case 'connecting':
      return 'bg-orange animate-pulse';
    case 'error':
    case 'closed':
      return 'bg-red';
    default:
      return 'bg-text-faint';
  }
}

function label(s: McpBridgeState): string {
  switch (s.status) {
    case 'open':
      return s.tabs == null ? 'MCP · …' : `MCP · ${s.tabs} tab${s.tabs === 1 ? '' : 's'}`;
    case 'connecting':
      return 'MCP · …';
    case 'error':
      return 'MCP · error';
    case 'closed':
      return 'MCP · off';
    default:
      return s.session ? 'MCP · idle' : 'MCP · no key';
  }
}

function activityAgo(lastInvokeAt: number | null, now: number): string | null {
  if (lastInvokeAt == null) return null;
  const s = Math.max(0, Math.round((now - lastInvokeAt) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function title(s: McpBridgeState, now: number): string {
  const parts = [`Bridge: ${s.status}`];
  if (s.session) parts.push(`session ${s.session.slice(0, 12)}…`);
  if (s.tabs != null) parts.push(`${s.tabs} tab${s.tabs === 1 ? '' : 's'} attached`);
  const ago = activityAgo(s.lastInvokeAt, now);
  if (s.lastCapability && ago) parts.push(`last agent call: ${s.lastCapability} (${ago})`);
  else if (s.lastCapability) parts.push(`last agent call: ${s.lastCapability}`);
  if (s.error) parts.push(s.error);
  parts.push('Click for Settings → MCP.');
  return parts.join(' · ');
}

function openSettings(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('axis-open-settings'));
  }
}

/** Status-bar MCP/session capsule with agent-activity dot. */
export const McpHud: Component = () => {
  const [s, setS] = createSignal<McpBridgeState>(mcpBridgeState());
  const [now, setNow] = createSignal(Date.now());
  const unsub = onMcpBridge(setS);
  onCleanup(unsub);
  onMount(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(t));
  });

  const active = () => {
    const at = s().lastInvokeAt;
    return at != null && now() - at < MCP_ACTIVITY_WINDOW_MS;
  };

  return (
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-text-dim hover:text-accent flex-shrink-0"
      title={title(s(), now())}
      data-testid="axis-mcp-hud"
      onClick={openSettings}
    >
      <span
        class={`inline-block h-[7px] w-[7px] rounded-full ${dotClass(s().status)}`}
        title="Bridge socket state"
      />
      <span
        data-testid="axis-mcp-activity"
        data-active={active() ? 'true' : 'false'}
        title={
          s().lastCapability
            ? `Last agent call: ${s().lastCapability}`
            : 'Lights up while an agent drives this tab'
        }
        class={
          active()
            ? 'inline-block h-[7px] w-[7px] rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]'
            : 'inline-block h-[7px] w-[7px] rounded-full border border-text-faint'
        }
      />
      <span>{label(s())}</span>
    </button>
  );
};
