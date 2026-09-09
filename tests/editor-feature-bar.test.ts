/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Language Feature Bar: group definitions stay in sync with the intel
 * settings surface, and the bar visibility flag persists.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  DEFAULT_EDITOR_INTEL,
} from '../src/editor/editor-intel';
import {
  getEditorIntel,
  patchEditorIntel,
  resetEditorIntel,
  setEditorFeatureBarEnabled,
  store,
  toggleEditorFeatureBarEnabled,
} from '../src/store';
import {
  FEATURE_BAR_LONG_PRESS_MS,
  IDLE_EDITOR_ACTIVITY,
  IDLE_FEATURE_ACTIVITY,
  LANGUAGE_FEATURE_GROUPS,
  deriveFeatureActivity,
  featureGroupById,
} from '../src/editor/language-features';

beforeEach(() => {
  resetEditorIntel();
  setEditorFeatureBarEnabled(true);
});

describe('language feature groups', () => {
  it('exposes hover / signature / complete / lint / marks / chips / remote chips', () => {
    expect(LANGUAGE_FEATURE_GROUPS.map((g) => g.id)).toEqual([
      'hover',
      'signature',
      'complete',
      'lint',
      'marks',
      'chips',
      'remote',
    ]);
  });

  it('master keys are real intel booleans with matching activity flags', () => {
    const seen = new Set<string>();
    for (const g of LANGUAGE_FEATURE_GROUPS) {
      expect(typeof DEFAULT_EDITOR_INTEL[g.masterKey], g.id).toBe('boolean');
      expect(g.activityKey in IDLE_FEATURE_ACTIVITY, g.id).toBe(true);
      expect(seen.has(g.activityKey), `duplicate ${g.activityKey}`).toBe(false);
      seen.add(g.activityKey);
    }
    expect(seen.size).toBe(LANGUAGE_FEATURE_GROUPS.length);
  });

  it('every menu setting maps to a matching intel key', () => {
    for (const g of LANGUAGE_FEATURE_GROUPS) {
      expect(g.settings.length).toBeGreaterThan(0);
      for (const s of g.settings) {
        const current = DEFAULT_EDITOR_INTEL[s.key];
        if (s.kind === 'toggle') {
          expect(typeof current, `${g.id}.${s.key}`).toBe('boolean');
        } else {
          expect(typeof current, `${g.id}.${s.key}`).toBe('number');
          expect(s.min, `${g.id}.${s.key}`).toBeLessThanOrEqual(s.max);
        }
      }
    }
  });

  it('click-toggle flips only the master key', () => {
    for (const g of LANGUAGE_FEATURE_GROUPS) {
      const before = getEditorIntel();
      patchEditorIntel({ [g.masterKey]: !before[g.masterKey] } as never);
      expect(getEditorIntel()[g.masterKey]).toBe(!before[g.masterKey]);
      resetEditorIntel();
    }
  });

  it('deriveFeatureActivity colors only firing features', () => {
    const idle = deriveFeatureActivity({
      observed: { ...IDLE_EDITOR_ACTIVITY },
      lintPending: false,
      diagnosticCount: 0,
      colorHits: 0,
      intel: DEFAULT_EDITOR_INTEL,
    });
    expect(idle).toEqual(IDLE_FEATURE_ACTIVITY);

    // Open hover card + completion list.
    const firing = deriveFeatureActivity({
      observed: { hover: true, signature: false, complete: true },
      lintPending: false,
      diagnosticCount: 0,
      colorHits: 0,
      intel: DEFAULT_EDITOR_INTEL,
    });
    expect(firing.hover).toBe(true);
    expect(firing.complete).toBe(true);
    expect(firing.signature).toBe(false);
    // Remote backend is in the loop while remote-capable features fire.
    expect(firing.remote).toBe(true);

    // Lint check running, no marks yet.
    const linting = deriveFeatureActivity({
      observed: { ...IDLE_EDITOR_ACTIVITY },
      lintPending: true,
      diagnosticCount: 0,
      colorHits: 0,
      intel: DEFAULT_EDITOR_INTEL,
    });
    expect(linting.lint).toBe(true);
    expect(linting.marks).toBe(false);

    // Diagnostics rendered → lint + marks; colors in doc → chips.
    const marked = deriveFeatureActivity({
      observed: { ...IDLE_EDITOR_ACTIVITY },
      lintPending: false,
      diagnosticCount: 3,
      colorHits: 2,
      intel: DEFAULT_EDITOR_INTEL,
    });
    expect(marked.lint).toBe(true);
    expect(marked.marks).toBe(true);
    expect(marked.chips).toBe(true);
  });

  it('derived activity honors master switches', () => {
    const intel = {
      ...DEFAULT_EDITOR_INTEL,
      preevalEnabled: false,
      diagUnderlines: false,
      diagGutter: false,
      colorChips: false,
      remoteLspEnabled: false,
    };
    const act = deriveFeatureActivity({
      observed: { hover: true, signature: true, complete: true },
      lintPending: true,
      diagnosticCount: 3,
      colorHits: 2,
      intel,
    });
    expect(act.lint).toBe(false);
    expect(act.marks).toBe(false);
    expect(act.chips).toBe(false);
    expect(act.remote).toBe(false);
    // Editor-observed signals pass through (a disabled feature cannot fire).
    expect(act.hover).toBe(true);
    expect(act.signature).toBe(true);
  });

  it('featureGroupById resolves known ids', () => {
    expect(featureGroupById('complete')?.masterKey).toBe('autocompleteEnabled');
    expect(featureGroupById('nope')).toBeUndefined();
  });

  it('long-press delay is hold-like but snappy', () => {
    expect(FEATURE_BAR_LONG_PRESS_MS).toBeGreaterThanOrEqual(300);
    expect(FEATURE_BAR_LONG_PRESS_MS).toBeLessThanOrEqual(1000);
  });
});

describe('feature bar visibility', () => {
  it('defaults on and toggles', () => {
    expect(store.editorFeatureBarEnabled).toBe(true);
    toggleEditorFeatureBarEnabled();
    expect(store.editorFeatureBarEnabled).toBe(false);
    setEditorFeatureBarEnabled(true);
    expect(store.editorFeatureBarEnabled).toBe(true);
  });
});
