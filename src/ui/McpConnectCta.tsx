/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * "Connect MCP" button. Hidden once the bridge is open or already connecting.
 * Click attaches this tab, or opens Settings when the Worker key is missing.
 *
 * @module ui/McpConnectCta
 */

import { type Component, Show, createSignal, onCleanup } from 'solid-js';
import { mcpBridgeState, onMcpBridge, type McpBridgeState } from '../mcp/bridge';
import { requestMcpConnect } from '../mcp/host';

export function mcpNeedsConnect(status: McpBridgeState['status']): boolean {
  return status !== 'open' && status !== 'connecting';
}

/** Primary connect action for the chart boot splash and anywhere else it is mounted. */
export const McpConnectCta: Component<{ class?: string }> = (props) => {
  const [s, setS] = createSignal<McpBridgeState>(mcpBridgeState());
  const unsub = onMcpBridge(setS);
  onCleanup(unsub);

  return (
    <Show when={mcpNeedsConnect(s().status)}>
      <button
        type="button"
        class={`sc-btn sc-btn-primary axis-mcp-cta ${props.class || ''}`}
        data-testid="axis-mcp-connect-cta"
        title="Connect this tab so agents can drive the chart. Opens Settings if no Worker key is saved."
        onClick={() => requestMcpConnect()}
      >
        Connect MCP
      </button>
    </Show>
  );
};
