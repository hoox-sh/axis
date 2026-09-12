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
 * Update banner — shown when a newly deployed version is detected.
 *
 * Reads `updateState` from the update manager (version poll or waiting
 * service worker). Offers a soft reload (activate waiting worker), a hard
 * reload (drop SW + `axis-*` caches, cache-busted navigation), and Later.
 *
 * @module ui/UpdateBanner
 */

import { type Component, Show, createSignal } from 'solid-js';
import {
  confirmAppUpdate,
  dismissUpdate,
  getUpdateState,
  hardReload,
  softReload,
} from '../update/update-manager';

/** Top-fixed banner for pending app updates. */
export const UpdateBanner: Component = () => {
  const [busy, setBusy] = createSignal(false);
  const state = () => getUpdateState();
  const update = () => state().update;

  const askThen = (fn: () => void | Promise<void>) => {
    const info = update();
    if (!info) return;
    if (!confirmAppUpdate(info.currentVersion, info.latestVersion)) return;
    void fn();
  };

  const onUpdate = () => {
    if (busy()) return;
    setBusy(true);
    try {
      // Uses the stored waiting-worker activation when present, else reloads.
      softReload();
    } finally {
      // controllerchange reloads the page; reset busy if it doesn't (tests)
      setBusy(false);
    }
  };

  const onHardReload = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await hardReload({ skipConfirm: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={state().status === 'update-available' && update()}>
      {(u) => (
        <div
          class="fixed top-0 left-0 right-0 z-[90] flex items-center justify-center gap-2 px-3 py-2
            bg-bg-panel border-b-2 border-accent shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
          data-testid="axis-update-banner"
          role="alert"
          aria-label="Application update available"
        >
          <span class="text-[11px] text-text">
            Update available:{' '}
            <span class="font-mono font-medium text-accent">
              v{u().currentVersion} → v{u().latestVersion}
            </span>
          </span>
          <button
            type="button"
            class="sc-btn sc-btn-primary px-2.5 py-1 text-[11px]"
            data-testid="axis-update-reload"
            onClick={() => askThen(onUpdate)}
            disabled={busy()}
          >
            Update now
          </button>
          <button
            type="button"
            class="sc-btn px-2.5 py-1 text-[11px]"
            data-testid="axis-update-hard-reload"
            title="Unregister the service worker, delete cached app shells, then reload"
            onClick={() => askThen(() => void onHardReload())}
            disabled={busy()}
          >
            Hard reload
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-2 py-1 text-[11px]"
            data-testid="axis-update-later"
            onClick={() => dismissUpdate()}
            disabled={busy()}
          >
            Later
          </button>
        </div>
      )}
    </Show>
  );
};
