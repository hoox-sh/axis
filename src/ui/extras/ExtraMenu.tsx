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
 * panel). Inputs are Studio form primitives (`StudioToggle`, `StudioRange`,
 * sliders, `StudioColorInput`) so the panel matches Settings styling.
 *
 * Open/close + positioning follow {@link ../ChartLayoutMenu}.
 *
 * @module ui/extras/ExtraMenu
 */

import { type Component, For, Show, createSignal } from 'solid-js';
import { store, setStore, persist, isPanelOpen, setPanelOpen } from '../../store';
import { Icons } from '../icons';
import { Popover } from '../Popover';
import { StudioColorInput, StudioField, StudioRange, StudioToggle } from '../studio';
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
  let btnEl: HTMLButtonElement | undefined;

  const close = () => setOpen(false);

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
        onClick={() => setOpen((o) => !o)}
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

      <Popover
        open={open()}
        anchor={btnEl}
        onClose={close}
        width={340}
        class="sc-popover w-[min(340px,calc(100vw-24px))] max-h-[calc(100vh-16px)] overflow-y-auto overscroll-contain px-3 py-2.5 flex flex-col"
        role="dialog"
        label="Extra widgets"
        flip
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
              <StudioField label="Trend window" for="axis-extra-price-n">
                <StudioRange
                  id="axis-extra-price-n"
                  min={2}
                  max={100}
                  step={1}
                  value={store.extras.priceCard.tickLength}
                  format={(v) => `${v} ticks`}
                  ariaLabel="Trend tick length"
                  testId="axis-extra-price-n"
                  onInput={(value) => {
                    setStore('extras', 'priceCard', 'tickLength', value);
                    persist();
                  }}
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
              <StudioField label="Marquee speed" for="axis-extra-ticker-speed">
                <StudioRange
                  id="axis-extra-ticker-speed"
                  min={0.5}
                  max={3}
                  step={0.5}
                  value={store.extras.ticker.speed}
                  format={(v) => `${v.toFixed(1)}×`}
                  ariaLabel="Ticker speed"
                  testId="axis-extra-ticker-speed"
                  onInput={(value) => {
                    setStore('extras', 'ticker', 'speed', value);
                    persist();
                  }}
                />
              </StudioField>
              <StudioField label="Marquee direction" for="axis-extra-ticker-dir">
                <fieldset class="ax-chip-row" id="axis-extra-ticker-dir">
                  <legend class="sr-only">Marquee direction</legend>
                  <For each={['left', 'right'] as const}>
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
              <StudioField label="Item spacing" for="axis-extra-ticker-spacing">
                <StudioRange
                  id="axis-extra-ticker-spacing"
                  min={0}
                  max={3}
                  step={0.25}
                  value={store.extras.ticker.itemSpacing}
                  format={(v) => `${v.toFixed(1)}rem`}
                  ariaLabel="Ticker item spacing"
                  testId="axis-extra-ticker-spacing"
                  onInput={(value) => {
                    setStore('extras', 'ticker', 'itemSpacing', value);
                    persist();
                  }}
                />
              </StudioField>
              <StudioField label="Band height" for="axis-extra-ticker-height">
                <StudioRange
                  id="axis-extra-ticker-height"
                  min={18}
                  max={40}
                  step={1}
                  value={store.extras.ticker.bandHeight}
                  format={(v) => `${v}px`}
                  ariaLabel="Ticker band height"
                  testId="axis-extra-ticker-height"
                  onInput={(value) => {
                    setStore('extras', 'ticker', 'bandHeight', value);
                    persist();
                  }}
                />
              </StudioField>
              <StudioField label="Font size" for="axis-extra-ticker-fontsize">
                <StudioRange
                  id="axis-extra-ticker-fontsize"
                  min={10}
                  max={16}
                  step={1}
                  value={store.extras.ticker.fontSize}
                  format={(v) => `${v}px`}
                  ariaLabel="Ticker font size"
                  testId="axis-extra-ticker-fontsize"
                  onInput={(value) => {
                    setStore('extras', 'ticker', 'fontSize', value);
                    persist();
                  }}
                />
              </StudioField>
              <StudioField label="Opacity" for="axis-extra-ticker-opacity">
                <StudioRange
                  id="axis-extra-ticker-opacity"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={store.extras.ticker.opacity}
                  format={(v) => `${Math.round(v * 100)}%`}
                  ariaLabel="Ticker opacity"
                  testId="axis-extra-ticker-opacity"
                  onInput={(value) => {
                    setStore('extras', 'ticker', 'opacity', value);
                    persist();
                  }}
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

        {/* ── PYNE Agent panel ── */}
        <div class="axis-extra-menu-section">
          <div class="axis-extra-menu-row">
            <StudioToggle
              id="axis-extra-agent-toggle"
              checked={isPanelOpen('agent')}
              label="Agent panel"
              hint="Right dock · PYNE Agent chat"
              testId="axis-extra-agent-toggle"
              onChange={(v) => setPanelOpen('agent', v)}
            />
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
      </Popover>
    </div>
  );
};
