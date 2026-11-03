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
 * Settings → Keyboard panel. Lets the user record a new chord for any
 * binding (capture-phase keydown via {@link useRecordChord}), shows
 * conflicts with other bindings, and exposes a Reset-to-defaults button.
 *
 * @module ui/shortcuts/Settings
 */

import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import { produce } from 'solid-js/store';
import { store, setStore, persist, resetShortcuts, setShortcutOverride } from '../../store';
import {
  AppButton,
  StudioChip,
  StudioHint,
  StudioSection,
  StudioStatus,
  useMicrofeedback,
} from '../studio';
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

const SCOPE_FILTERS: Array<{ id: 'all' | ShortcutDef['scope']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'app', label: 'App' },
  { id: 'editor', label: 'Editor' },
  { id: 'chart', label: 'Chart' },
  { id: 'palette', label: 'Palette' },
];

/** Settings → Keyboard: record / reset shortcut bindings. */
export const KeyboardSettingsPanel: Component = () => {
  const overrides = () => store.shortcuts?.overrides ?? {};
  const platform = detectPlatform();
  const [scopeFilter, setScopeFilter] = createSignal<'all' | ShortcutDef['scope']>('all');
  const resetFb = useMicrofeedback({ successHoldMs: 700 });

  // Dedupe aliased bindings (e.g. Alt-Shift-? / Alt-Shift-/ share one id).
  const uniqueBindings = createMemo(() => {
    const seen = new Set<string>();
    return DEFAULT_BINDINGS.filter((def) => {
      if (seen.has(def.id)) return false;
      seen.add(def.id);
      return true;
    });
  });

  const visibleBindings = createMemo(() => {
    const filter = scopeFilter();
    if (filter === 'all') return uniqueBindings();
    return uniqueBindings().filter((def) => def.scope === filter);
  });

  const conflicts = createMemo(() => detectConflicts(DEFAULT_BINDINGS, overrides()));

  // Scope per shortcut id — cross-scope pairs on one chord are intentional
  // layering (app.escape vs chart.cancel-draft), not conflicts to flag.
  const scopeOf = createMemo(() => {
    const m = new Map<string, ShortcutDef['scope']>();
    for (const def of DEFAULT_BINDINGS) if (!m.has(def.id)) m.set(def.id, def.scope);
    return m;
  });

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

  const overrideCount = createMemo(() => {
    const bag = overrides();
    let n = 0;
    for (const def of uniqueBindings()) {
      const v = bag[def.id];
      if (v != null && String(v).length > 0) n += 1;
    }
    return n;
  });

  const sameScopeConflictCount = createMemo(() => {
    const seen = new Set<string>();
    for (const def of uniqueBindings()) {
      const hits = conflictFor(def.id);
      if (hits.length > 0) seen.add(def.id);
    }
    return seen.size;
  });

  const { recording, start, stop } = useRecordChord((chord) => {
    const id = recordingId();
    if (id == null) return;
    setShortcutOverride(id, chord);
    setRecordingId(null);
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

  const platformLabel = () => (platform === 'mac' ? 'macOS' : platform === 'win' ? 'Windows' : 'Linux');

  return (
    <StudioSection
      title="Keyboard shortcuts"
      lead="Record a chord for any binding. Same-scope conflicts are flagged and still saved."
      testId="axis-settings-keyboard"
      headerEnd={
        <>
          <span class="ax-chip ax-chip--tag" data-testid="axis-keyboard-platform">
            {platformLabel()}
          </span>
          <span class="ax-chip ax-chip--tag" data-testid="axis-keyboard-override-count">
            {overrideCount()} override{overrideCount() === 1 ? '' : 's'}
          </span>
          <StudioStatus
            status={sameScopeConflictCount() > 0 ? 'degraded' : 'healthy'}
            label={
              sameScopeConflictCount() > 0
                ? `${sameScopeConflictCount()} conflict${sameScopeConflictCount() === 1 ? '' : 's'}`
                : 'No conflicts'
            }
          />
        </>
      }
    >
      <StudioHint>
        Esc records Escape while capturing. Cross-scope chords (e.g. App vs Chart) can share a key
        on purpose.
      </StudioHint>

      <div class="ax-toolbar">
        {/* biome-ignore lint/a11y/useSemanticElements: chip filter row matches Theme presets */}
        <div class="ax-chip-row" role="group" aria-label="Filter by scope">
          <For each={SCOPE_FILTERS}>
            {(f) => (
              <StudioChip
                pressed={scopeFilter() === f.id}
                testId={`axis-keyboard-scope-${f.id}`}
                onClick={() => setScopeFilter(f.id)}
              >
                {f.label}
              </StudioChip>
            )}
          </For>
        </div>
        <AppButton
          design="soft"
          tone="ghost"
          size="sm"
          testId="axis-keyboard-reset"
          feedback={resetFb.state()}
          disabled={overrideCount() === 0}
          title="Clear every custom chord"
          onClick={() =>
            void resetFb.run(async () => {
              cancelRecord();
              resetShortcuts();
            })
          }
        >
          Reset to defaults
        </AppButton>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
      <div class="axis-keyboard-table" role="table" aria-label="Keyboard shortcuts">
        {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: header row is a grouping wrapper, not interactive */}
        <div class="axis-keyboard-row axis-keyboard-head" role="row">
          {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: header cell is a grouping wrapper, not interactive */}
          <span role="columnheader">Binding</span>
          {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: header cell is a grouping wrapper, not interactive */}
          <span role="columnheader">Chord</span>
          {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: header cell is a grouping wrapper, not interactive */}
          <span role="columnheader">Actions</span>
        </div>
        <For each={visibleBindings()}>
          {(def) => {
            const chord = () => getDisplay(def.id, overrides(), platform);
            const isRecording = () => recording() && recordingId() === def.id;
            const hasOverride = () => {
              const v = overrides()[def.id];
              return v != null && String(v).length > 0;
            };
            const conflictsFor = () => conflictFor(def.id);
            return (
              // biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs
              // biome-ignore lint/a11y/useFocusableInteractive: row is a grouping wrapper, not interactive
              <div class="axis-keyboard-row" role="row" data-testid={`axis-keyboard-${def.id}`}>
                {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
                <span class="axis-keyboard-binding" role="cell">
                  <span class="axis-keyboard-title">{def.description}</span>
                  <span class="axis-keyboard-scope">{SCOPE_LABEL[def.scope]}</span>
                </span>
                {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
                <span class="axis-keyboard-chord" role="cell">
                  <Show when={isRecording()}>
                    <span
                      class="axis-keyboard-recording"
                      data-testid={`axis-keyboard-recording-${def.id}`}
                    >
                      Press a key… (Esc records Escape)
                    </span>
                  </Show>
                  <Show when={!isRecording() && chord()}>
                    <kbd class="sc-kbd">{chord()}</kbd>
                  </Show>
                  <Show when={!isRecording() && !chord()}>
                    <span class="sc-hint">—</span>
                  </Show>
                  <Show when={conflictsFor().length > 0}>
                    <span
                      class="axis-keyboard-conflict"
                      data-testid={`axis-keyboard-conflict-${def.id}`}
                    >
                      conflict with {conflictsFor().join(', ')}
                    </span>
                  </Show>
                </span>
                {/* biome-ignore lint/a11y/useSemanticElements: custom flex/grid table layout requires divs */}
                <span class="axis-keyboard-actions" role="cell">
                  <Show
                    when={isRecording()}
                    fallback={
                      <>
                        <AppButton
                          design="soft"
                          tone="ghost"
                          size="sm"
                          onClick={() => beginRecord(def.id)}
                          testId={`axis-keyboard-record-${def.id}`}
                        >
                          Record
                        </AppButton>
                        <Show when={hasOverride()}>
                          <AppButton
                            design="soft"
                            tone="ghost"
                            size="sm"
                            title="Restore the default chord for this binding"
                            testId={`axis-keyboard-restore-${def.id}`}
                            onClick={async () => {
                              setStore(
                                'shortcuts',
                                'overrides',
                                produce((bag) => {
                                  delete bag[def.id];
                                }),
                              );
                              persist();
                            }}
                          >
                            Restore
                          </AppButton>
                        </Show>
                      </>
                    }
                  >
                    <AppButton
                      design="soft"
                      tone="ghost"
                      size="sm"
                      onClick={cancelRecord}
                      testId={`axis-keyboard-cancel-${def.id}`}
                    >
                      Cancel
                    </AppButton>
                  </Show>
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </StudioSection>
  );
};
