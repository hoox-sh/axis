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
