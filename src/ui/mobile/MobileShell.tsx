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
 * Mobile chrome — phone (<768px) app-style shell replacing the desktop
 * Topbar/StatusBar chrome:
 *
 * - **{@link MobileHeader}** — brand (About), symbol picker, interval select
 * - **{@link MobileTabBar}** — bottom tabs: Chart · Panels · Editor · Studio · More
 * - **{@link MobileOverlays}** — panels list sheet + More drawer + symbol modal
 *
 * Panel content itself still renders through `FloatableShell` in sheet mode;
 * these components only host navigation. All actions reuse the same store
 * mutators as the desktop Topbar, so desktop/tablet state stays valid.
 *
 * @module ui/mobile/MobileShell
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import {
  store,
  setStore,
  persist,
  setEditorOpen,
  setEditorMode,
  setPanelOpen,
  isPanelOpen,
  toggleTheme,
  updateChartSlot,
  setStatus,
} from '../../store';
import { loadSymbolData } from '../../data/load-symbol';
import { WATCHLIST_INTERVALS } from '../../data/watchlist-tickers';
import { listSources } from '../../sources/catalog';
import {
  applyVenueToken,
  listVenueOptions,
  parseVenueToken,
  venueTokenFromState,
} from '../../data/venue-picker';
import { activeCcxtExchange } from '../../data/credentials';
import { DATA_MANAGER_SOURCE_ID } from '../../data/data-manager-source';
import { startLive, stopLive, defaultStreamForSource } from '../../streams/multiplex';
import { isReplayActive } from '../../chart/bar-replay';
import { exitBarReplay } from '../BarReplayControls';
import { Icons, PANEL_ICON } from '../icons';
import { PANEL_META, type PanelId } from '../panels/types';
import {
  activeMobileSheet,
  closeAllMobileSheets,
  openMobileSheet,
} from '../panels/mobile-sheet';
import { SymbolModal } from '../SymbolModal';
import { openAboutModal } from '../AboutModal';
import type { StudioPageId } from '../studio';

/** Panels surfaced in the mobile Panels sheet (stack order, minus chrome strips). */
const MOBILE_PANELS: readonly PanelId[] = [
  'watchlist',
  'indicators',
  'dataview',
  'layers',
  'alerts',
  'library',
  'datasource',
  'onchain',
  'scriptlogs',
] as const;

export interface MobileChromeProps {
  /** Open studio overlay (last page / home). */
  onOpenStudio: () => void;
  /** Open a specific studio page (Runtime, Wire, Workers, Plugins, Settings). */
  onOpenStudioPage: (page: StudioPageId) => void;
  /** True while a studio page overlay is open (tab highlight). */
  studioOpen: () => boolean;
  editorRef: { getDoc: () => string };
}

// Shared mobile chrome state — header / tab bar / overlays are separate
// mount points in the app flex column, so state lives at module scope.
const [symbolOpen, setSymbolOpen] = createSignal(false);
const [panelsOpen, setPanelsOpen] = createSignal(false);
const [moreOpen, setMoreOpen] = createSignal(false);

/** Panels list row: always open/activate the sheet (close via the sheet's X). */
const openPanelRow = (id: PanelId) => {
  setPanelsOpen(false);
  setMoreOpen(false);
  if (!isPanelOpen(id)) setPanelOpen(id, true);
  openMobileSheet(id);
};

const commitSymbol = (raw: string) => {
  const next = raw.toUpperCase().trim();
  if (!next) return;
  setStore('symbol', next);
  const aid = store.chartLayout?.activeId;
  if (aid) updateChartSlot(aid, { symbol: next });
  persist();
  void loadSymbolData(next, store.interval, store.source);
};

const onIntervalChange = (interval: string) => {
  setStore('interval', interval);
  persist();
  void loadSymbolData(store.symbol, interval, store.source);
};

const onVenueChange = (token: string) => {
  applyVenueToken(token);
  const { sourceId } = parseVenueToken(token);
  if (sourceId === DATA_MANAGER_SOURCE_ID) {
    // Data Manager needs its panel — open it as the active sheet
    setPanelOpen('datasource', true);
    openMobileSheet('datasource');
    return;
  }
  if (sourceId === 'csv-upload') {
    setStatus('ready', 'CSV upload: drop a .csv file or use Settings → Data on desktop');
    return;
  }
  void loadSymbolData(store.symbol, store.interval, store.source);
};

const runScript = (editorRef: { getDoc: () => string }) => {
  setMoreOpen(false);
  const doc = editorRef.getDoc?.() || '';
  if (!doc.trim()) {
    setStatus('error', 'No script to run — open the editor first');
    return;
  }
  void import('../../indicators/run-target')
    .then(({ runFromEditor }) =>
      runFromEditor(doc, { mode: 'auto', inputs: store.editorInputValues || {} }),
    )
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error', `Run failed: ${msg}`);
    });
};

const toggleLive = () => {
  setMoreOpen(false);
  if (store.live.active) {
    stopLive();
    return;
  }
  if (isReplayActive()) exitBarReplay();
  const streamId = store.live.streamId || defaultStreamForSource(store.source);
  startLive(streamId, store.symbol, store.interval);
};

const openEditorSheet = () => {
  setPanelsOpen(false);
  setMoreOpen(false);
  setEditorMode('docked');
  setEditorOpen(true);
  setPanelOpen('editor', true);
  openMobileSheet('editor');
};

const goChart = () => {
  setPanelsOpen(false);
  setMoreOpen(false);
  closeAllMobileSheets();
};

/** Mobile top chrome — replaces the desktop Topbar on phones. */
export const MobileHeader: Component<MobileChromeProps> = (props) => {
  const venueToken = () => venueTokenFromState(store.source, activeCcxtExchange());
  const venueOptions = createMemo(() =>
    listVenueOptions(
      listSources().map((s) => ({ id: s.id, name: s.name })),
      activeCcxtExchange(),
    ),
  );

  return (
    <>
      <header
        class="axis-mheader flex-shrink-0 flex items-center gap-1.5 px-2 bg-bg-panel border-b-2 border-border"
        data-testid="axis-mobile-header"
      >
        <button
          type="button"
          class="axis-mbrand"
          title="About AXIS"
          aria-label="About AXIS"
          onClick={() => openAboutModal()}
        >
          AXIS
        </button>
        <select
          class="axis-mvenue"
          data-testid="axis-mobile-venue"
          title="Exchange / data venue"
          aria-label="Venue"
          value={venueToken()}
          onChange={(e) => onVenueChange(e.currentTarget.value)}
        >
          <optgroup label="CEX">
            <For each={venueOptions().filter((o) => o.group === 'native')}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </optgroup>
          <optgroup label="CCXT">
            <For each={venueOptions().filter((o) => o.group === 'ccxt')}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </optgroup>
          <optgroup label="Other">
            <For each={venueOptions().filter((o) => o.group === 'other' || o.group === 'plugin')}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </optgroup>
        </select>
        <button
          type="button"
          class="axis-msymbol"
          data-testid="axis-mobile-symbol"
          title="Change symbol"
          onClick={() => setSymbolOpen(true)}
        >
          <span class="truncate">{store.symbol || '—'}</span>
          <Icons.chevronDown size={12} />
        </button>
        <select
          class="axis-minterval"
          data-testid="axis-mobile-interval"
          title="Interval"
          aria-label="Interval"
          value={store.interval}
          onChange={(e) => onIntervalChange(e.currentTarget.value)}
        >
          <For each={[...WATCHLIST_INTERVALS]}>{(iv) => <option value={iv}>{iv}</option>}</For>
        </select>
      </header>
      <SymbolModal
        open={symbolOpen()}
        initialQuery={store.symbol}
        onClose={() => setSymbolOpen(false)}
        onSelect={(sym) => {
          setSymbolOpen(false);
          commitSymbol(sym);
        }}
      />
    </>
  );
};

/** Mobile bottom tab bar — primary navigation. */
export const MobileTabBar: Component<MobileChromeProps> = (props) => {
  const chartTabActive = () =>
    !activeMobileSheet() && !panelsOpen() && !moreOpen() && !props.studioOpen();
  const tabClass = (active: () => boolean) => ({
    'is-active': active(),
  });

  return (
    <nav
      class="axis-mtabbar flex-shrink-0 flex items-stretch border-t-2 border-border bg-bg-panel"
      data-testid="axis-mobile-tabbar"
    >
      <button
        type="button"
        class="axis-mtab"
        classList={tabClass(chartTabActive)}
        data-testid="axis-mobile-tab-chart"
        onClick={goChart}
      >
        <Icons.barChart />
        <span>Chart</span>
      </button>
      <button
        type="button"
        class="axis-mtab"
        classList={tabClass(panelsOpen)}
        data-testid="axis-mobile-tab-panels"
        onClick={() => {
          setMoreOpen(false);
          setPanelsOpen((o) => !o);
        }}
      >
        <Icons.panelLeft />
        <span>Panels</span>
      </button>
      <button
        type="button"
        class="axis-mtab"
        classList={tabClass(() => activeMobileSheet() === 'editor')}
        data-testid="axis-mobile-tab-editor"
        onClick={openEditorSheet}
      >
        <Icons.book />
        <span>Editor</span>
      </button>
      <button
        type="button"
        class="axis-mtab"
        classList={tabClass(props.studioOpen)}
        data-testid="axis-mobile-tab-studio"
        onClick={() => {
          setPanelsOpen(false);
          setMoreOpen(false);
          props.onOpenStudio();
        }}
      >
        <Icons.cpu />
        <span>Studio</span>
      </button>
      <button
        type="button"
        class="axis-mtab"
        classList={tabClass(moreOpen)}
        data-testid="axis-mobile-tab-more"
        onClick={() => {
          setPanelsOpen(false);
          setMoreOpen((o) => !o);
        }}
      >
        <Icons.menu />
        <span>More</span>
      </button>
    </nav>
  );
};

/** Mobile overlay sheets — panels list + More drawer (+ symbol modal host). */
export const MobileOverlays: Component<MobileChromeProps> = (props) => {
  return (
    <>
      {/* ── Panels sheet (nav overlay above panel sheets) ──── */}
      <Show when={panelsOpen()}>
        <div class="axis-moverlay" data-testid="axis-mobile-panels" role="dialog" aria-label="Panels">
          <div class="axis-moverlay-head">
            <span class="axis-moverlay-title">Panels</span>
            <button
              type="button"
              class="axis-moverlay-close"
              aria-label="Close panels"
              onClick={() => setPanelsOpen(false)}
            >
              <Icons.x />
            </button>
          </div>
          <div class="axis-moverlay-body">
            <For each={MOBILE_PANELS}>
              {(id) => {
                const key = PANEL_ICON[id];
                const open = () => isPanelOpen(id);
                return (
                  <button
                    type="button"
                    class="axis-mpanel-row"
                    classList={{ 'is-open': open() }}
                    data-testid={`axis-mobile-panel-${id}`}
                    onClick={() => openPanelRow(id)}
                  >
                    <Show when={key ? Icons[key] : undefined} keyed>
                      {(IC) => <IC size={16} />}
                    </Show>
                    <span class="truncate">{PANEL_META[id].title}</span>
                    <span class="axis-mpanel-state">{open() ? 'Open' : ''}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* ── More drawer ────────────────────────────────────── */}
      <Show when={moreOpen()}>
        <div class="axis-moverlay" data-testid="axis-mobile-more" role="dialog" aria-label="More">
          <div class="axis-moverlay-head">
            <span class="axis-moverlay-title">More</span>
            <button
              type="button"
              class="axis-moverlay-close"
              aria-label="Close menu"
              onClick={() => setMoreOpen(false)}
            >
              <Icons.x />
            </button>
          </div>
          <div class="axis-moverlay-body">
            <button
              type="button"
              class="axis-mpanel-row"
              data-testid="axis-mobile-run"
              onClick={() => runScript(props.editorRef)}
            >
              <Icons.play size={16} />
              <span>Run script</span>
            </button>
            <button type="button" class="axis-mpanel-row" onClick={toggleLive}>
              <Icons.radio size={16} />
              <span>{store.live.active ? 'Stop live' : 'Start live'}</span>
            </button>
            <div class="axis-msep" role="separator" />
            <button
              type="button"
              class="axis-mpanel-row"
              onClick={() => {
                setMoreOpen(false);
                props.onOpenStudioPage('runtime');
              }}
            >
              <Icons.cpu size={16} />
              <span>Runtime</span>
            </button>
            <button
              type="button"
              class="axis-mpanel-row"
              onClick={() => {
                setMoreOpen(false);
                props.onOpenStudioPage('wire');
              }}
            >
              <Icons.layers size={16} />
              <span>Architecture</span>
            </button>
            <button
              type="button"
              class="axis-mpanel-row"
              onClick={() => {
                setMoreOpen(false);
                props.onOpenStudioPage('workers');
              }}
            >
              <Icons.database size={16} />
              <span>Workers</span>
            </button>
            <button
              type="button"
              class="axis-mpanel-row"
              onClick={() => {
                setMoreOpen(false);
                props.onOpenStudioPage('plugins');
              }}
            >
              <Icons.zap size={16} />
              <span>Plugins</span>
            </button>
            <button
              type="button"
              class="axis-mpanel-row"
              onClick={() => {
                setMoreOpen(false);
                props.onOpenStudioPage('settings');
              }}
            >
              <Icons.settings size={16} />
              <span>Settings</span>
            </button>
            <div class="axis-msep" role="separator" />
            <button type="button" class="axis-mpanel-row" onClick={toggleTheme}>
              <Icons.moon size={16} />
              <span>Toggle theme</span>
            </button>
            <button
              type="button"
              class="axis-mpanel-row"
              onClick={() => {
                setMoreOpen(false);
                openAboutModal();
              }}
            >
              <Icons.alert size={16} />
              <span>About AXIS</span>
            </button>
          </div>
        </div>
      </Show>
    </>
  );
};
