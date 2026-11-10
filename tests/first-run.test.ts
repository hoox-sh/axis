/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * First-use: empty-chart Run hint, Add vs Run copy, ~800px topbar wrap,
 * no auto-open Scripts on builtin add.
 */

import './setup';
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_EDITOR_SCRIPT } from '../src/editor/default-script';
import {
  FIRST_RUN_HINT_KEY,
  dismissFirstRunHint,
  editorRunnableSource,
  firstRunScriptLabel,
  isFirstRunHintDismissed,
  shouldShowFirstRunHint,
} from '../src/ui/first-run';
import { removeItem } from '../src/utils/storage';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

afterEach(() => {
  removeItem(FIRST_RUN_HINT_KEY);
});

describe('shouldShowFirstRunHint', () => {
  it('shows with no scripts even before candles arrive', () => {
    expect(
      shouldShowFirstRunHint({ barCount: 200, scriptCount: 0, dismissed: false }),
    ).toBe(true);
    expect(
      shouldShowFirstRunHint({ barCount: 0, scriptCount: 0, dismissed: false }),
    ).toBe(true);
  });

  it('hides with existing scripts or dismiss', () => {
    expect(
      shouldShowFirstRunHint({ barCount: 200, scriptCount: 1, dismissed: false }),
    ).toBe(false);
    expect(
      shouldShowFirstRunHint({ barCount: 200, scriptCount: 0, dismissed: true }),
    ).toBe(false);
  });
});

describe('editorRunnableSource', () => {
  it('prefers live pre-eval, then persisted, then default RSI', () => {
    expect(
      editorRunnableSource({ preEvalSource: 'plot(1)', persistedDoc: 'plot(2)' }),
    ).toBe('plot(1)');
    expect(editorRunnableSource({ persistedDoc: 'plot(2)' })).toBe('plot(2)');
    expect(editorRunnableSource({})).toBe(DEFAULT_EDITOR_SCRIPT.trim());
  });

  it('labels the default buffer RSI', () => {
    expect(firstRunScriptLabel(DEFAULT_EDITOR_SCRIPT)).toBe('RSI');
    expect(firstRunScriptLabel('plot(close)')).toBe('this script');
  });
});

describe('first-run dismiss flag', () => {
  it('round-trips localStorage', () => {
    expect(isFirstRunHintDismissed()).toBe(false);
    dismissFirstRunHint();
    expect(isFirstRunHintDismissed()).toBe(true);
  });
});

describe('Run vs Add copy', () => {
  it('editor and topbar primary are Run; caret is add-instance', () => {
    const src = read('src/ui/RunSplitButton.tsx');
    expect(src).not.toMatch(/return 'Add';/);
    expect(src).not.toContain('Add to chart');
    expect(src).toContain("return 'Run'");
    expect(src).toContain('aria-label="Add instance or built-in"');
    expect(src).not.toContain('More add options');
    expect(src).toContain('Add another instance');
    expect(src).toContain('Add built-in script…');
  });

  it('chart host mounts the first-run hint, not a tour', () => {
    const host = read('src/chart/ChartHost.tsx');
    expect(host).toContain('FirstRunHint');
    expect(host).toContain('axis-chart-boot');
    const hint = read('src/ui/FirstRunHint.tsx');
    expect(hint).toContain('data-testid="axis-first-run"');
    expect(hint).toContain('data-testid="axis-first-run-run"');
    expect(hint).toContain('Edit a script, then press');
    expect(hint).toContain('Run');
  });
});

describe('~800px topbar wrap', () => {
  it('wraps command and module bars below 1100px and keeps the Run label', () => {
    const css = read('src/index.css');
    expect(css).toContain('@media (max-width: 1100px)');
    const start = css.indexOf('/* ~800px: wrap groups');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('@media (max-width: 639px)', start));
    expect(block).toContain('flex-wrap: wrap');
    expect(block).toContain('overflow-x: auto');
    expect(block).toContain('.axis-run-main .axis-tb-btn-label');
    expect(block).toContain('display: inline');
    const narrowStart = css.indexOf('/* ── Narrow (≤1100px');
    const narrow = css.slice(narrowStart, css.indexOf('/* ── Phone dialogs', narrowStart));
    expect(narrow).toContain('position: absolute');
    expect(narrow).toContain('axis-toasts');
  });
});
