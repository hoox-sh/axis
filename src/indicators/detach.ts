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
 * Detach an applied indicator from the chart without wrecking sibling scripts.
 *
 * Guarantees:
 * - Owner-scoped series/markers/drawings/fills/barcolor removed (siblings stay)
 * - Overlay scripts also clear price-pane owner keys
 * - Sub-pane destroyed only when empty; store pane row cleaned up
 * - No leftover empty private panes
 *
 * @module indicators/detach
 */

import { store, removeIndicator, removePane, setLastRun, EDITOR_RUN_KEY } from '../store';
import {
  getManager,
  clearScriptPaneLayer,
  clearScriptPaneLayers,
  getDrawingLayer,
  getActiveDrawingLayer,
} from '../chart/manager-access';
import { clearScriptChartOverlays } from './visibility';

/**
 * Clear chart series for one script, remove it from the store, and destroy its
 * sub-pane only when no other scripts still use that paneId.
 */
export function detachIndicatorFromChart(id: string): void {
  if (!id) return;
  const script = store.scripts.find((s) => s.id === id);
  if (!script) {
    // Still try store cleanup (series cache / runResults)
    try {
      removeIndicator(id);
    } catch {
      /* ignore */
    }
    return;
  }

  const paneId = script.paneId || 'price';
  const manager = getManager();
  const isSubPane = paneId !== 'price' && paneId !== 'volume';

  if (manager) {
    // Same owner-scoped overlay / drawing / fill / barcolor path as hide.
    // Pine geometry is keyed by script id, so a sibling on the chart must not
    // keep this script's lines after delete.
    try {
      clearScriptChartOverlays(id, paneId);
    } catch {
      /* chart dispose races */
    }
    // Overlay scripts paint on price — also scrub any private sub-pane leftovers
    if (paneId === 'price') {
      try {
        const privateId = `ind_${String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 56)}`;
        if (manager.getPane?.(privateId)) {
          if (typeof manager.removeOverlaysForOwner === 'function') {
            manager.removeOverlaysForOwner(privateId, id);
          }
          const still = store.scripts.some(
            (s) => s.id !== id && s.paneId === privateId,
          );
          if (!still) {
            try {
              manager.destroyPane(privateId);
            } catch {
              /* ignore */
            }
            if (store.panes.some((p) => p.id === privateId)) {
              try {
                removePane(privateId);
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  removeIndicator(id);

  // Drop orphan editor-preview run cache so table HUD cannot keep lastRun tables
  // after the chart script that produced them is gone.
  try {
    if (!store.scripts.some((s) => s.id === id)) {
      // removeIndicator already deleted runResults[id]; if nothing applied left,
      // clear editor key leftovers that still hold drawings/tables.
      if ((store.scripts || []).length === 0) {
        setLastRun(null, { scriptId: EDITOR_RUN_KEY });
        setLastRun(null, { scriptId: id });
        const layer = getActiveDrawingLayer() ?? getDrawingLayer();
        layer?.clearScriptDrawings?.();
        layer?.clearPlotFills?.();
        clearScriptPaneLayers?.();
      }
    }
  } catch {
    /* optional */
  }

  const remaining = store.scripts.filter((s) => s.paneId === paneId);
  if (manager && isSubPane && remaining.length === 0) {
    try {
      manager.destroyPane(paneId);
    } catch {
      /* ignore */
    }
    if (store.panes.some((p) => p.id === paneId)) {
      try {
        removePane(paneId);
      } catch {
        /* ignore */
      }
    }
    try {
      clearScriptPaneLayer?.(paneId);
    } catch {
      /* optional */
    }
  }

  // Sweep orphan empty indicator panes (no scripts, not price/volume)
  try {
    if (manager && typeof manager.getAllPanes === 'function') {
      for (const mp of manager.getAllPanes()) {
        if (mp.type !== 'indicator') continue;
        if (store.scripts.some((s) => s.paneId === mp.id)) continue;
        try {
          manager.destroyPane(mp.id);
        } catch {
          /* ignore */
        }
        try {
          clearScriptPaneLayer?.(mp.id);
        } catch {
          /* optional */
        }
        if (store.panes.some((p) => p.id === mp.id)) {
          try {
            removePane(mp.id);
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    manager?.refreshBadges?.(paneId);
    if (paneId !== 'price') manager?.refreshBadges?.('price');
  } catch {
    /* optional */
  }
}
