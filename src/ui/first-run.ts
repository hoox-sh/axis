// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-visit “run this script” hint — empty chart + editor buffer, not a tour.
 *
 * @module ui/first-run
 */

import { DEFAULT_EDITOR_SCRIPT } from '../editor/default-script';
import { extractScriptTitle } from '../indicators/run-target';
import { getItem, setItem } from '../utils/storage';

/** localStorage flag: user dismissed the empty-chart run hint. */
export const FIRST_RUN_HINT_KEY = 'axis.firstUse.runHintDismissed';

/** Runnable Pine for the hint CTA: live buffer, persisted doc, or the default RSI. */
export function editorRunnableSource(opts: {
  preEvalSource?: string | null;
  persistedDoc?: string | null;
}): string {
  const live = String(opts.preEvalSource ?? '').trim();
  if (live) return live;
  const persisted = String(opts.persistedDoc ?? '').trim();
  if (persisted) return persisted;
  return DEFAULT_EDITOR_SCRIPT.trim();
}

/**
 * Show the chart hint when candles are up, no scripts are applied, and the
 * user has not dismissed it. The editor is prefilled; the chart is not.
 */
export function shouldShowFirstRunHint(opts: {
  barCount: number;
  scriptCount: number;
  dismissed: boolean;
}): boolean {
  if (opts.dismissed) return false;
  if (opts.barCount <= 0) return false;
  if (opts.scriptCount > 0) return false;
  return true;
}

export function isFirstRunHintDismissed(): boolean {
  return getItem(FIRST_RUN_HINT_KEY) === '1';
}

export function dismissFirstRunHint(): void {
  setItem(FIRST_RUN_HINT_KEY, '1');
}

/** Short title for the hint (“RSI”), falling back to “this script”. */
export function firstRunScriptLabel(source: string): string {
  return extractScriptTitle(source) || 'this script';
}

/**
 * Fire the existing editor / topbar Run control so pre-eval and save-before-run
 * stay on that path. Returns false when no armed Run button is in the DOM.
 */
export function triggerEditorRun(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLButtonElement>(
    '[data-testid="axis-editor-btn-run"]:not(:disabled), [data-testid="axis-btn-run"]:not(:disabled)',
  );
  if (!el) return false;
  el.click();
  return true;
}
