/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor intelligence bag: defaults, clamps, severity filters.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  DEFAULT_EDITOR_INTEL,
  DEFAULT_PREEVAL_IDLE_MS,
  INTEL_IDLE_MS_MAX,
  INTEL_IDLE_MS_MIN,
  intelShowsSeverity,
  readEditorIntel,
} from '../src/editor/editor-intel';
import { patchEditorIntel, resetEditorIntel, store } from '../src/store';
import { isScriptRunBlocked, localPreevaluate } from '../src/editor/preevaluate';

describe('readEditorIntel', () => {
  it('fills defaults from empty / null', () => {
    expect(readEditorIntel(null)).toEqual(DEFAULT_EDITOR_INTEL);
    expect(readEditorIntel(undefined).preevalIdleMs).toBe(DEFAULT_PREEVAL_IDLE_MS);
  });

  it('clamps idle / timeout / max options', () => {
    const bag = readEditorIntel({
      preevalIdleMs: 10,
      hoverTimeoutMs: 99_000,
      maxRenderedOptions: 2,
    });
    expect(bag.preevalIdleMs).toBe(INTEL_IDLE_MS_MIN);
    expect(bag.hoverTimeoutMs).toBeLessThanOrEqual(8_000);
    expect(bag.maxRenderedOptions).toBeGreaterThanOrEqual(8);
    expect(INTEL_IDLE_MS_MAX).toBeGreaterThan(INTEL_IDLE_MS_MIN);
  });

  it('preserves explicit booleans', () => {
    const bag = readEditorIntel({
      hoverEnabled: false,
      autocompleteEnabled: false,
      preevalTypos: false,
    });
    expect(bag.hoverEnabled).toBe(false);
    expect(bag.autocompleteEnabled).toBe(false);
    expect(bag.preevalTypos).toBe(false);
    expect(bag.preevalEnabled).toBe(true);
  });
});

describe('intelShowsSeverity', () => {
  it('honors per-severity flags', () => {
    const all = DEFAULT_EDITOR_INTEL;
    expect(intelShowsSeverity(all, 'error')).toBe(true);
    expect(intelShowsSeverity({ ...all, diagTypos: false }, 'typo')).toBe(false);
    expect(intelShowsSeverity({ ...all, diagWarnings: false }, 'warning')).toBe(false);
  });
});

describe('editor intel gates pre-eval', () => {
  beforeEach(() => {
    resetEditorIntel();
  });

  it('skips local checks when preeval is off', () => {
    patchEditorIntel({ preevalEnabled: false });
    const diags = localPreevaluate('plot(close)\n');
    expect(diags).toEqual([]);
  });

  it('skips typos when preevalTypos is off', () => {
    patchEditorIntel({ preevalTypos: false });
    const src = '//@version=6\nindicator("t")\nplt(close)\n';
    expect(localPreevaluate(src).some((d) => /plt/.test(d.message))).toBe(false);
    resetEditorIntel();
    expect(localPreevaluate(src).some((d) => /plt/.test(d.message))).toBe(true);
  });

  it('does not block Run when preevalBlockRun is off', () => {
    store.preEval.hasErrors = true;
    store.preEval.pending = false;
    expect(isScriptRunBlocked()).toBe(true);
    patchEditorIntel({ preevalBlockRun: false });
    expect(isScriptRunBlocked()).toBe(false);
    resetEditorIntel();
    store.preEval.hasErrors = false;
  });
});
