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
 * Language Feature Bar — chip per language-feature group.
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

  const menuDomId = (id: string) => `axis-editor-feature-menu-${id}`;

  const cancelPress = () => {
    if (pressTimer !== undefined) {
      window.clearTimeout(pressTimer);
      pressTimer = undefined;
    }
  };

  const clearSuppressSoon = () => {
    window.setTimeout(() => {
      suppressClick = false;
    }, 0);
  };

  const onChipDown = (e: PointerEvent, group: LanguageFeatureGroup) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    cancelPress();
    pressTimer = window.setTimeout(() => {
      pressTimer = undefined;
      suppressClick = true;
      setOpenId(group.id);
    }, FEATURE_BAR_LONG_PRESS_MS);
  };

  const onChipUpOrCancel = () => {
    cancelPress();
    clearSuppressSoon();
  };

  const onChipClick = (group: LanguageFeatureGroup) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // Click must not toggle while a menu is open: dismiss this chip's
    // popover, or switch to another chip's, without flipping a master switch.
    if (openId() === group.id) {
      setOpenId(null);
      return;
    }
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
    if (openId() === group.id) return;
    suppressClick = true;
    clearSuppressSoon();
    setOpenId(group.id);
  };

  // Close the popover on outside pointer-down / Escape.
  createEffect(() => {
    const id = openId();
    if (id === null) return;
    const menuId = menuDomId(id);
    queueMicrotask(() => {
      const menu = document.getElementById(menuId);
      if (!menu) return;
      const first = menu.querySelector('input');
      try {
        (first ?? menu).focus();
      } catch {
        /* jsdom / unmounted */
      }
    });
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (barEl && t && barEl.contains(t)) return;
      setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpenId(null);
        return;
      }
      if (e.key !== 'Tab') return;
      const menu = document.getElementById(menuId);
      if (!menu) return;
      const inputs = Array.from(menu.querySelectorAll('input'));
      if (inputs.length === 0) {
        e.preventDefault();
        menu.focus();
        return;
      }
      const first = inputs[0];
      const last = inputs[inputs.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === menu) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      if (openId() !== null) return;
      const chip = barEl?.querySelector(
        `[data-testid="axis-editor-feature-${id}"]`,
      ) as HTMLElement | null;
      if (!chip) return;
      const active = document.activeElement;
      if (active && active !== document.body && barEl && !barEl.contains(active)) return;
      try {
        chip.focus();
      } catch {
        /* jsdom / unmounted */
      }
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
              aria-controls={menuDomId(group.id)}
              onPointerDown={(e) => onChipDown(e, group)}
              onPointerUp={onChipUpOrCancel}
              onPointerCancel={onChipUpOrCancel}
              onPointerLeave={onChipUpOrCancel}
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
            id={menuDomId(group().id)}
            data-testid={`axis-editor-feature-menu-${group().id}`}
            role="dialog"
            aria-modal="true"
            aria-label={`${group().label} settings`}
            tabIndex={-1}
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
