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
 * MCP bridge capsule for the status bar — socket state plus the attached-tab
 * count for this key's Worker session.
 *
 * MCP clients themselves are stateless HTTP (`POST /mcp`); presence tracking
 * is impossible there. What this shows is the control plane this tab needs:
 * whether the bridge socket is up, and how many PWA tabs the Worker sees on
 * the session (`GET /api/mcp/bridge` → `{ connected }`, polled by the bridge).
 *
 * Click opens Settings (MCP section lives on the General tab).
 *
 * @module ui/McpHud
 */

import { type Component, createSignal, onCleanup, Show } from 'solid-js';
import { mcpBridgeState, onMcpBridge, type McpBridgeState } from '../mcp/bridge';

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

function title(s: McpBridgeState): string {
  const parts = [`Bridge: ${s.status}`];
  if (s.session) parts.push(`session ${s.session.slice(0, 12)}…`);
  if (s.tabs != null) parts.push(`${s.tabs} tab${s.tabs === 1 ? '' : 's'} attached`);
  if (s.error) parts.push(s.error);
  parts.push('Click for Settings → MCP.');
  return parts.join(' · ');
}

function openSettings(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('axis-open-settings'));
  }
}

/** Status-bar MCP/session capsule. */
export const McpHud: Component = () => {
  const [s, setS] = createSignal<McpBridgeState>(mcpBridgeState());
  const unsub = onMcpBridge(setS);
  onCleanup(unsub);

  return (
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-text-dim hover:text-accent flex-shrink-0"
      title={title(s())}
      data-testid="axis-mcp-hud"
      onClick={openSettings}
    >
      <span class={`inline-block h-[7px] w-[7px] rounded-full ${dotClass(s().status)}`} />
      <span>{label(s())}</span>
      <Show when={s().status === 'open' && (s().tabs ?? 0) > 1}>
        <span class="text-accent-2" title="Another tab shares this MCP session">
          ●
        </span>
      </Show>
    </button>
  );
};
