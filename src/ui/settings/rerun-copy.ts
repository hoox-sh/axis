// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Honest copy for Settings → Indicator re-run.
 *
 * The stored preference can say "each price update" while Server-Side, Edge,
 * and a guest chart on a full history only evaluate at candle close. The
 * control has to show that, or the badges' "@ last close" looks like a bug.
 *
 * @module ui/settings/rerun-copy
 */

export interface IndicatorRerunInput {
  stored: 'every-tick' | 'bar-close';
  /** False when the active engine advertised bar-close only. */
  engineAllowsEveryTick: boolean;
  barCount: number;
  heavyBars: number;
  /** Authenticated engine stream can still tick a heavy chart. */
  streamAuthenticated: boolean;
}

export interface IndicatorRerunPresentation {
  /** Value the select should display. */
  shown: 'every-tick' | 'bar-close';
  everyTickEnabled: boolean;
  hint: string;
}

const BAR_CLOSE_HINT =
  'This engine updates at candle close. Server-Side, Edge, and a full guest history do not re-run on every price print — chart values stay at the last close.';

const EVERY_TICK_HINT =
  'Bar close uses venue closed flags or bar time advance. Each price update re-runs while the candle is forming.';

/** What Settings should show for the indicator re-run control. */
export function indicatorRerunPresentation(input: IndicatorRerunInput): IndicatorRerunPresentation {
  const heavyGuest = !input.streamAuthenticated && input.barCount >= input.heavyBars;
  const forced = !input.engineAllowsEveryTick || heavyGuest;
  const shown: 'every-tick' | 'bar-close' =
    input.stored === 'bar-close' || forced ? 'bar-close' : 'every-tick';
  return {
    shown,
    everyTickEnabled: !forced,
    hint: forced ? BAR_CLOSE_HINT : EVERY_TICK_HINT,
  };
}
