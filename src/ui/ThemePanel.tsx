// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart Theme Manager panel — presets + per-token editors for any component group.
 *
 * Live-applies bar colors, canvas (`chart.bg_color` / `chart.fg_color`), grid,
 * scales, volume, and series tokens via store helpers.
 *
 * Uses the same studio design primitives (`ax-*`) as the rest of the studio
 * modal so the Theme page shares one visual language with Runtime / Wire /
 * Workers / Plugins. Color tokens use one {@link StudioColorInput}: swatch
 * picker plus a field that accepts hex, rgb(), rgba(), and Pine `color.*` enums.
 *
 * Pine Script™ host colors:
 * - `chart.bg_color` (alias `chart.color_background`)
 * - `chart.fg_color` (alias `chart.color_foreground`)
 *
 * @module ui/ThemePanel
 */

import { For, Show, createMemo } from 'solid-js';
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
  type ThemeTokenDef,
  type ThemeTokenValue,
} from '../theme';
import {
  StudioButton,
  StudioChip,
  StudioColorInput,
  StudioField,
  StudioHint,
  StudioInput,
  StudioSection,
  StudioToggle,
} from './studio';

export interface ThemePanelProps {
  /** Compact spacing for Settings embed. */
  compact?: boolean;
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
export const ThemePanel = (props: ThemePanelProps) => {
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
      class={`ax-stack ${props.compact ? 'ax-stack--compact' : ''}`}
      data-testid="axis-theme-panel"
    >
      {/* ── Presets ─────────────────────────────────────────────── */}
      <StudioSection
        title="Presets"
        lead="Switch the base palette. Any edit after that becomes a Custom override."
      >
        <div class="ax-chip-row" role="group" aria-label="Chart theme presets">
          <For each={presets()}>
            {(p) => (
              <StudioChip
                pressed={activePresetId() === p.id}
                title={p.description || p.name}
                onClick={() => setChartThemePreset(p.id)}
              >
                {p.name}
              </StudioChip>
            )}
          </For>
          <Show when={activePresetId() === 'custom'}>
            <StudioChip pressed>Custom</StudioChip>
          </Show>
        </div>
        <div class="ax-inline ax-mt">
          <StudioButton
            variant="ghost"
            testId="axis-theme-reset"
            title="Clear overrides and restore the active named preset"
            onClick={() => resetChartTheme()}
          >
            Reset to preset
          </StudioButton>
          <Show when={overrideCount() > 0}>
            <StudioHint>{overrideCount()} override{overrideCount() === 1 ? '' : 's'}</StudioHint>
          </Show>
        </div>
        <StudioHint>
          Pine host colors: <code class="ax-mono">chart.bg_color</code> /{' '}
          <code class="ax-mono">chart.fg_color</code> · aliases{' '}
          <code class="ax-mono">chart.color_background</code>,{' '}
          <code class="ax-mono">chart.color_foreground</code>
        </StudioHint>
      </StudioSection>

      {/* ── Token groups ────────────────────────────────────────── */}
      <For each={groups()}>
        {(group) => (
          <StudioSection title={group.label} lead={group.description}>
            <div class="ax-token-grid">
              <For each={group.defs}>
                {(def) => (
                  <TokenField
                    def={def}
                    value={tokens()[def.key] ?? def.default}
                    onChange={(v) => setChartThemeToken(def.key, v)}
                  />
                )}
              </For>
            </div>
          </StudioSection>
        )}
      </For>
    </div>
  );
};

interface TokenFieldProps {
  def: ThemeTokenDef;
  value: ThemeTokenValue;
  onChange: (value: ThemeTokenValue) => void;
}

const TokenField = (props: TokenFieldProps) => {
  const id = () => `axis-theme-${props.def.key.replace(/\./g, '-')}`;
  const pineAlias = () => pineAliasFor(props.def.key);

  return (
    <div class="ax-field" data-testid={tokenTestId(props.def.key)}>
      <Show when={props.def.type === 'boolean'}>
        <StudioToggle
          id={id()}
          checked={!!props.value}
          label={props.def.label}
          hint={
            props.def.pine || pineAlias() ? (
              <span class="ax-mono">
                {props.def.pine ? `Pine: ${props.def.pine}` : null}
                {props.def.pine && pineAlias() ? ' · ' : null}
                {pineAlias() ? `alias: ${pineAlias()}` : null}
              </span>
            ) : undefined
          }
          onChange={(checked) => props.onChange(checked)}
        />
      </Show>

      <Show when={props.def.type === 'color'}>
        <StudioField
          label={props.def.label}
          for={id()}
          hint={
            props.def.pine || pineAlias() ? (
              <span class="ax-mono">
                {props.def.pine ? `Pine: ${props.def.pine}` : null}
                {props.def.pine && pineAlias() ? ' · ' : null}
                {pineAlias() ? `alias: ${pineAlias()}` : null}
              </span>
            ) : props.def.description ? (
              props.def.description
            ) : undefined
          }
        >
          <StudioColorInput
            id={id()}
            value={String(props.value ?? '')}
            onChange={(v) => props.onChange(v)}
          />
        </StudioField>
      </Show>

      <Show when={props.def.type === 'number'}>
        <StudioField
          label={props.def.label}
          for={id()}
          hint={
            props.def.pine || pineAlias() ? (
              <span class="ax-mono">
                {props.def.pine ? `Pine: ${props.def.pine}` : null}
                {props.def.pine && pineAlias() ? ' · ' : null}
                {pineAlias() ? `alias: ${pineAlias()}` : null}
              </span>
            ) : props.def.description ? (
              props.def.description
            ) : undefined
          }
        >
          <StudioInput
            id={id()}
            type="number"
            mono
            value={Number(props.value)}
            min={props.def.min}
            max={props.def.max}
            step={props.def.step ?? 1}
            onInput={(v) => props.onChange(Number(v))}
          />
        </StudioField>
      </Show>
    </div>
  );
};
