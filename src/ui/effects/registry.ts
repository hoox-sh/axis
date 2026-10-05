// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Built-in UI effects. Add a definition here, then read it with `effectMs`
 * / `effectParam` where the motion runs. Settings lists whatever is registered.
 *
 * @module ui/effects/registry
 */

import type { EffectDef } from './types';

const ms = (value: number) => `${Math.round(value)}ms`;
const pct = (value: number) => `${Math.round(value)}%`;

/**
 * Watchlist row tint when the last price changes.
 * Duration stays inside the shell cap of 200ms. Strengths match the
 * original 32% up / 28% down mix.
 */
export const WATCHLIST_TICK: EffectDef = {
  id: 'watchlist.tick',
  label: 'Watchlist tick flash',
  summary: 'Tint a row when its last price changes.',
  enabled: true,
  preview: {
    sampleClass: 'axis-wl-row axis-fx-sample',
    upClass: 'is-flash-up',
    downClass: 'is-flash-down',
  },
  params: [
    {
      id: 'durationMs',
      label: 'Duration',
      hint: 'How long the tint lasts. Capped at 200 ms.',
      min: 40,
      max: 200,
      step: 10,
      default: 180,
      unit: 'ms',
      cssVar: 'axis-fx-watchlist-tick-duration',
      toCss: ms,
    },
    {
      id: 'upStrength',
      label: 'Up flash',
      hint: 'Green tint when the price rises.',
      min: 0,
      max: 64,
      step: 1,
      default: 32,
      unit: '%',
      cssVar: 'axis-fx-watchlist-tick-up',
      toCss: pct,
    },
    {
      id: 'downStrength',
      label: 'Down flash',
      hint: 'Red tint when the price falls.',
      min: 0,
      max: 64,
      step: 1,
      default: 28,
      unit: '%',
      cssVar: 'axis-fx-watchlist-tick-down',
      toCss: pct,
    },
  ],
};

/**
 * Panel open — smooth, clean, snappy slide + fade.
 * Compositor-only, so the plot never reflows mid-motion. Duration and slide
 * share the shell cap of 200ms; disabled or reduced motion writes 0
 * (instant snap). Replaces the old `travelPx` tune — unknown stored ids
 * are dropped silently by `sanitizeTunes`.
 */
export const PANEL_OPEN: EffectDef = {
  id: 'panel.open',
  label: 'Panel open',
  summary: 'Smooth slide + fade — fast, clean, snappy.',
  enabled: true,
  params: [
    {
      id: 'durationMs',
      label: 'Duration',
      hint: 'How long the engage sequence lasts. Capped at 200 ms.',
      min: 40,
      max: 200,
      step: 10,
      default: 180,
      unit: 'ms',
      cssVar: 'axis-fx-panel-open-duration',
      toCss: ms,
    },
    {
      id: 'slidePct',
      label: 'Slide',
      hint: 'How far off-edge the slide starts, in percent of the panel. 0 fades only.',
      min: 0,
      max: 100,
      step: 5,
      default: 100,
      unit: '%',
      cssVar: 'axis-fx-panel-open-slide',
      toCss: pct,
    },
  ],
};

export const BUILTIN_EFFECTS: readonly EffectDef[] = [WATCHLIST_TICK, PANEL_OPEN];
