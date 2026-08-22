// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Single studio overlay host. App.tsx owns `page`; this picks the canvas.
 *
 * @module ui/studio/StudioHost
 */

import { Show, createEffect, createSignal } from 'solid-js';
import { AppPage } from './AppPage';
import type { SettingsTabId, StudioPageId } from './types';
import { RuntimePage } from '../runtime/RuntimePage';
import { WirePage } from '../wire/WirePage';
import { SettingsPage } from '../settings/SettingsPage';
import { WorkersPage } from '../workers/WorkersPage';
import { PluginsPage } from '../plugins/PluginsPage';

export function StudioHost(props: {
  open: boolean;
  page: StudioPageId;
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
  settingsTab?: SettingsTabId;
  onChanged?: () => void;
  onApplied?: (planName: string) => void;
  getDoc?: () => string;
  setDoc?: (doc: string, name?: string, libraryId?: string) => void;
}) {
  const [overrideTitle, setOverrideTitle] = createSignal<string | undefined>();
  createEffect(() => {
    void props.page;
    setOverrideTitle(undefined);
  });

  return (
    <AppPage
      open={props.open}
      page={props.page}
      onNavigate={props.onNavigate}
      onClose={props.onClose}
      title={overrideTitle()}
    >
      <Show when={props.page === 'runtime'}>
        <RuntimePage onNavigate={props.onNavigate} onClose={props.onClose} />
      </Show>
      <Show when={props.page === 'wire'}>
        <WirePage
          onClose={props.onClose}
          onNavigate={props.onNavigate}
          onApplied={props.onApplied}
          onTitle={setOverrideTitle}
        />
      </Show>
      <Show when={props.page === 'settings'}>
        <SettingsPage onClose={props.onClose} initialTab={props.settingsTab} />
      </Show>
      <Show when={props.page === 'workers'}>
        <WorkersPage
          onClose={props.onClose}
          onNavigate={props.onNavigate}
          onChanged={props.onChanged}
        />
      </Show>
      <Show when={props.page === 'plugins'}>
        <PluginsPage
          onClose={props.onClose}
          onNavigate={props.onNavigate}
          onChanged={props.onChanged}
          getDoc={props.getDoc}
          setDoc={props.setDoc}
        />
      </Show>
    </AppPage>
  );
}
