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
 * Fullscreen alert overlay — direction-colored viewport flash on any armed
 * price alert. Click / Esc / 6s timeout dismisses. Latest-only on bursts.
 * Reduced-motion falls back to a static banner (CSS).
 *
 * @module ui/extras/FullscreenAlert
 */

import { type Component, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { store } from '../../store';
import { subscribeFiredAlerts, type Alert, type FiredAlertEvent } from '../../alerts';
import { installFocusTrap } from '../focus-trap';
import { formatExtraPrice } from './format';

export type AlertDirection = 'up' | 'down';

/** Resolve overlay direction from alert kind + params (pure). */
export function alertDirection(alert: Pick<Alert, 'kind' | 'params'>, price: number): AlertDirection {
  switch (alert.kind) {
    case 'price_above':
      return 'up';
    case 'price_below':
      return 'down';
    case 'pct_change': {
      const d = typeof alert.params?.direction === 'string' ? alert.params.direction : 'up';
      return d === 'down' ? 'down' : 'up';
    }
    default: {
      const num = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        return Number.isFinite(n) ? (n as number) : null;
      };
      const level = num(alert.params?.price) ?? num(alert.params?.threshold);
      if (level !== null && Number.isFinite(price)) {
        return price >= level ? 'up' : 'down';
      }
      return 'up';
    }
  }
}

/** Fullscreen alert overlay (mounted at app root). */
export const FullscreenAlert: Component = () => {
  const [event, setEvent] = createSignal<FiredAlertEvent | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const unsub = subscribeFiredAlerts((e) => {
      if (!store.extras.alertOverlay.enabled) return;
      const latest = e.alerts[e.alerts.length - 1];
      if (!latest) return;
      setEvent({ ...e, alerts: [latest] });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setEvent(null), 6000);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEvent(null);
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      unsub();
      document.removeEventListener('keydown', onKey);
      if (timer) clearTimeout(timer);
    });
  });

  // Never resurrect a dismissed/hidden alert: enabling the toggle must not
  // re-show a stale event after the overlay was hidden or timed out.
  createEffect(() => {
    if (!store.extras.alertOverlay.enabled) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      setEvent(null);
    }
  });

  const dir = () => {
    const e = event();
    if (!e || !e.alerts[0]) return 'up' as AlertDirection;
    return alertDirection(e.alerts[0], e.price);
  };
  const color = () =>
    dir() === 'up' ? store.extras.alertOverlay.upColor : store.extras.alertOverlay.downColor;

  return (
    <Show when={store.extras.alertOverlay.enabled}>
      <Show when={event()} keyed>
        {(e) => (
          <Portal>
            <div
              class="axis-extra-alert"
              data-testid="axis-extra-alert"
              style={{ '--alert-color': color() }}
              onClick={() => setEvent(null)}
              onKeyDown={(ev) => {
                // Document-level Escape already dismisses; kept so the clickable
                // overlay has a keyboard equivalent (button handles Enter/Space).
                if (ev.key === 'Escape') setEvent(null);
              }}
              role="alertdialog"
              aria-modal="true"
              aria-label="Price alert"
              ref={(el) => {
                if (!el) return;
                // Tab cycles inside the overlay; dispose restores prior focus.
                // Dismiss button autofocuses itself via its own ref below.
                const dispose = installFocusTrap(el, { autoFocus: false });
                onCleanup(dispose);
              }}
            >
              <div class="axis-extra-alert-card">
                <div class="axis-extra-alert-sym">{e.symbol}</div>
                <div class="axis-extra-alert-price">{formatExtraPrice(e.price)}</div>
                <div class="axis-extra-alert-name">{e.alerts[0]?.name}</div>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost axis-extra-alert-close"
                  ref={(el) => el.focus()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setEvent(null);
                  }}
                  data-testid="axis-extra-alert-close"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </Show>
  );
};
