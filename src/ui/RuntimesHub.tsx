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
 * **Runtimes hub** — one dialog shell for Status (Workers Manager) and Plugins
 * (catalog / install / library). Models stay separate; chrome and entry are shared.
 *
 * @module ui/RuntimesHub
 */

import { Component, Show, createEffect, createSignal, untrack } from 'solid-js';
import { Icons } from './icons';
import { WorkersManager } from './WorkersManager';
import { PluginManager } from './PluginManager';
import { AppDrawer } from './AppDrawer';

export type RuntimesSection = 'status' | 'plugins';

export interface RuntimesHubProps {
  open: boolean;
  onClose: () => void;
  /** Which primary section to show when opening. */
  initialSection?: RuntimesSection;
  /** Plugin Manager sub-tab. */
  pluginsInitialTab?: 'catalog' | 'install' | 'library';
  /** Workers Manager sub-tab. */
  workersInitialTab?: 'overview' | 'detail' | 'install' | 'configure';
  workersInitialId?: import('../workers').WorkerId;
  onChanged?: () => void;
  getDoc?: () => string;
  setDoc?: (doc: string, name?: string, libraryId?: string) => void;
}

/** Unified Runtimes dialog: Status | Plugins. */
export const RuntimesHub: Component<RuntimesHubProps> = (props) => {
  const [section, setSection] = createSignal<RuntimesSection>(
    props.initialSection || 'status',
  );

  // Reset section only when opening (do not thrash while open)
  createEffect(() => {
    if (!props.open) return;
    untrack(() => {
      setSection(props.initialSection || 'status');
    });
  });

  const sectionBtn = (id: RuntimesSection, label: string, hint: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={section() === id}
      data-testid={`axis-runtimes-tab-${id}`}
      title={hint}
      class={`flex-1 px-4 py-3 text-[13px] font-semibold border-b-2 -mb-[2px] inline-flex items-center justify-center gap-2 ${
        section() === id
          ? 'border-b-accent text-text'
          : 'border-b-transparent text-text-dim hover:text-text'
      }`}
      onClick={() => setSection(id)}
    >
      {id === 'status' ? <Icons.cpu size={15} /> : <Icons.folder size={15} />}
      {label}
    </button>
  );

  return (
    <AppDrawer
      open={props.open}
      onClose={props.onClose}
      title="Runtimes"
      titleId="axis-runtimes-title"
      hint="Workers run Pine and data. Plugins add sources, streams, and libraries."
      testId="axis-runtimes-hub"
      closeTestId="axis-runtimes-close"
      width="lg"
      flush
      tabs={
        <div
          class="sc-dialog-tabs sc-dialog-tabs--underline flex-shrink-0"
          role="tablist"
          aria-label="Runtimes sections"
        >
          {sectionBtn(
            'status',
            'Workers',
            'Health of backends, edge, Pyodide — click a card to configure',
          )}
          {sectionBtn(
            'plugins',
            'Plugins',
            'Sources, streams, engines, storage, script library',
          )}
        </div>
      }
    >
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden h-full">
        <Show when={section() === 'status'}>
          <WorkersManager
            open
            embedded
            onClose={props.onClose}
            initialTab={props.workersInitialTab}
            initialWorkerId={props.workersInitialId}
            onChanged={props.onChanged}
            onOpenPlugins={() => setSection('plugins')}
          />
        </Show>
        <Show when={section() === 'plugins'}>
          <PluginManager
            open
            embedded
            onClose={props.onClose}
            initialTab={props.pluginsInitialTab}
            onChanged={props.onChanged}
            getDoc={props.getDoc}
            setDoc={props.setDoc}
            onOpenStatus={() => setSection('status')}
          />
        </Show>
      </div>
    </AppDrawer>
  );
};
