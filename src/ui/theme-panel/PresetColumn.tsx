// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Preset picker and saved-theme library.
 * Subscribes to the active preset id and the override bag's keys, not each
 * token value.
 *
 * @module ui/theme-panel/PresetColumn
 */

import { For, Show } from 'solid-js';
import { store, setChartThemePreset, resetChartTheme } from '../../store';
import { COMMUNITY_PRESETS, listPresets, type ThemePreset } from '../../theme';
import { AppButton, StudioChip, StudioHint, StudioSection, useMicrofeedback } from '../studio';
import { SavedThemeLibrary } from '../ThemeLibrary';

const PRESETS = listPresets();
const BRAND_IDS = new Set(['void-dark', 'volt', 'signal', 'void-light']);
const COMMUNITY_IDS = new Set(COMMUNITY_PRESETS.map((p) => p.id));

type PresetBand = { id: string; label: string; items: ThemePreset[] };

/** Walk catalog order and cut it into Brand / Boutique / Community bands. */
function presetBands(presets: readonly ThemePreset[]): PresetBand[] {
  const bands: PresetBand[] = [];
  for (const preset of presets) {
    const id = BRAND_IDS.has(preset.id)
      ? 'brand'
      : COMMUNITY_IDS.has(preset.id)
        ? 'community'
        : 'boutique';
    const label = id === 'brand' ? 'Brand' : id === 'community' ? 'Community' : 'Boutique';
    const last = bands[bands.length - 1];
    if (!last || last.id !== id) bands.push({ id, label, items: [preset] });
    else last.items.push(preset);
  }
  return bands;
}

const BANDS = presetBands(PRESETS);

const SIGNAL_SWATCHES = [
  '--color-up',
  '--color-down',
  '--color-warning',
  '--color-info',
  '--color-series-1',
  '--color-series-2',
  '--color-series-3',
  '--color-series-4',
  '--color-series-5',
  '--color-series-6',
] as const;

/** Left column: named presets, reset, and the saved-theme library. */
export function PresetColumn(): JSX.Element {
  const presetId = () => store.chartTheme?.presetId ?? 'void-dark';
  const overrideCount = () => Object.keys(store.chartTheme?.overrides ?? {}).length;
  const activePresetLabel = () => {
    const id = presetId();
    if (id === 'custom') return 'Custom';
    return PRESETS.find((p) => p.id === id)?.name ?? id;
  };
  const resetDisabled = () => overrideCount() === 0 && presetId() !== 'custom';
  const resetFb = useMicrofeedback({ successHoldMs: 700 });

  return (
    <div class="ax-split-col">
      <StudioSection
        title="Presets"
        lead="Base palette for the chart. Edits after a pick become Custom overrides."
        headerEnd={
          <div class="ax-theme-status" aria-live="polite">
            <span class="ax-chip ax-chip--tag" data-testid="axis-theme-active-preset">
              {activePresetLabel()}
            </span>
            <Show when={overrideCount() > 0}>
              <span class="ax-chip ax-chip--tag" data-testid="axis-theme-override-count">
                {overrideCount()} override{overrideCount() === 1 ? '' : 's'}
              </span>
            </Show>
          </div>
        }
      >
        {/* biome-ignore lint/a11y/useSemanticElements: fieldset would inject UA border/padding styles into the chip row */}
        <div class="ax-theme-bands" role="group" aria-label="Chart theme presets">
          <For each={BANDS}>
            {(band) => (
              <div class="ax-theme-band">
                <p class="ax-theme-band-label">{band.label}</p>
                <div class="ax-chip-row">
                  <For each={band.items}>
                    {(p) => (
                      <StudioChip
                        pressed={presetId() === p.id}
                        title={p.description || p.name}
                        onClick={() => setChartThemePreset(p.id)}
                      >
                        {p.name}
                      </StudioChip>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
          <Show when={presetId() === 'custom'}>
            <div class="ax-chip-row">
              <StudioChip pressed title="Custom overrides on the shell palette">
                Custom
              </StudioChip>
            </div>
          </Show>
        </div>
        <div class="ax-toolbar">
          <AppButton
            design="soft"
            tone="ghost"
            size="sm"
            testId="axis-theme-reset"
            feedback={resetFb.state()}
            title="Clear overrides and restore Void Dark or Void Light from the shell theme"
            disabled={resetDisabled()}
            onClick={() =>
              void resetFb.run(async () => {
                resetChartTheme();
              })
            }
          >
            Reset to preset
          </AppButton>
        </div>
        <StudioHint>
          Reset restores Void Dark or Void Light from the shell theme, not the last named preset.
        </StudioHint>
        <StudioHint>
          Pine host colors: <code class="ax-mono">chart.bg_color</code> /{' '}
          <code class="ax-mono">chart.fg_color</code>
        </StudioHint>
        <StudioHint>Prices, volume, and timestamps use tabular lining figures.</StudioHint>
        <div
          data-testid="axis-theme-figures"
          aria-hidden="true"
          style={{
            display: 'grid',
            'grid-template-columns': 'auto minmax(0, 1fr) auto',
            gap: 'var(--ui-gap-xs) var(--ui-gap)',
            'margin-top': 'var(--ui-gap-xs)',
            'max-width': '100%',
            'font-family': 'var(--font-figure, var(--font-sans))',
            'font-variant-numeric': 'var(--ui-figure-variant, tabular-nums lining-nums)',
            'font-feature-settings': '"tnum" 1, "lnum" 1',
          }}
        >
          <span style={{ 'font-size': 'var(--ui-type-time)', color: 'var(--color-text-dim)' }}>
            09:41:02
          </span>
          <span
            style={{
              'font-size': 'var(--ui-type-price)',
              'font-weight': 'var(--ui-type-price-weight, 600)',
              'text-align': 'right',
            }}
          >
            67,432.50
          </span>
          <span
            style={{
              'font-size': 'var(--ui-type-price)',
              color: 'var(--color-up)',
              'text-align': 'right',
            }}
          >
            +128.40
          </span>
          <span style={{ 'font-size': 'var(--ui-type-time)', color: 'var(--color-text-dim)' }}>
            09:41:08
          </span>
          <span style={{ 'font-size': 'var(--ui-type-price)', 'text-align': 'right' }}>
            67,304.10
          </span>
          <span
            style={{
              'font-size': 'var(--ui-type-price)',
              color: 'var(--color-down)',
              'text-align': 'right',
            }}
          >
            −128.40
          </span>
          <span
            style={{
              'grid-column': '1 / -1',
              'font-size': 'var(--ui-type-volume)',
              color: 'var(--color-text-dim)',
            }}
          >
            Vol 1,284.50
          </span>
        </div>
        <div
          data-testid="axis-theme-signals"
          role="img"
          aria-label="Market, status, and series colors"
          style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: 'var(--ui-gap-xs)',
            'margin-top': 'var(--ui-gap-xs)',
          }}
        >
          <For each={SIGNAL_SWATCHES}>
            {(token) => (
              <span
                title={token}
                style={{
                  width: 'var(--ui-space-16, 16px)',
                  height: 'var(--ui-space-16, 16px)',
                  'border-radius': 'var(--radius-chip, 2px)',
                  background: `var(${token})`,
                  border: '1px solid var(--color-border)',
                }}
              />
            )}
          </For>
        </div>
      </StudioSection>

      <StudioSection
        title="Saved themes"
        lead="Name the live chart colors. Each save embeds the current bar coloring."
      >
        <SavedThemeLibrary />
      </StudioSection>
    </div>
  );
}
