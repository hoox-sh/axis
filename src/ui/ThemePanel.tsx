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
 * Chart Theme Manager panel — presets + per-token editors for any component group.
 *
 * Live-applies bar colors, canvas (`chart.bg_color` / `chart.fg_color`), grid,
 * scales, volume, and series tokens via store helpers.
 *
 * Pine Script™ host colors:
 * - `chart.bg_color` (alias `chart.color_background`)
 * - `chart.fg_color` (alias `chart.color_foreground`)
 *
 * @module ui/ThemePanel
 */

import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import {
  store,
  setChartThemePreset,
  setChartThemeToken,
  resetChartTheme,
} from '../store';
import {
  THEME_GROUPS,
  tokensForGroup,
  listPresets,
  resolveTokens,
  defaultChartThemeState,
  getTokenDef,
  type ThemeTokenDef,
  type ThemeTokenValue,
} from '../theme';

export interface ThemePanelProps {
  /** Compact spacing for Settings embed. */
  compact?: boolean;
}

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
    value.trim(),
  );
}

/** Expand #rgb / strip alpha for `<input type="color">` (#rrggbb only). */
function toColorInputValue(value: string): string {
  const s = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]!;
    const g = s[2]!;
    const b = s[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-fA-F]{4}$/.test(s)) {
    const r = s[1]!;
    const g = s[2]!;
    const b = s[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#000000';
}

/** Official Pine alias note under bg/fg tokens. */
function pineAliasFor(key: string): string | null {
  if (key === 'chart.bg_color') return 'chart.color_background';
  if (key === 'chart.fg_color') return 'chart.color_foreground';
  return null;
}

function tokenTestId(key: string): string {
  return `axis-theme-token-${key.replace(/\./g, '-')}`;
}

/** Full chart theme editor (presets + grouped tokens). */
export const ThemePanel: Component<ThemePanelProps> = (props) => {
  const themeState = createMemo(() => store.chartTheme || defaultChartThemeState());
  const tokens = createMemo(() => resolveTokens(themeState()));
  const presets = createMemo(() => listPresets());
  const groups = createMemo(() =>
    THEME_GROUPS.map((g) => ({ ...g, defs: tokensForGroup(g.id) })).filter(
      (g) => g.defs.length > 0,
    ),
  );

  const activePresetId = () => themeState().presetId;
  const overrideCount = () => Object.keys(themeState().overrides || {}).length;

  return (
    <div
      class={`sc-settings-content ${props.compact ? 'sc-settings-content--compact' : ''}`}
      data-testid="axis-theme-panel"
    >
      {/* ── Presets ─────────────────────────────────────────────── */}
      <div class="sc-settings-section">
        <div class="sc-settings-section-title">Presets</div>
        <div class="sc-chip-row" role="group" aria-label="Chart theme presets">
          <For each={presets()}>
            {(p) => (
              <button
                type="button"
                class={`sc-chip ${activePresetId() === p.id ? 'is-active' : ''}`}
                aria-pressed={activePresetId() === p.id}
                title={p.description || p.name}
                data-testid={`axis-theme-preset-${p.id}`}
                onClick={() => setChartThemePreset(p.id)}
              >
                {p.name}
              </button>
            )}
          </For>
          <Show when={activePresetId() === 'custom'}>
            <span class="sc-chip is-active" aria-pressed={true} title="Edited tokens">
              Custom
            </span>
          </Show>
        </div>
        <div class="sc-settings-btn-row mt-1">
          <button
            type="button"
            class="sc-btn sc-btn-ghost text-[0.85em]"
            data-testid="axis-theme-reset"
            title="Clear overrides and restore the active named preset"
            onClick={() => resetChartTheme()}
          >
            Reset to preset
          </button>
          <Show when={overrideCount() > 0}>
            <span class="sc-settings-field-hint m-0">
              {overrideCount()} override{overrideCount() === 1 ? '' : 's'}
            </span>
          </Show>
        </div>
        <p class="sc-settings-field-hint mt-1">
          Pine host colors:{' '}
          <code class="font-mono text-[0.9em]">chart.bg_color</code> /{' '}
          <code class="font-mono text-[0.9em]">chart.fg_color</code>
          {' · '}
          aliases{' '}
          <code class="font-mono text-[0.9em]">chart.color_background</code>,{' '}
          <code class="font-mono text-[0.9em]">chart.color_foreground</code>
        </p>
      </div>

      {/* ── Token groups ────────────────────────────────────────── */}
      <For each={groups()}>
        {(group) => (
          <div class="sc-settings-section">
            <div class="sc-settings-section-title">{group.label}</div>
            <Show when={group.description}>
              <p class="sc-settings-field-hint mt-0 mb-0.5">{group.description}</p>
            </Show>
            <div class={`flex flex-col ${props.compact ? 'gap-2' : 'gap-2.5'}`}>
              <For each={group.defs}>
                {(def) => (
                  <TokenField
                    def={def}
                    value={tokens()[def.key] ?? def.default}
                    compact={!!props.compact}
                    onChange={(v) => setChartThemeToken(def.key, v)}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};

interface TokenFieldProps {
  def: ThemeTokenDef;
  value: ThemeTokenValue;
  compact: boolean;
  onChange: (value: ThemeTokenValue) => void;
}

const TokenField: Component<TokenFieldProps> = (props) => {
  const id = () => `axis-theme-${props.def.key.replace(/\./g, '-')}`;
  const pineAlias = () => pineAliasFor(props.def.key);
  const colorStr = () => String(props.value ?? '');
  const showColorPicker = () => isHexColor(colorStr());

  // Draft text so intermediate rgba/hex typing is not wiped by coerce rejects
  const [colorDraft, setColorDraft] = createSignal(colorStr());
  createEffect(() => {
    setColorDraft(colorStr());
  });

  const commitColor = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    const def = getTokenDef(props.def.key);
    if (def?.type === 'color') {
      if (
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) ||
        /^(rgb|rgba|hsl|hsla)\(/i.test(s) ||
        /^[a-zA-Z]+$/.test(s)
      ) {
        props.onChange(s);
      }
    } else {
      props.onChange(s);
    }
  };

  return (
    <div class="sc-settings-field" data-testid={tokenTestId(props.def.key)}>
      <div class="flex items-center justify-between gap-2 min-w-0">
        <label class="sc-settings-field-label truncate" for={id()}>
          {props.def.label}
        </label>
        <Show when={props.def.type === 'boolean'}>
          <input
            id={id()}
            type="checkbox"
            class="accent-[var(--color-accent)]"
            checked={!!props.value}
            aria-label={props.def.label}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
          />
        </Show>
      </div>

      <Show when={props.def.type === 'color'}>
        <div class="sc-settings-color-row">
          <Show when={showColorPicker()}>
            <input
              type="color"
              class="sc-settings-color-swatch"
              value={toColorInputValue(colorStr())}
              aria-label={`${props.def.label} color picker`}
              onInput={(e) => props.onChange(e.currentTarget.value)}
            />
          </Show>
          <input
            id={id()}
            class="sc-input font-mono text-[0.85em] flex-1 min-w-0"
            type="text"
            spellcheck={false}
            value={colorDraft()}
            placeholder="#rrggbb, rgba(…), or color name"
            aria-label={props.def.label}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setColorDraft(v);
              commitColor(v);
            }}
            onBlur={(e) => commitColor(e.currentTarget.value)}
          />
        </div>
      </Show>

      <Show when={props.def.type === 'number'}>
        <div class="flex items-center gap-2">
          <input
            class="sc-range flex-1"
            type="range"
            min={props.def.min ?? 0}
            max={props.def.max ?? 10}
            step={props.def.step ?? 1}
            value={Number(props.value)}
            aria-label={props.def.label}
            onInput={(e) => props.onChange(Number(e.currentTarget.value))}
          />
          <input
            id={id()}
            class="sc-input font-mono text-[0.85em] w-14 shrink-0"
            type="number"
            min={props.def.min}
            max={props.def.max}
            step={props.def.step ?? 1}
            value={Number(props.value)}
            onInput={(e) => props.onChange(Number(e.currentTarget.value))}
          />
        </div>
      </Show>

      <Show when={props.def.pine || pineAlias()}>
        <p class="sc-settings-field-hint font-mono text-[0.72em]">
          {props.def.pine ? `Pine: ${props.def.pine}` : null}
          {props.def.pine && pineAlias() ? ' · ' : null}
          {pineAlias() ? `alias: ${pineAlias()}` : null}
        </p>
      </Show>
      <Show when={props.def.description && !props.def.pine && !props.compact}>
        <p class="sc-settings-field-hint">{props.def.description}</p>
      </Show>
    </div>
  );
};
