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
 * **Language Feature Bar** — one row above the editor status strip with a
 * chip per language-feature group (hover / signature / complete / lint /
 * marks / chips / remote).
 *
 * - Colored (`is-active`) while the feature is **firing** (open card / list /
 *   hint, running check, rendered marks) — not merely switched on — so the
 *   bar shows which features the current script actually uses, and which
 *   could be disabled (dimmed `is-off` while switched off).
 * - Click toggles the group's master switch.
 * - Long-press (~{@link FEATURE_BAR_LONG_PRESS_MS}) or right-click opens a
 *   popover with the group's full settings.
 * - Visibility itself is a persisted setting (`editorFeatureBarEnabled`,
 *   “Language Feature Bar” in Settings → Editor intelligence).
 *
 * Activity is polled off the parent's {@link LanguageFeatureBarProps.getActivity}
 * (tooltips / completion open and close outside Solid).
 *
 * @module editor/LanguageFeatureBar
 */

import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { getEditorIntel, patchEditorIntel, store } from '../store';
import { readEditorIntel } from './editor-intel';
import {
  FEATURE_BAR_LONG_PRESS_MS,
  FEATURE_BAR_POLL_MS,
  IDLE_FEATURE_ACTIVITY,
  LANGUAGE_FEATURE_GROUPS,
  type FeatureActivity,
  type FeatureSetting,
  type LanguageFeatureGroup,
} from './language-features';

function clampNum(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

const FeatureMenuRow: Component<{ setting: FeatureSetting }> = (props) => {
  const intel = () => getEditorIntel();
  const setting = props.setting;
  if (setting.kind === 'toggle') {
    const key = setting.key;
    return (
      <label class="axis-editor-feature-menu-check" title={setting.hint || setting.label}>
        <input
          type="checkbox"
          checked={Boolean(intel()[key])}
          onChange={(e) => {
            patchEditorIntel({ [key]: e.currentTarget.checked } as never);
          }}
        />
        <span>{setting.label}</span>
      </label>
    );
  }
  const num = setting;
  // Draft the raw keystrokes while focused and only clamp + commit on
  // blur / Enter — clamping on every onChange snapped below-min values
  // (e.g. typing "250" into a 400 → immediately "50") and made them
  // un-typable.
  const [draft, setDraft] = createSignal<string | null>(null);
  const commit = (input: HTMLInputElement) => {
    const raw = (draft() ?? '').trim();
    setDraft(null);
    if (!raw) {
      input.value = String(intel()[num.key] as number);
      return;
    }
    const fallback = intel()[num.key] as number;
    const next = clampNum(raw, num.min, num.max, fallback);
    if (next !== fallback) patchEditorIntel({ [num.key]: next } as never);
  };
  return (
    <label class="axis-editor-feature-menu-num" title={num.hint || num.label}>
      <span>{num.label}</span>
      <input
        type="number"
        min={num.min}
        max={num.max}
        step={num.step ?? 50}
        value={draft() ?? String(intel()[num.key] as number)}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => commit(e.currentTarget)}
      />
      <span class="axis-editor-feature-menu-suffix">{num.suffix || ''}</span>
    </label>
  );
};

export interface LanguageFeatureBarProps {
  /** Live activity snapshot (polled — tooltips / completion change outside Solid). */
  getActivity: () => FeatureActivity;
}

export const LanguageFeatureBar: Component<LanguageFeatureBarProps> = (props) => {
  const intel = () => getEditorIntel();
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [snapshot, setSnapshot] = createSignal<FeatureActivity>({
    ...IDLE_FEATURE_ACTIVITY,
  });
  const openGroup = (): LanguageFeatureGroup | undefined =>
    LANGUAGE_FEATURE_GROUPS.find((g) => g.id === openId());

  const refresh = () => {
    try {
      setSnapshot({ ...props.getActivity() });
    } catch {
      setSnapshot({ ...IDLE_FEATURE_ACTIVITY });
    }
  };

  onMount(() => {
    refresh();
    const timer = window.setInterval(refresh, FEATURE_BAR_POLL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  // Intel flips (e.g. toggles from this bar's own menus) refresh immediately.
  createEffect(() => {
    void readEditorIntel(store.editorIntel);
    refresh();
  });

  let barEl: HTMLDivElement | undefined;
  let pressTimer: number | undefined;
  let suppressClick = false;

  const cancelPress = () => {
    if (pressTimer !== undefined) {
      window.clearTimeout(pressTimer);
      pressTimer = undefined;
    }
  };

  const onChipDown = (e: PointerEvent, group: LanguageFeatureGroup) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    cancelPress();
    pressTimer = window.setTimeout(() => {
      pressTimer = undefined;
      suppressClick = true;
      setOpenId((cur) => (cur === group.id ? null : group.id));
    }, FEATURE_BAR_LONG_PRESS_MS);
  };

  const onChipClick = (group: LanguageFeatureGroup) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // A menu already open on this chip: this click dismisses the popover —
    // it must not flip the group's master switch (long-press opens, the most
    // natural dismissal is a short press on the same chip).
    if (openId() === group.id) {
      setOpenId(null);
      return;
    }
    // A popover open on another chip: switch the popover to this chip
    // without flipping its master switch — otherwise comparing settings
    // across chips toggles features unintentionally. A second click (with
    // this chip's popover open) dismisses; toggling happens only when no
    // popover is open.
    if (openId() !== null) {
      setOpenId(group.id);
      return;
    }
    patchEditorIntel({ [group.masterKey]: !intel()[group.masterKey] } as never);
    refresh();
  };

  const onChipContext = (e: MouseEvent, group: LanguageFeatureGroup) => {
    e.preventDefault();
    cancelPress();
    setOpenId((cur) => (cur === group.id ? null : group.id));
  };

  // Close the popover on outside pointer-down / Escape.
  createEffect(() => {
    if (openId() === null) return;
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (barEl && t && barEl.contains(t)) return;
      setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey);
    });
  });

  onCleanup(cancelPress);

  return (
    <div
      ref={barEl}
      class="axis-editor-featurebar"
      data-testid="axis-editor-featurebar"
      role="toolbar"
      aria-label="Language features"
    >
      <For each={LANGUAGE_FEATURE_GROUPS}>
        {(group) => {
          const active = () => snapshot()[group.activityKey];
          const enabled = () => Boolean(intel()[group.masterKey]);
          return (
            <button
              type="button"
              class={`axis-editor-status-btn ${active() ? 'is-active' : ''} ${enabled() ? '' : 'is-off'}`}
              data-testid={`axis-editor-feature-${group.id}`}
              data-active={active() ? 'true' : 'false'}
              title={`${group.label}: ${active() ? 'active now' : enabled() ? 'on (idle)' : 'off'} — ${group.hint}`}
              aria-pressed={enabled()}
              aria-expanded={openId() === group.id}
              onPointerDown={(e) => onChipDown(e, group)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onClick={() => onChipClick(group)}
              onContextMenu={(e) => onChipContext(e, group)}
            >
              {group.label}
            </button>
          );
        }}
      </For>
      <Show when={openGroup()}>
        {(group) => (
          <div
            class="axis-editor-feature-menu"
            data-testid={`axis-editor-feature-menu-${group().id}`}
            role="dialog"
            aria-label={`${group().label} settings`}
          >
            <div class="axis-editor-feature-menu-title">{group().label} settings</div>
            <For each={group().settings}>
              {(setting) => <FeatureMenuRow setting={setting} />}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
};
