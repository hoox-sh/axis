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

/**
 * Bottom-center chip on an interactive chart with 0 scripts.
 *
 * @returns The hint, or nothing once dismissed / a script lands.
 */
export const FirstRunHint: Component = () => {
  const [dismissed, setDismissed] = createSignal(isFirstRunHintDismissed());

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
    dismissFirstRunHint();
    setDismissed(true);
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
      <div class="axis-first-run" data-testid="axis-first-run" role="status">
        <p class="axis-first-run-copy">
          Chart has no scripts. Run <strong>{label()}</strong> from the editor to add it.
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
          class="axis-first-run-dismiss"
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
