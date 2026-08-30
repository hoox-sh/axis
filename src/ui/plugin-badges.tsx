// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Solid capability badges for plugin catalog / settings UI.
 * Pure helpers re-exported from `plugin-badges-utils` (safe for unit tests).
 */

import { Component, For, Show } from 'solid-js';
import type { PluginCapabilities } from '../plugins/types';
import { CAP_META, capabilityKeys, type CapKey } from './plugin-badges-utils';

export type { CapKey };
export { capabilityKeys, engineOptionLabel } from './plugin-badges-utils';

/**
 * Inline badge row: kind, built-in/plugin, and capability flags from CAP_META.
 */
export const CapabilityBadges: Component<{
  capabilities?: PluginCapabilities | null;
  builtIn?: boolean;
  kind?: string;
  active?: boolean;
  compact?: boolean;
}> = (props) => {
  const keys = () => capabilityKeys(props.capabilities);
  return (
    <span class="ax-cap-row">
      <Show when={props.kind}>
        <span class="ax-cap">{props.kind}</span>
      </Show>
      <Show when={props.builtIn}>
        <span class="ax-cap">built-in</span>
      </Show>
      <Show when={props.builtIn === false}>
        <span class="ax-cap ax-cap--plugin">plugin</span>
      </Show>
      <Show when={props.active}>
        <span class="ax-cap ax-cap--active">active</span>
      </Show>
      <For each={keys()}>
        {(k: CapKey) => (
          <span class={`ax-cap ax-cap--${k === 'needsNetwork' ? 'network' : k === 'needsAuth' ? 'auth' : k === 'needsProxy' ? 'proxy' : k}`} title={CAP_META[k].title}>
            {CAP_META[k].label}
          </span>
        )}
      </For>
    </span>
  );
};
