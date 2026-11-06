// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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
import { DebugPage } from '../debug/DebugPage';
import { DsmPage } from '../dsm/DsmPage';

/**
 * Map the active {@link StudioPageId} to its page component inside one
 * {@link AppPage} shell, so the overlay chrome is mounted once.
 *
 * WirePage pushes its applied-plan title up through `onTitle`; that override is
 * cleared whenever `page` changes so it cannot leak into the next page.
 *
 * @param props - Open flag, active page, navigation/close handlers, and page callbacks.
 * @returns The shell wrapping the selected page.
 */
export function StudioHost(props: {
  open: boolean;
  page: StudioPageId;
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
  settingsTab?: SettingsTabId;
  onChanged?: () => void;
  onApplied?: (planName: string) => void;
}): JSX.Element {
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
      <Show when={props.page === 'data'}>
        <DsmPage onClose={props.onClose} />
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
        />
      </Show>
      <Show when={props.page === 'debug'}>
        <DebugPage onClose={props.onClose} />
      </Show>
    </AppPage>
  );
}
