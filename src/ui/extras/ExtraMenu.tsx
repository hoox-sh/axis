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
 * Extra menu — module-bar dropdown with switches for the extra chrome
 * widgets (price card, ticker marquee, fullscreen alert overlay, quote
 * panel). Inputs are Studio form primitives (`StudioToggle`, `ax-range`
 * sliders, `StudioColorInput`) so the panel matches Settings styling.
 *
 * Open/close + positioning follow {@link ../ChartLayoutMenu}.
 *
 * @module ui/extras/ExtraMenu
 */

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { store, setStore, persist, isPanelOpen, setPanelOpen } from '../../store';
import { Icons } from '../icons';
import { StudioColorInput, StudioField, StudioToggle } from '../studio';
import { anyExtraEnabled, defaultTickerSymbols } from './state';

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
            class="fixed z-[200] w-[min(340px,calc(100vw-24px))] bg-bg-panel border-2 border-border rounded-lg shadow-[0_8px_28px_rgba(0,0,0,0.45)] px-3 py-2.5 flex flex-col"
            style={{ top: `${panelPos().top}px`, left: `${panelPos().left}px` }}
            role="menu"
            aria-label="Extra widgets"
          >
            <div class="axis-extra-menu-head">Extra widgets</div>

            {/* ── Price card ── */}
            <div class="axis-extra-menu-row">
              <StudioToggle
                id="axis-extra-price-toggle"
                checked={store.extras.priceCard.enabled}
                label="Price card"
                hint="Chart overlay · trend arrow"
                testId="axis-extra-price-toggle"
                onChange={(v) => {
                  setStore('extras', 'priceCard', 'enabled', v);
                  persist();
                }}
              />
              <Show when={store.extras.priceCard.enabled}>
                <StudioField
                  label={`Trend window · ${store.extras.priceCard.tickLength} ticks`}
                  for="axis-extra-price-n"
                >
                  <input
                    id="axis-extra-price-n"
                    class="ax-range"
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
                </StudioField>
              </Show>
            </div>

            {/* ── Ticker ── */}
            <div class="axis-extra-menu-row">
              <StudioToggle
                id="axis-extra-ticker-toggle"
                checked={store.extras.ticker.enabled}
                label="Price ticker"
                hint="Marquee band under the module bar"
                testId="axis-extra-ticker-toggle"
                onChange={(on) => {
                  setStore('extras', 'ticker', 'enabled', on);
                  if (on) {
                    // Seed from the watchlist so the band appears immediately —
                    // an empty symbol list would keep it hidden behind its gate.
                    setStore(
                      'extras',
                      'ticker',
                      'symbols',
                      defaultTickerSymbols(store.watchlist.symbols, store.extras.ticker.symbols),
                    );
                  }
                  persist();
                }}
              />
              <Show when={store.extras.ticker.enabled}>
                <StudioField
                  label={`Marquee speed · ${store.extras.ticker.speed.toFixed(1)}×`}
                  for="axis-extra-ticker-speed"
                >
                  <input
                    id="axis-extra-ticker-speed"
                    class="ax-range"
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
                </StudioField>
                <Show
                  when={store.watchlist.symbols.length > 0}
                  fallback={<div class="ax-hint">Watchlist is empty — add symbols to tick them.</div>}
                >
                  <fieldset class="ax-chip-row">
                    <legend class="sr-only">Ticker symbols</legend>
                    <For each={store.watchlist.symbols}>
                      {(sym) => {
                        const on = () => store.extras.ticker.symbols.includes(sym);
                        return (
                          <label class={`ax-chip${on() ? ' is-on' : ''}`}>
                            <input
                              type="checkbox"
                              class="sr-only"
                              checked={on()}
                              onChange={(e) => toggleTickerSymbol(sym, e.currentTarget.checked)}
                              data-testid={`axis-extra-ticker-sym-${sym}`}
                            />
                            <span class="font-mono">{sym}</span>
                          </label>
                        );
                      }}
                    </For>
                  </fieldset>
                </Show>
              </Show>
            </div>

            {/* ── Fullscreen alert ── */}
            <div class="axis-extra-menu-row">
              <StudioToggle
                id="axis-extra-alert-toggle"
                checked={store.extras.alertOverlay.enabled}
                label="Fullscreen alert"
                hint="Viewport flash on price alerts"
                testId="axis-extra-alert-toggle"
                onChange={(v) => {
                  setStore('extras', 'alertOverlay', 'enabled', v);
                  persist();
                }}
              />
              <Show when={store.extras.alertOverlay.enabled}>
                <div class="axis-extra-menu-colors">
                  <StudioField label="Up" for="axis-extra-alert-up">
                    <StudioColorInput
                      id="axis-extra-alert-up"
                      value={store.extras.alertOverlay.upColor}
                      testId="axis-extra-alert-up"
                      onChange={(v) => {
                        // Store accepts #rrggbb only (validated on hydrate).
                        if (!/^#[0-9a-fA-F]{6}$/.test(v.trim())) return;
                        setStore('extras', 'alertOverlay', 'upColor', v.trim());
                        persist();
                      }}
                    />
                  </StudioField>
                  <StudioField label="Down" for="axis-extra-alert-down">
                    <StudioColorInput
                      id="axis-extra-alert-down"
                      value={store.extras.alertOverlay.downColor}
                      testId="axis-extra-alert-down"
                      onChange={(v) => {
                        if (!/^#[0-9a-fA-F]{6}$/.test(v.trim())) return;
                        setStore('extras', 'alertOverlay', 'downColor', v.trim());
                        persist();
                      }}
                    />
                  </StudioField>
                </div>
              </Show>
            </div>

            {/* ── Quote panel ── */}
            <div class="axis-extra-menu-row axis-extra-menu-row--last">
              <StudioToggle
                id="axis-extra-quote-toggle"
                checked={isPanelOpen('quote')}
                label="Quote panel"
                hint="Right dock · full quote sheet"
                testId="axis-extra-quote-toggle"
                onChange={(v) => setPanelOpen('quote', v)}
              />
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};
