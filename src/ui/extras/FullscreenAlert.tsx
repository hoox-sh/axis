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
 * Fullscreen alert overlay — direction-colored viewport flash on any armed
 * price alert. Click / Esc / 6s timeout dismisses. Latest-only on bursts.
 * Reduced-motion falls back to a static banner (CSS).
 *
 * @module ui/extras/FullscreenAlert
 */

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { store } from '../../store';
import { subscribeFiredAlerts, type Alert, type FiredAlertEvent } from '../../alerts';
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
      const level =
        Number(alert.params?.price) ||
        Number(alert.params?.threshold) ||
        Number.NaN;
      if (Number.isFinite(level) && Number.isFinite(price)) {
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

  const dir = () => {
    const e = event();
    if (!e || !e.alerts[0]) return 'up' as AlertDirection;
    return alertDirection(e.alerts[0], e.price);
  };
  const color = () =>
    dir() === 'up' ? store.extras.alertOverlay.upColor : store.extras.alertOverlay.downColor;

  return (
    <Show when={event() && store.extras.alertOverlay.enabled}>
      <Portal>
        <div
          class="axis-extra-alert"
          data-testid="axis-extra-alert"
          style={{ '--alert-color': color() }}
          onClick={() => setEvent(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') setEvent(null);
          }}
          role="alertdialog"
          aria-label="Price alert"
        >
          <div class="axis-extra-alert-card">
            <div class="axis-extra-alert-sym">{event()!.symbol}</div>
            <div class="axis-extra-alert-price">{formatExtraPrice(event()!.price)}</div>
            <div class="axis-extra-alert-name">{event()!.alerts[0]?.name}</div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost axis-extra-alert-close"
              onClick={() => setEvent(null)}
              data-testid="axis-extra-alert-close"
            >
              Dismiss
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
