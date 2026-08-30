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
 * Workspace snapshot export / import controls for Settings.
 *
 * Export downloads a JSON snapshot (chrome, drawings, scripts metadata, layout).
 * Import parses first; only on success + user confirm does it apply — failed
 * parse never mutates the store.
 */

import { Component, createSignal, Show } from 'solid-js';
import { reconcile } from 'solid-js/store';
import {
  store,
  setStore,
  flushPersist,
  setStatus,
  setUiScale,
  clampHistoryBars,
  clampUiScale,
  appendLog,
} from '../store';
import { normalizeChartType } from '../chart/chart-type';
import { normalizeChartLayout } from '../chart/layout';
import type { Indicator } from '../store/types';
import type { PanelId } from './panels/types';
import { defaultPanelChromeMap } from './panels/types';
import { Icons } from './icons';
import {
  applyWorkspaceSnapshot,
  buildWorkspaceSnapshot,
  defaultSnapshotFilename,
  downloadSnapshot,
  parseSnapshotJson,
  WorkspaceSnapshotParseError,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotApplyFields,
  type WorkspaceSnapshotSetters,
} from '../storage/workspace-snapshot';

/** Build store setters used by applyWorkspaceSnapshot (side effects + setStore). */
export function createLiveWorkspaceSetters(): WorkspaceSnapshotSetters {
  return {
    assign(fields: WorkspaceSnapshotApplyFields) {
      if (fields.symbol != null) setStore('symbol', fields.symbol);
      if (fields.interval != null) setStore('interval', fields.interval);
      if (fields.exchange != null) setStore('exchange', fields.exchange);
      if (fields.chartType != null) setStore('chartType', normalizeChartType(fields.chartType));
      if (fields.historyBars != null) {
        setStore('historyBars', clampHistoryBars(fields.historyBars));
      }

      if (fields.chartLayout) {
        const next = normalizeChartLayout(fields.chartLayout, {
          symbol: fields.symbol || store.symbol,
          interval: fields.interval || store.interval,
          exchange: fields.exchange || store.exchange,
          chartType: normalizeChartType(fields.chartType || store.chartType),
        });
        setStore('chartLayout', next);
        const active = next.slots.find((s) => s.id === next.activeId) || next.slots[0];
        if (active) {
          setStore('symbol', active.symbol);
          setStore('interval', active.interval);
          setStore('exchange', active.exchange);
          setStore('chartType', normalizeChartType(active.chartType));
        }
      }

      if (fields.savedLayouts) {
        setStore('savedLayouts', fields.savedLayouts);
      }

      if (fields.panes) {
        setStore(
          'panes',
          fields.panes.map((p) => ({ ...p })),
        );
      }

      if (fields.drawings) {
        setStore('drawings', fields.drawings);
      }
      if (fields.drawingPrefs) {
        setStore('drawingPrefs', { ...store.drawingPrefs, ...fields.drawingPrefs });
      }
      if (fields.drawingUi) {
        const ui = fields.drawingUi;
        if (ui.magnet === 'off' || ui.magnet === 'weak' || ui.magnet === 'strong') {
          setStore('drawingUi', 'magnet', ui.magnet);
        }
        if (typeof ui.stayInMode === 'boolean') setStore('drawingUi', 'stayInMode', ui.stayInMode);
        if (typeof ui.hideDrawings === 'boolean') {
          setStore('drawingUi', 'hideDrawings', ui.hideDrawings);
        }
        if (typeof ui.lockAll === 'boolean') setStore('drawingUi', 'lockAll', ui.lockAll);
        if (ui.lastToolByGroup && typeof ui.lastToolByGroup === 'object') {
          setStore('drawingUi', 'lastToolByGroup', reconcile({ ...ui.lastToolByGroup }));
        }
      }

      if (fields.panelChrome) {
        const base = { ...defaultPanelChromeMap(), ...store.panelChrome };
        for (const id of Object.keys(fields.panelChrome) as PanelId[]) {
          const patch = fields.panelChrome[id];
          if (!patch) continue;
          base[id] = { ...base[id], ...patch };
          // Dual-write legacy flat flags for open/width where applicable
          if (id === 'watchlist') {
            setStore('watchlist', 'open', !!patch.open);
            if (typeof patch.w === 'number') setStore('watchlist', 'width', patch.w);
          }
          if (id === 'indicators') {
            setStore('indicatorPanel', 'open', !!patch.open);
            if (typeof patch.w === 'number') setStore('indicatorPanel', 'width', patch.w);
          }
          if (id === 'editor') {
            setStore('editor', 'open', !!patch.open);
            if (typeof patch.w === 'number') setStore('editor', 'width', patch.w);
            if (patch.dock === 'window') setStore('editor', 'mode', 'popout');
            else if (patch.dock === 'right' || patch.dock === 'left') {
              setStore('editor', 'mode', 'docked');
            }
          }
          if (id === 'logs') {
            setStore('logsPanel', 'open', !!patch.open);
            if (typeof patch.h === 'number') setStore('logsPanel', 'height', patch.h);
          }
          if (id === 'dataview') {
            setStore('dataViewPanel', 'open', !!patch.open);
            if (typeof patch.w === 'number') setStore('dataViewPanel', 'width', patch.w);
          }
          if (id === 'layers') {
            setStore('layerPanel', 'open', !!patch.open);
            if (typeof patch.w === 'number') setStore('layerPanel', 'width', patch.w);
          }
        }
        setStore('panelChrome', reconcile(base));
      }

      if (fields.theme === 'dark' || fields.theme === 'light') {
        setStore('theme', fields.theme);
      }

      if (fields.uiScale != null) {
        setStore('uiScale', clampUiScale(fields.uiScale));
      }

      if (fields.editorPrefs) {
        const ep = fields.editorPrefs;
        if (typeof ep.profilerEnabled === 'boolean') {
          setStore('profilerEnabled', ep.profilerEnabled);
        }
        if (typeof ep.inlineDebugEnabled === 'boolean') {
          setStore('inlineDebugEnabled', ep.inlineDebugEnabled);
        }
        if (typeof ep.editorOpen === 'boolean') setStore('editor', 'open', ep.editorOpen);
        if (typeof ep.editorWidth === 'number') setStore('editor', 'width', ep.editorWidth);
        if (ep.editorMode === 'docked' || ep.editorMode === 'popout') {
          setStore('editor', 'mode', ep.editorMode);
        }
      }

      if (fields.scripts) {
        const next: Indicator[] = fields.scripts.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code || '',
          paneId: s.paneId || 'price',
          visible: s.visible !== false,
          plots: s.plots || {},
          inputValues: s.inputValues,
        }));
        setStore('scripts', next);
      }

      if (fields.bars) {
        setStore('bars', fields.bars);
        setStore('chartDataGen', (g) => (g || 0) + 1);
      }
    },
    applyTheme(theme) {
      if (typeof document !== 'undefined') {
        try {
          document.documentElement.setAttribute('data-theme', theme);
        } catch {
          /* ignore */
        }
      }
    },
    applyUiScale(scale) {
      setUiScale(scale);
    },
  };
}

function emitReflow() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('axis-chart-reflow'));
  } catch {
    /* ignore */
  }
}

/** Compact export / import row for Settings → Workspace. */
export const WorkspaceSnapshotMenu: Component = () => {
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal('');
  const [err, setErr] = createSignal('');
  let fileInput: HTMLInputElement | undefined;

  const onExport = () => {
    setErr('');
    setMsg('');
    try {
      const snap = buildWorkspaceSnapshot(store, {
        includeBars: false,
        name: `${store.symbol || 'workspace'}-${store.interval || '1d'}`,
      });
      downloadSnapshot(snap, defaultSnapshotFilename(snap));
      setMsg('Workspace exported');
      setStatus('ready', 'Workspace snapshot downloaded');
      appendLog('ok', 'Workspace snapshot exported', 'workspace');
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      setStatus('error', `Export failed · ${m}`);
    }
  };

  const confirmApply = (snap: WorkspaceSnapshot): boolean => {
    if (typeof window === 'undefined') return true;
    const scriptsN = snap.scripts?.length ?? 0;
    const drawingsN = snap.drawings?.length ?? 0;
    const when = snap.createdAt ? ` · ${snap.createdAt.slice(0, 19)}` : '';
    return window.confirm(
      `Import workspace snapshot?\n\n` +
        `${snap.symbol} ${snap.interval} · ${snap.chartType}${when}\n` +
        `${drawingsN} drawing(s) · ${scriptsN} script(s)\n\n` +
        `This replaces chrome, drawings, scripts list, and chart layout fields present in the file.\n` +
        `OHLCV bars are ${snap.bars?.length ? 'included' : 'not included'}.`,
    );
  };

  const onImportFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Always clear so re-selecting the same file works
    const resetInput = () => {
      input.value = '';
    };
    if (!file) return;

    setBusy(true);
    setErr('');
    setMsg('');

    let text: string;
    try {
      text = await file.text();
    } catch (readErr: unknown) {
      setBusy(false);
      resetInput();
      const m = readErr instanceof Error ? readErr.message : String(readErr);
      setErr(m);
      setStatus('error', `Import read failed · ${m}`);
      return;
    }

    // Parse first — never touch store on failure
    let snap: WorkspaceSnapshot;
    try {
      snap = parseSnapshotJson(text);
    } catch (parseErr: unknown) {
      setBusy(false);
      resetInput();
      const m =
        parseErr instanceof WorkspaceSnapshotParseError
          ? parseErr.message
          : parseErr instanceof Error
            ? parseErr.message
            : String(parseErr);
      setErr(`Invalid snapshot: ${m}`);
      setStatus('error', `Import aborted · ${m}`);
      appendLog('warn', `Workspace import parse failed: ${m}`, 'workspace');
      return;
    }

    if (!confirmApply(snap)) {
      setBusy(false);
      resetInput();
      setMsg('Import cancelled');
      return;
    }

    try {
      applyWorkspaceSnapshot(snap, createLiveWorkspaceSetters());
      flushPersist();
      emitReflow();
      setMsg(`Imported · ${snap.symbol} ${snap.interval}`);
      setStatus('ready', `Workspace imported · ${snap.symbol} ${snap.interval}`);
      appendLog('ok', `Workspace snapshot imported (${snap.symbol} ${snap.interval})`, 'workspace');
    } catch (applyErr: unknown) {
      const m = applyErr instanceof Error ? applyErr.message : String(applyErr);
      setErr(m);
      setStatus('error', `Import apply failed · ${m}`);
      appendLog('error', `Workspace import apply failed: ${m}`, 'workspace');
    } finally {
      setBusy(false);
      resetInput();
    }
  };

  return (
    <div class="ax-stack ax-stack--tight" data-testid="axis-workspace-snapshot">
      <div class="ax-inline">
        <button
          type="button"
          class="ax-btn ax-btn--ghost"
          data-testid="axis-workspace-export"
          title="Download full workspace snapshot as JSON (no OHLCV bars)"
          disabled={busy()}
          onClick={onExport}
        >
          <Icons.download />
          Export workspace
        </button>
        <button
          type="button"
          class="ax-btn ax-btn--ghost"
          data-testid="axis-workspace-import"
          title="Import a previously exported workspace JSON"
          disabled={busy()}
          onClick={() => fileInput?.click()}
        >
          <Icons.upload />
          Import workspace
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          class="hidden"
          data-testid="axis-workspace-import-input"
          onChange={(e) => void onImportFile(e)}
        />
      </div>
      <p class="ax-hint">
        Snapshot includes symbol, layout, panel chrome, drawings, theme/scale, editor prefs, and
        applied scripts. Bars are omitted by default. Import confirms before applying; invalid
        files never wipe your data.
      </p>
      <Show when={msg()}>
        <p class="ax-hint ax-hint--accent ax-mono" data-testid="axis-workspace-snapshot-msg">
          {msg()}
        </p>
      </Show>
      <Show when={err()}>
        <p class="ax-error ax-mono" data-testid="axis-workspace-snapshot-err">
          {err()}
        </p>
      </Show>
    </div>
  );
};
