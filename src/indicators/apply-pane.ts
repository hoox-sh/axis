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
 * Apply stage 2 — indicator pane setup (F-25).
 *
 * Ensures the target pane exists (price for overlays, private sub-pane
 * otherwise), migrates off the legacy shared pane, and drops orphans.
 * Extracted from `runAndApplyInner`; returns the resolved pane id.
 *
 * @module indicators/apply-pane
 */

import {
  addPane,
  removePane,
  newEntityId,
  store,
  EDITOR_RUN_KEY,
} from '../store';
import type { Indicator } from '../store/types';
import type { PaneManager } from '../chart/pane-manager';
import { reportUiError } from '../ui/boot-errors';

export interface PaneSetupContext {
  overlay: boolean;
  existing: Indicator | undefined;
  indicatorId: string | undefined;
  scriptName: string;
  manager: PaneManager;
  storePanes: typeof store.panes;
  storeScripts: typeof store.scripts;
}

export function ensureApplyPane(ctx: PaneSetupContext): string {
  const existing = ctx.existing as Indicator | undefined;
  let paneId = 'price';
  /** Previous sub-pane when migrating off the legacy shared `indicator` pane. */
  let previousSubPane: string | null = null;
  if (!ctx.overlay) {
    // One sub-pane per non-ctx.overlay script (not a single shared `indicator` pane).
    // Re-runs keep the script’s existing private pane; first run / legacy shared
    // pane gets a stable `ind_<scriptId>` host so RSI + MACD stack as separate panes.
    const reserved = new Set(['price', 'volume']);
    const legacyShared = 'indicator';
    if (
      existing?.paneId &&
      !reserved.has(existing.paneId) &&
      existing.paneId !== legacyShared
    ) {
      paneId = existing.paneId;
    } else {
      const key = ctx.indicatorId || newEntityId();
      paneId = `ind_${String(key).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 56)}`;
      if (existing?.paneId === legacyShared) previousSubPane = legacyShared;
    }
    try {
      if (!ctx.manager.getPane(paneId)) {
        addPane('indicator', ctx.scriptName, { id: paneId, height: 140 });
        ctx.manager.createPane(paneId, 'indicator', ctx.scriptName, 140);
        ctx.manager.syncTimeScales();
      } else {
        try {
          ctx.manager.setVisible?.(paneId, true);
          ctx.manager.setLabel(paneId, ctx.scriptName);
        } catch {
          /* ignore */
        }
      }
      // Migrating off legacy shared pane — drop this script’s series there
      if (previousSubPane && previousSubPane !== paneId) {
        try {
          const owner = ctx.indicatorId ?? EDITOR_RUN_KEY;
          if (typeof ctx.manager.removeOverlaysForOwner === 'function') {
            ctx.manager.removeOverlaysForOwner(previousSubPane, owner);
          }
        } catch {
          /* ignore */
        }
        // Destroy legacy shared pane when no scripts still reference it
        if (
          !ctx.storeScripts.some(
            (s) => s.paneId === previousSubPane && s.id !== ctx.indicatorId,
          )
        ) {
          try {
            ctx.manager.destroyPane(previousSubPane);
          } catch {
            /* ignore */
          }
          if (ctx.storePanes.some((p) => p.id === previousSubPane)) {
            try {
              removePane(previousSubPane);
            } catch {
              /* ignore */
            }
          }
        }
      }
      // Drop orphan ctx.store panes left empty without a manager pane / script.
      // Never treat the pane we just created for this run as an orphan (script
      // may not be in ctx.storeScripts until after apply).
      for (const p of [...store.panes]) {
        if (
          p.type === 'indicator' &&
          p.id !== paneId &&
          !ctx.manager.getPane(p.id) &&
          !ctx.storeScripts.some((s) => s.paneId === p.id)
        ) {
          try {
            removePane(p.id);
          } catch {
            /* ignore */
          }
        }
      }
      // Also destroy orphan ctx.manager panes that have no scripts
      for (const mp of ctx.manager.getAllPanes()) {
        if (
          mp.type === 'indicator' &&
          mp.id !== paneId &&
          !ctx.storeScripts.some((s) => s.paneId === mp.id)
        ) {
          try {
            ctx.manager.destroyPane(mp.id);
            if (ctx.storePanes.some((p) => p.id === mp.id)) removePane(mp.id);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e: unknown) {
      // Chart disposed / host unmounted mid-apply — fall back to price if present
      reportUiError(e, {
        source: 'run',
        context: 'Indicator pane setup failed',
        status: false,
      });
      paneId = ctx.manager.getPane('price') ? 'price' : paneId;
    }
  } else if (existing?.paneId && existing.paneId !== 'price' && existing.paneId !== 'volume') {
    // Was a sub-pane script, now true ctx.overlay — clear stale series on old pane
    try {
      const owner = ctx.indicatorId ?? EDITOR_RUN_KEY;
      if (typeof ctx.manager.removeOverlaysForOwner === 'function') {
        ctx.manager.removeOverlaysForOwner(existing.paneId, owner);
      } else {
        ctx.manager.removeOverlays(existing.paneId);
      }
      // Destroy empty private sub-pane
      if (
        !ctx.storeScripts.some(
          (s) => s.paneId === existing.paneId && s.id !== ctx.indicatorId,
        )
      ) {
        try {
          ctx.manager.destroyPane(existing.paneId);
        } catch {
          /* ignore */
        }
        if (ctx.storePanes.some((p) => p.id === existing.paneId)) {
          try {
            removePane(existing.paneId);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return paneId;
}
