// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compact empty-chart hint: run the prefilled editor script onto the chart.
 *
 * @module ui/FirstRunHint
 */

import { type Component, Show, createMemo, createSignal } from 'solid-js';
import { loadEditorDoc, store } from '../store';
import { reportUiError } from './boot-errors';
import {
  dismissFirstRunHint,
  editorRunnableSource,
  firstRunScriptLabel,
  isFirstRunHintDismissed,
  shouldShowFirstRunHint,
  triggerEditorRun,
} from './first-run';
import { Icons } from './icons';

/** Exit transition, then unmount. Reduced motion resolves immediately. */
async function waitForMotion(el: Element | undefined): Promise<void> {
  if (!el || typeof el.getAnimations !== 'function') return;
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
  });
  const running = el.getAnimations();
  if (running.length === 0) return;
  await Promise.race([
    Promise.allSettled(running.map((anim) => anim.finished)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

/**
 * Bottom-center chip on an interactive chart with 0 scripts.
 *
 * @returns The hint, or nothing once dismissed / a script lands.
 */
export const FirstRunHint: Component = () => {
  const [dismissed, setDismissed] = createSignal(isFirstRunHintDismissed());
  const [leaving, setLeaving] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const source = createMemo(() =>
    editorRunnableSource({
      preEvalSource: store.preEval?.source,
      persistedDoc: loadEditorDoc(),
    }),
  );

  const visible = createMemo(() => {
    void store.scripts.length;
    void store.bars.length;
    return shouldShowFirstRunHint({
      barCount: store.bars.length,
      scriptCount: store.scripts.length,
      dismissed: dismissed(),
    });
  });

  const label = createMemo(() => firstRunScriptLabel(source()));

  const onDismiss = () => {
    if (leaving() || dismissed()) return;
    dismissFirstRunHint();
    setLeaving(true);
    const el = rootEl;
    void waitForMotion(el).then(() => setDismissed(true));
  };

  const onRun = () => {
    if (triggerEditorRun()) {
      onDismiss();
      return;
    }
    const doc = source();
    if (!doc) return;
    void import('../indicators/run-target')
      .then(({ runFromEditor }) =>
        runFromEditor(doc, {
          mode: 'auto',
          inputs: store.editorInputValues || {},
        }),
      )
      .catch((err: unknown) => {
        reportUiError(err, {
          source: 'run',
          context: 'First-run hint failed',
          status: true,
        });
      });
    onDismiss();
  };

  return (
    <Show when={visible()}>
      <div
        ref={rootEl}
        class="axis-first-run axis-motion-rise"
        classList={{ 'axis-motion-exit': leaving() }}
        data-testid="axis-first-run"
        role="status"
      >
        <p class="axis-first-run-copy">
          Edit a script, then press <strong>Run</strong> to add {label()} to the chart.
        </p>
        <button
          type="button"
          class="sc-btn sc-btn-primary axis-first-run-run"
          data-testid="axis-first-run-run"
          onClick={onRun}
        >
          <Icons.play size={12} />
          Run
        </button>
        <button
          type="button"
          class="axis-first-run-dismiss axis-motion-hit"
          data-testid="axis-first-run-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
        >
          <Icons.x size={12} />
        </button>
      </div>
    </Show>
  );
};
