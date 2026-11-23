// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One theme token control. Reads only that token's preset id, base, and
 * override so a sibling edit does not hand the field a new value.
 *
 * @module ui/theme-panel/TokenField
 */

import { Show, createMemo } from 'solid-js';
import { store, setChartThemeToken } from '../../store';
import { getToken, type ThemeTokenDef, type ThemeTokenValue } from '../../theme';
import { StudioColorInput, StudioField, StudioInput, StudioToggle } from '../studio';

/** Official Pine alias note under bg/fg tokens. */
function pineAliasFor(key: string): string | null {
  if (key === 'chart.bg_color') return 'chart.color_background';
  if (key === 'chart.fg_color') return 'chart.color_foreground';
  return null;
}

function tokenTestId(key: string): string {
  return `axis-theme-token-${key.replace(/\./g, '-')}`;
}

/**
 * Resolved value for one catalog key.
 * Reads `overrides[key]` only — not the rest of the bag, and not library state.
 */
function readTokenValue(def: ThemeTokenDef): ThemeTokenValue {
  const theme = store.chartTheme;
  const presetId = theme?.presetId ?? 'void-dark';
  const base = theme?.base === 'light' ? 'light' : 'dark';
  const raw = theme?.overrides?.[def.key];
  return getToken(
    {
      presetId,
      base,
      overrides: raw === undefined ? {} : { [def.key]: raw },
      barThemeId: null,
    },
    def.key,
  );
}

/**
 * Color, number, or switch for a single catalog token.
 * The field subscribes to its own value; the grid parent does not.
 */
export function TokenField(props: { def: ThemeTokenDef }) {
  const value = createMemo(() => readTokenValue(props.def));
  const id = () => `axis-theme-${props.def.key.replace(/\./g, '-')}`;
  const pineAlias = () => pineAliasFor(props.def.key);
  const pineHint = () => {
    const pine = props.def.pine;
    const alias = pineAlias();
    if (!pine && !alias) return undefined;
    return (
      <span class="ax-mono">
        {pine ? `Pine: ${pine}` : null}
        {pine && alias ? ' · ' : null}
        {alias ? `alias: ${alias}` : null}
      </span>
    );
  };

  return (
    <div
      class="ax-field ax-token-field"
      data-kind={props.def.type}
      data-testid={tokenTestId(props.def.key)}
    >
      <Show when={props.def.type === 'boolean'}>
        <StudioToggle
          id={id()}
          checked={!!value()}
          label={props.def.label}
          hint={pineHint()}
          onChange={(checked) => setChartThemeToken(props.def.key, checked)}
        />
      </Show>

      <Show when={props.def.type === 'color'}>
        <StudioField label={props.def.label} for={id()} hint={pineHint() ?? props.def.description}>
          <StudioColorInput
            id={id()}
            value={String(value() ?? '')}
            onChange={(v) => setChartThemeToken(props.def.key, v)}
          />
        </StudioField>
      </Show>

      <Show when={props.def.type === 'number'}>
        <StudioField label={props.def.label} for={id()} hint={pineHint() ?? props.def.description}>
          <StudioInput
            id={id()}
            type="number"
            mono
            value={Number(value())}
            min={props.def.min}
            max={props.def.max}
            step={props.def.step ?? 1}
            selectOnFocus
            onInput={(v) => setChartThemeToken(props.def.key, Number(v))}
          />
        </StudioField>
      </Show>
    </div>
  );
}
