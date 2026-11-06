// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PYNE Agent dock panel. Mounts the `pyne-agent` component plugin into the
 * panel body. The plugin fills the shell; this file does not draw a launcher.
 */

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { registry } from '../plugins/registry';
import { pluginKey } from '../plugins/types';
import { isPanelOpen, store } from '../store';
import { getAgentApiKey } from '../storage/vault';
import { FloatableShell } from './panels/FloatableShell';

function agentApi(): Record<string, unknown> {
  return {
    getConfig: () => {
      const configs = store.pluginsConfig || {};
      const bag = {
        ...(configs[pluginKey('component', 'pyne-agent')] || {}),
        ...(configs['pyne-agent'] || {}),
      };
      const apiKey = getAgentApiKey(store.pluginsConfig);
      return apiKey ? { ...bag, apiKey } : bag;
    },
    host: { fetch },
  };
}

/** Chat host. Mounts once; the plugin re-reads getConfig on each send. */
const AgentSlot: Component = () => {
  let host: HTMLDivElement | undefined;

  onMount(() => {
    const component = registry.getComponent('pyne-agent');
    const el = host;
    if (!component || !el) return;
    const stop = component.mount('panel', el, agentApi());
    onCleanup(() => {
      if (typeof stop === 'function') stop();
    });
  });

  return (
    <div ref={host} class="flex flex-col flex-1 min-h-0 h-full" data-testid="axis-agent-slot" />
  );
};

/** Right-dock Agent panel. Empty until the PYNE Agent plugin is installed. */
export const AgentPanel: Component = () : JSX.Element => {
  const [ready, setReady] = createSignal(!!registry.getComponent('pyne-agent'));

  onMount(() => {
    const off = registry.on((ev) => {
      if (ev.kind !== 'component' || ev.id !== 'pyne-agent') return;
      setReady(!!registry.getComponent('pyne-agent'));
    });
    setReady(!!registry.getComponent('pyne-agent'));
    onCleanup(off);
  });

  return (
    <Show when={isPanelOpen('agent')}>
      <FloatableShell id="agent" testId="axis-agent">
        <Show
          when={ready()}
          fallback={
            <div class="axis-empty-state text-[12px] text-text-dim p-3">
              Install the PYNE Agent plugin to use this panel.
            </div>
          }
        >
          <AgentSlot />
        </Show>
      </FloatableShell>
    </Show>
  );
};
