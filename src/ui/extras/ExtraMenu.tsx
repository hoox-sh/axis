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
 * Extra menu — module-bar dropdown with checkboxes for the extra chrome
 * widgets (price card, ticker marquee, fullscreen alert overlay).
 *
 * Open/close + positioning follow {@link ../ChartLayoutMenu}.
 *
 * @module ui/extras/ExtraMenu
 */

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { store, setStore, persist } from '../../store';
import { Icons } from '../icons';
import { anyExtraEnabled } from './state';

function toggleTickerSymbol(sym: string, on: boolean): void {
  const key = sym.trim();
  if (!key) return;
  const cur = store.extras.ticker.symbols;
  const next = on
    ? [...cur, key].filter((s, i, a) => a.indexOf(s) === i).slice(0, 20)
    : cur.filter((s) => s !== key);
  setStore('extras', 'ticker', 'symbols', next);
  persist();
}

/** Module-bar Extra button + dropdown panel. */
export const ExtraMenu: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [panelPos, setPanelPos] = createSignal({ top: 0, left: 0 });
  let btnEl: HTMLButtonElement | undefined;
  let panelEl: HTMLDivElement | undefined;

  const placePanel = () => {
    const el = btnEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const top = r.bottom + 4;
    setPanelPos({ top, left });
  };

  const close = () => setOpen(false);

  onMount(() => {
    const onDoc = (e: PointerEvent) => {
      if (!open()) return;
      const t = e.target as Node;
      if (btnEl?.contains(t) || panelEl?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onReposition = () => {
      if (open()) placePanel();
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    });
  });

  return (
    <div class="relative" data-testid="axis-extra-menu">
      <button
        ref={btnEl}
        type="button"
        class={`axis-module ${anyExtraEnabled(store.extras) ? 'is-active' : ''}`}
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) placePanel();
            return next;
          });
        }}
        title="Extra — price card, ticker, fullscreen alerts"
        aria-label="Extra"
        aria-expanded={open()}
        aria-haspopup="menu"
        aria-pressed={anyExtraEnabled(store.extras)}
        data-testid="axis-btn-extra"
      >
        <Icons.zap />
        <span class="axis-tb-btn-label">Extra</span>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={panelEl}
            class="fixed z-[200] w-[min(320px,calc(100vw-24px))] bg-bg-panel border-2 border-border shadow-[0_8px_28px_rgba(0,0,0,0.45)] p-2 flex flex-col gap-2"
            style={{ top: `${panelPos().top}px`, left: `${panelPos().left}px` }}
            role="menu"
            aria-label="Extra widgets"
          >
            {/* ── Price card ── */}
            <label class="flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={store.extras.priceCard.enabled}
                onChange={(e) => {
                  setStore('extras', 'priceCard', 'enabled', e.currentTarget.checked);
                  persist();
                }}
                data-testid="axis-extra-price-toggle"
              />
              <span>Price card</span>
              <span class="ml-auto text-text-faint font-mono text-[11px]">
                N={store.extras.priceCard.tickLength}
              </span>
            </label>
            <input
              type="range"
              min={2}
              max={100}
              step={1}
              value={store.extras.priceCard.tickLength}
              onInput={(e) => {
                setStore('extras', 'priceCard', 'tickLength', Number(e.currentTarget.value));
                persist();
              }}
              title="Ticks for trend arrow (2–100)"
              aria-label="Trend tick length"
              data-testid="axis-extra-price-n"
            />

            {/* ── Ticker ── */}
            <label class="flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={store.extras.ticker.enabled}
                onChange={(e) => {
                  setStore('extras', 'ticker', 'enabled', e.currentTarget.checked);
                  persist();
                }}
                data-testid="axis-extra-ticker-toggle"
              />
              <span>Price ticker</span>
              <span class="ml-auto text-text-faint font-mono text-[11px]">
                {store.extras.ticker.speed.toFixed(1)}×
              </span>
            </label>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.5}
              value={store.extras.ticker.speed}
              onInput={(e) => {
                setStore('extras', 'ticker', 'speed', Number(e.currentTarget.value));
                persist();
              }}
              title="Marquee speed (0.5×–3×)"
              aria-label="Ticker speed"
              data-testid="axis-extra-ticker-speed"
            />
            <Show
              when={store.watchlist.symbols.length > 0}
              fallback={<div class="text-[11px] text-text-faint">Watchlist is empty — add symbols to tick them.</div>}
            >
              <div class="flex flex-wrap gap-1">
                <For each={store.watchlist.symbols}>
                  {(sym) => (
                    <label class="flex items-center gap-1 text-[11px] border border-border rounded px-1.5 py-0.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={store.extras.ticker.symbols.includes(sym)}
                        onChange={(e) => toggleTickerSymbol(sym, e.currentTarget.checked)}
                        data-testid={`axis-extra-ticker-sym-${sym}`}
                      />
                      <span class="font-mono">{sym}</span>
                    </label>
                  )}
                </For>
              </div>
            </Show>

            {/* ── Fullscreen alert ── */}
            <div class="flex items-center gap-2 text-[12px]">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={store.extras.alertOverlay.enabled}
                  onChange={(e) => {
                    setStore('extras', 'alertOverlay', 'enabled', e.currentTarget.checked);
                    persist();
                  }}
                  data-testid="axis-extra-alert-toggle"
                />
                <span>Fullscreen alert</span>
              </label>
              <span class="ml-auto flex items-center gap-1">
                <input
                  type="color"
                  value={store.extras.alertOverlay.upColor}
                  onInput={(e) => {
                    e.stopPropagation();
                    setStore('extras', 'alertOverlay', 'upColor', e.currentTarget.value);
                    persist();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  title="Up color"
                  aria-label="Alert up color"
                  data-testid="axis-extra-alert-up"
                />
                <input
                  type="color"
                  value={store.extras.alertOverlay.downColor}
                  onInput={(e) => {
                    e.stopPropagation();
                    setStore('extras', 'alertOverlay', 'downColor', e.currentTarget.value);
                    persist();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  title="Down color"
                  aria-label="Alert down color"
                  data-testid="axis-extra-alert-down"
                />
              </span>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};
