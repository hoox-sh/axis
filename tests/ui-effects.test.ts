// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from 'bun:test';
import { WATCHLIST_TICK } from '../src/ui/effects/registry';
import {
  clampEffectParam,
  effectCssVars,
  sanitizeTunes,
} from '../src/ui/effects/resolve';
import {
  UI_EFFECTS_STORAGE_KEY,
  _resetUiEffectsForTests,
  _setReducedMotionForTests,
  effectMs,
  effectParam,
  installUiEffects,
  resetEffect,
  setEffectEnabled,
  setEffectParam,
} from '../src/ui/effects/manager';
import { installDocumentStub, installMemoryLocalStorage } from './setup';

describe('ui effect resolve', () => {
  const duration = WATCHLIST_TICK.params.find((p) => p.id === 'durationMs');
  const up = WATCHLIST_TICK.params.find((p) => p.id === 'upStrength');
  if (!duration || !up) throw new Error('watchlist tick params missing');

  it('clamps and snaps the watchlist flash', () => {
    expect(clampEffectParam(duration, 180)).toBe(180);
    expect(clampEffectParam(duration, 999)).toBe(200);
    expect(clampEffectParam(duration, 1)).toBe(40);
    expect(clampEffectParam(duration, 186)).toBe(190);
    expect(clampEffectParam(up, Number.NaN)).toBe(32);
  });

  it('writes default CSS and zeroes a disabled or reduced effect', () => {
    const defs = [WATCHLIST_TICK];
    expect(effectCssVars(defs, {}, false)).toEqual({
      '--axis-fx-watchlist-tick-duration': '180ms',
      '--axis-fx-watchlist-tick-up': '32%',
      '--axis-fx-watchlist-tick-down': '28%',
    });
    expect(effectCssVars(defs, { 'watchlist.tick': { enabled: false } }, false)[
      '--axis-fx-watchlist-tick-duration'
    ]).toBe('0ms');
    expect(effectCssVars(defs, { 'watchlist.tick': { params: { durationMs: 120 } } }, true)[
      '--axis-fx-watchlist-tick-up'
    ]).toBe('0%');
  });

  it('sanitize drops unknown effects and default-equal values', () => {
    const clean = sanitizeTunes(
      {
        'nope.flash': { enabled: false },
        'watchlist.tick': {
          enabled: true,
          params: { durationMs: 500, upStrength: 'loud', downStrength: 28 },
        },
      },
      [WATCHLIST_TICK],
    );
    expect(clean).toEqual({
      'watchlist.tick': { params: { durationMs: 200 } },
    });
  });
});

describe('ui effect manager', () => {
  beforeEach(() => {
    installDocumentStub();
    installMemoryLocalStorage();
    installUiEffects();
    _resetUiEffectsForTests();
  });

  it('paints defaults, then a tune, then reset', () => {
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--axis-fx-watchlist-tick-duration')).toBe('180ms');
    expect(effectMs('watchlist.tick')).toBe(180);

    setEffectParam('watchlist.tick', 'durationMs', 120);
    setEffectParam('watchlist.tick', 'upStrength', 48);
    expect(effectParam('watchlist.tick', 'durationMs')).toBe(120);
    expect(root.style.getPropertyValue('--axis-fx-watchlist-tick-duration')).toBe('120ms');
    expect(root.style.getPropertyValue('--axis-fx-watchlist-tick-up')).toBe('48%');
    expect(localStorage.getItem(UI_EFFECTS_STORAGE_KEY)).toContain('120');

    resetEffect('watchlist.tick');
    expect(effectMs('watchlist.tick')).toBe(180);
    expect(localStorage.getItem(UI_EFFECTS_STORAGE_KEY)).toBeNull();
  });

  it('turning the effect off yields a zero timer without dropping the saved duration', () => {
    setEffectParam('watchlist.tick', 'durationMs', 80);
    setEffectEnabled('watchlist.tick', false);
    expect(effectMs('watchlist.tick')).toBe(0);
    expect(effectParam('watchlist.tick', 'durationMs')).toBe(80);
    expect(document.documentElement.style.getPropertyValue('--axis-fx-watchlist-tick-duration')).toBe(
      '0ms',
    );

    setEffectEnabled('watchlist.tick', true);
    expect(effectMs('watchlist.tick')).toBe(80);
  });

  it('reduced motion pauses playback and keeps the tune', () => {
    setEffectParam('watchlist.tick', 'downStrength', 40);
    _setReducedMotionForTests(true);
    expect(effectMs('watchlist.tick')).toBe(0);
    expect(document.documentElement.style.getPropertyValue('--axis-fx-watchlist-tick-down')).toBe(
      '0%',
    );
    expect(effectParam('watchlist.tick', 'downStrength')).toBe(40);
  });
});
