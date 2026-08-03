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
 * Toast prompting the user to transfer a redacted error diagnostic.
 * Shown only when {@link store.errorShareOffer} is set (opt-in telemetry).
 *
 * @module ui/ErrorShareToast
 */

import { Component, Show, createSignal } from 'solid-js';
import { store } from '../store';
import {
  acceptErrorShareOffer,
  dismissErrorShareOffer,
  type ErrorShareOffer,
} from './error-share';

/** Fixed bottom toast: Share / Dismiss for the pending diagnostic offer. */
export const ErrorShareToast: Component = () => {
  const [busy, setBusy] = createSignal(false);
  const offer = () => store.errorShareOffer as ErrorShareOffer | null;

  const onShare = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await acceptErrorShareOffer(offer());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={offer()}>
      {(o) => (
        <div
          class="fixed bottom-10 left-1/2 -translate-x-1/2 z-[80] max-w-md w-[min(92vw,28rem)]
            border-2 border-border bg-bg-elev shadow-lg px-3 py-2.5 flex flex-col gap-2"
          data-testid="axis-error-share-toast"
          role="dialog"
          aria-label="Share error diagnostic"
        >
          <div class="text-[10px] tracking-[0.14em] uppercase text-text-faint font-medium">
            Error diagnostic
          </div>
          <p class="text-[11px] text-text-dim font-mono break-words leading-snug">
            {o().summary}
          </p>
          <p class="text-[10px] text-text-faint leading-snug">
            Share a redacted report (no bars, scripts, or secrets)? Copies JSON
            to the clipboard and downloads a file. Nothing is uploaded automatically.
          </p>
          <div class="flex items-center gap-2 justify-end">
            <button
              type="button"
              class="sc-btn px-2.5 py-1 text-[11px]"
              data-testid="axis-error-share-dismiss"
              onClick={() => dismissErrorShareOffer()}
              disabled={busy()}
            >
              Dismiss
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-primary px-2.5 py-1 text-[11px]"
              data-testid="axis-error-share-accept"
              onClick={() => void onShare()}
              disabled={busy()}
            >
              {busy() ? 'Sharing…' : 'Share data'}
            </button>
          </div>
        </div>
      )}
    </Show>
  );
};
