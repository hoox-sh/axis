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
 * Settings → Keyboard panel. Lets the user record a new chord for any
 * binding (capture-phase keydown via {@link useRecordChord}), shows
 * conflicts with other bindings, and exposes a Reset-to-defaults button.
 *
 * @module ui/shortcuts/Settings
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { store, resetShortcuts, setShortcutOverride } from '../../store';
import { DEFAULT_BINDINGS, detectConflicts, getDisplay } from './registry';
import { detectPlatform } from './keys';
import { useRecordChord } from './use-record-chord';
import type { ShortcutDef } from './types';

const SCOPE_LABEL: Record<ShortcutDef['scope'], string> = {
  app: 'App',
  editor: 'Editor',
  chart: 'Chart',
  palette: 'Palette',
};

/** Settings → Keyboard: record / reset shortcut bindings. */
export const KeyboardSettingsPanel: Component = () => {
  const overrides = () => store.shortcuts?.overrides ?? {};
  const platform = detectPlatform();

  // Dedupe aliased bindings (e.g. Shift-? / Shift-/ share one id).
  const uniqueBindings = () => {
    const seen = new Set<string>();
    return DEFAULT_BINDINGS.filter((def) => {
      if (seen.has(def.id)) return false;
      seen.add(def.id);
      return true;
    });
  };

  const conflicts = createMemo(() => detectConflicts(DEFAULT_BINDINGS, overrides()));

  // Scope per shortcut id — cross-scope pairs on one chord are intentional
  // layering (app.escape vs chart.cancel-draft), not conflicts to flag.
  const scopeOf = createMemo(() => {
    const m = new Map<string, ShortcutDef['scope']>();
    for (const def of DEFAULT_BINDINGS) if (!m.has(def.id)) m.set(def.id, def.scope);
    return m;
  });

  const { recording, start, stop } = useRecordChord((chord) => {
    if (recordingId() != null) {
      setShortcutOverride(recordingId()!, chord);
      setRecordingId(null);
    }
  });

  const [recordingId, setRecordingId] = createSignal<string | null>(null);

  const beginRecord = (id: string) => {
    setRecordingId(id);
    start();
  };

  const cancelRecord = () => {
    setRecordingId(null);
    stop();
  };

  const conflictFor = (id: string): string[] => {
    const scope = scopeOf().get(id);
    const list: string[] = [];
    for (const ids of conflicts().values()) {
      if (!ids.includes(id) || ids.length < 2) continue;
      for (const other of ids) {
        if (other === id) continue;
        // Same scope only — cross-scope chords layer by design.
        if (scopeOf().get(other) === scope) list.push(other);
      }
    }
    return list;
  };

  return (
    <div class="flex flex-col gap-4" data-testid="axis-settings-keyboard">
      <div class="flex items-center justify-between gap-3">
        <div class="sc-hint">
          Record a chord for any binding. Conflicts are flagged but still saved — resolve them manually.
        </div>
        <button
          type="button"
          class="sc-btn sc-btn-ghost"
          onClick={() => resetShortcuts()}
          data-testid="axis-keyboard-reset"
        >
          Reset to defaults
        </button>
      </div>

      <div class="axis-keyboard-table" role="table" aria-label="Keyboard shortcuts">
        <div class="axis-keyboard-row axis-keyboard-head" role="row">
          <span role="columnheader">Binding</span>
          <span role="columnheader">Chord</span>
          <span role="columnheader">Actions</span>
        </div>
        <For each={uniqueBindings()}>
          {(def) => {
            const chord = getDisplay(def.id, overrides(), platform);
            const isRecording = () => recording() && recordingId() === def.id;
            const conflictsFor = conflictFor(def.id);
            return (
              <div class="axis-keyboard-row" role="row" data-testid={`axis-keyboard-${def.id}`}>
                <span class="axis-keyboard-binding" role="cell">
                  <span class="axis-keyboard-title">{def.description}</span>
                  <span class="axis-keyboard-scope">{SCOPE_LABEL[def.scope]}</span>
                </span>
                <span class="axis-keyboard-chord" role="cell">
                  <Show when={isRecording()}>
                    <span class="axis-keyboard-recording" data-testid={`axis-keyboard-recording-${def.id}`}>
                      Press a key… (Esc records Escape)
                    </span>
                  </Show>
                  <Show when={!isRecording() && chord}>
                    <kbd class="sc-kbd">{chord}</kbd>
                  </Show>
                  <Show when={!isRecording() && !chord}>
                    <span class="sc-hint">—</span>
                  </Show>
                  <Show when={conflictsFor.length > 0}>
                    <span class="axis-keyboard-conflict" data-testid={`axis-keyboard-conflict-${def.id}`}>
                      conflict with {conflictsFor.join(', ')}
                    </span>
                  </Show>
                </span>
                <span class="axis-keyboard-actions" role="cell">
                  <Show
                    when={isRecording()}
                    fallback={
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost sc-btn-sm"
                        onClick={() => beginRecord(def.id)}
                        data-testid={`axis-keyboard-record-${def.id}`}
                      >
                        Record
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost sc-btn-sm"
                      onClick={cancelRecord}
                      data-testid={`axis-keyboard-cancel-${def.id}`}
                    >
                      Cancel
                    </button>
                  </Show>
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};