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

import { type Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { dismissOnOutside } from '../dismiss-on-outside';
import { Portal } from 'solid-js/web';
import { store, setStore, persist, isPanelOpen, setPanelOpen } from '../../store';
import { Icons } from '../icons';
import { StudioColorInput, StudioField, StudioToggle } from '../studio';
import { anyExtraEnabled, defaultTickerSymbols, resetTickerOptions } from './state';

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
    // Vertical clamp: the ticker section grows the panel, and the module bar can
    // sit low on short viewports — flip above the button, then hard-cap so the
    // panel scrolls instead of running off-screen.
    const margin = 8;
    const panelH = panelEl?.offsetHeight ?? 0;
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const top =
      panelH <= below
        ? r.bottom + 4
        : panelH <= above
          ? Math.max(margin, r.top - 4 - panelH)
          : Math.max(margin, window.innerHeight - panelH - margin);
    setPanelPos({ top, left });
  };

  const close = () => setOpen(false);

  onMount(() => {
    const onReposition = () => {
      if (open()) placePanel();
    };
    const disposeDismiss = dismissOnOutside({
      inside: () => [btnEl, panelEl],
      onDismiss: () => {
        if (open()) close();
      },
    });
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    onCleanup(() => {
      disposeDismiss();
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    });
  });

  // The panel renders inside <Show>, so its height is only measurable after the
  // open signal flips. Re-place on open and whenever its content height changes
  // (toggling the ticker section adds/removes the whole slider stack).
  createEffect(() => {
    if (!open()) return;
    // Re-run when the ticker section expands/collapses — the height changes and
    // the vertical clamp has to move the panel back inside the viewport.
    void store.extras.ticker.enabled;
    panelEl?.offsetHeight;
    placePanel();
  });

  const resetTicker = () => {
    const { symbols, enabled } = store.extras.ticker;
    setStore('extras', 'ticker', resetTickerOptions(symbols, enabled));
    persist();
  };

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
        aria-haspopup="dialog"
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
            class="sc-popover fixed z-[200] w-[min(340px,calc(100vw-24px))] max-h-[calc(100vh-16px)] overflow-y-auto overscroll-contain px-3 py-2.5 flex flex-col"
            style={{ top: `${panelPos().top}px`, left: `${panelPos().left}px` }}
            role="dialog"
            aria-label="Extra widgets"
          >
            <div class="axis-extra-menu-head">Extra widgets</div>

            {/* ── Price card ── */}
            <div class="axis-extra-menu-section">
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
            </div>

            {/* ── Ticker ── */}
            <div class="axis-extra-menu-section">
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
              </div>
              <Show when={store.extras.ticker.enabled}>
                <div class="axis-extra-menu-group">
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
                  <StudioField label="Marquee direction" for="axis-extra-ticker-dir">
                    <fieldset
                      class="ax-chip-row"
                      id="axis-extra-ticker-dir"
                    >
                      <legend class="sr-only">Marquee direction</legend>
                      <For each={(['left', 'right'] as const)}>
                        {(dir) => (
                          <button
                            type="button"
                            class={`ax-chip${store.extras.ticker.direction === dir ? ' is-on' : ''}`}
                            aria-pressed={store.extras.ticker.direction === dir}
                            data-testid={`axis-extra-ticker-dir-${dir}`}
                            onClick={() => {
                              setStore('extras', 'ticker', 'direction', dir);
                              persist();
                            }}
                          >
                            <span class="font-mono">{dir === 'left' ? '← Left' : 'Right →'}</span>
                          </button>
                        )}
                      </For>
                    </fieldset>
                  </StudioField>
                  <StudioToggle
                    id="axis-extra-ticker-change"
                    checked={store.extras.ticker.showChange}
                    label="Show 24h change"
                    hint="Change % after each price"
                    testId="axis-extra-ticker-change"
                    onChange={(v) => {
                      setStore('extras', 'ticker', 'showChange', v);
                      persist();
                    }}
                  />
                  <StudioToggle
                    id="axis-extra-ticker-draggable"
                    checked={store.extras.ticker.draggable}
                    label="Draggable handle"
                    hint="Show drag handle to reposition"
                    testId="axis-extra-ticker-draggable"
                    onChange={(v) => {
                      setStore('extras', 'ticker', 'draggable', v);
                      persist();
                    }}
                  />
                  <Show when={store.extras.ticker.offsetY !== 0}>
                    <button
                      type="button"
                      class="ax-btn ax-btn--ghost axis-extra-menu-reset"
                      onClick={() => {
                        setStore('extras', 'ticker', 'offsetY', 0);
                        persist();
                      }}
                      data-testid="axis-extra-ticker-reset-position"
                    >
                      Reset band position
                    </button>
                  </Show>
                  <StudioField
                    label={`Item spacing · ${store.extras.ticker.itemSpacing.toFixed(1)}rem`}
                    for="axis-extra-ticker-spacing"
                  >
                    <input
                      id="axis-extra-ticker-spacing"
                      class="ax-range"
                      type="range"
                      min={0}
                      max={3}
                      step={0.25}
                      value={store.extras.ticker.itemSpacing}
                      onInput={(e) => {
                        setStore('extras', 'ticker', 'itemSpacing', Number(e.currentTarget.value));
                        persist();
                      }}
                      title="Gap between ticker items (0–3rem)"
                      aria-label="Ticker item spacing"
                      data-testid="axis-extra-ticker-spacing"
                    />
                  </StudioField>
                  <StudioField
                    label={`Band height · ${store.extras.ticker.bandHeight}px`}
                    for="axis-extra-ticker-height"
                  >
                    <input
                      id="axis-extra-ticker-height"
                      class="ax-range"
                      type="range"
                      min={18}
                      max={40}
                      step={1}
                      value={store.extras.ticker.bandHeight}
                      onInput={(e) => {
                        setStore('extras', 'ticker', 'bandHeight', Number(e.currentTarget.value));
                        persist();
                      }}
                      title="Ticker band height (18–40px)"
                      aria-label="Ticker band height"
                      data-testid="axis-extra-ticker-height"
                    />
                  </StudioField>
                  <StudioField
                    label={`Font size · ${store.extras.ticker.fontSize}px`}
                    for="axis-extra-ticker-fontsize"
                  >
                    <input
                      id="axis-extra-ticker-fontsize"
                      class="ax-range"
                      type="range"
                      min={10}
                      max={16}
                      step={1}
                      value={store.extras.ticker.fontSize}
                      onInput={(e) => {
                        setStore('extras', 'ticker', 'fontSize', Number(e.currentTarget.value));
                        persist();
                      }}
                      title="Ticker font size (10–16px)"
                      aria-label="Ticker font size"
                      data-testid="axis-extra-ticker-fontsize"
                    />
                  </StudioField>
                  <StudioField
                    label={`Opacity · ${Math.round(store.extras.ticker.opacity * 100)}%`}
                    for="axis-extra-ticker-opacity"
                  >
                    <input
                      id="axis-extra-ticker-opacity"
                      class="ax-range"
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={store.extras.ticker.opacity}
                      onInput={(e) => {
                        setStore('extras', 'ticker', 'opacity', Number(e.currentTarget.value));
                        persist();
                      }}
                      title="Ticker band opacity (20–100%)"
                      aria-label="Ticker opacity"
                      data-testid="axis-extra-ticker-opacity"
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
                  <button
                    type="button"
                    class="ax-btn ax-btn--ghost axis-extra-menu-reset"
                    onClick={resetTicker}
                    data-testid="axis-extra-ticker-reset"
                  >
                    Reset ticker options
                  </button>
                </div>
              </Show>
            </div>

            {/* ── Fullscreen alert ── */}
            <div class="axis-extra-menu-section">
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
            </div>

            {/* ── Quote panel ── */}
            <div class="axis-extra-menu-section">
              <div class="axis-extra-menu-row">
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

            {/* ── Time panel (float only) ── */}
            <div class="axis-extra-menu-section">
              <div class="axis-extra-menu-row">
                <StudioToggle
                  id="axis-extra-time-toggle"
                  checked={isPanelOpen('time')}
                  label="Time panel"
                  hint="Float only · candle countdown"
                  testId="axis-extra-time-toggle"
                  onChange={(v) => setPanelOpen('time', v)}
                />
              </div>
            </div>

            {/* ── Price panel (float only) ── */}
            <div class="axis-extra-menu-section">
              <div class="axis-extra-menu-row">
                <StudioToggle
                  id="axis-extra-price-panel-toggle"
                  checked={isPanelOpen('price')}
                  label="Price panel"
                  hint="Float only · big last price"
                  testId="axis-extra-price-panel-toggle"
                  onChange={(v) => setPanelOpen('price', v)}
                />
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};
