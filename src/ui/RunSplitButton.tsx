// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Split Add control for the topbar and editor header.
 *
 * - **Add** when the editor script is not on the chart
 * - **Add** when a matching instance exists (replaces it — same as former Re-run)
 * - Chevron menu → **Add another instance** (when a copy is already on the chart)
 *   and **Add built-in script…** (catalog picker)
 */

import {
  type Component,
  Show,
  createMemo,
  createSignal,
} from 'solid-js';
import {
  store,
  setStatus,
  isScriptRunBlockedByPreEval,
} from '../store';
import { runPreevalNow } from '../editor/preevaluate';
import {
  countChartScriptsForEditor,
  editorHasChartInstance,
  runFromEditor,
} from '../indicators/run-target';
import { reportUiError } from './boot-errors';
import { Icons } from './icons';
import { Popover } from './Popover';
import { openBuiltinPicker } from './shortcuts/palette-bridge';

export const RunSplitButton: Component<{
  getDoc: () => string;
  /**
   * Optional: save unsaved editor buffer to the library before run.
   * Wired from the app editorRef (`ensureSavedForRun`).
   */
  ensureSavedForRun?: () => Promise<{ ok: boolean; doc: string }>;
  /** Optional class on the outer split group */
  class?: string;
  /** Compact ghost chrome for the editor header strip. */
  compact?: boolean;
}> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  /** Prefer pre-eval source (reactive) so the label tracks editor edits. */
  const editorSource = createMemo(
    () => store.preEval?.source || props.getDoc() || '',
  );

  const runBlocked = () => isScriptRunBlockedByPreEval();
  const isRunning = () => store.status === 'running';
  const hasInstance = createMemo(() => {
    // Track scripts + focus so Re-run updates after apply/remove
    void store.scripts.length;
    void store.resultsFocusId;
    return editorHasChartInstance(editorSource());
  });
  const instanceCount = createMemo(() => {
    void store.scripts.length;
    return countChartScriptsForEditor(editorSource());
  });

  const label = createMemo(() => {
    if (isRunning()) return 'Running…';
    if (runBlocked()) return 'Fix errors';
    return 'Add';
  });

  const title = createMemo(() => {
    if (isRunning()) return 'Running…';
    if (runBlocked()) return 'Fix script errors in the editor before adding';
    if (hasInstance()) {
      const n = instanceCount();
      return n > 1
        ? `Add replaces the focused instance (${n} on chart). Use ▾ to add another.`
        : 'Add replaces the script already on the chart. Use ▾ to add another instance.';
    }
    return 'Add script to the chart (or use detached editor)';
  });

  const ids = () =>
    props.compact
      ? {
          split: 'axis-editor-run-split',
          main: 'axis-editor-btn-run',
          caret: 'axis-editor-btn-run-menu',
          menu: 'axis-editor-run-menu',
          instance: 'axis-editor-btn-run-add-instance',
          builtin: 'axis-editor-btn-run-add-builtin',
        }
      : {
          split: 'axis-run-split',
          main: 'axis-btn-run',
          caret: 'axis-btn-run-menu',
          menu: 'axis-run-menu',
          instance: 'axis-btn-run-add-instance',
          builtin: 'axis-btn-run-add-builtin',
        };

  const closeMenu = () => setMenuOpen(false);

  const gateAndRun = async (mode: 'auto' | 'new') => {
    if (isRunning()) return;
    // Persist unsaved scripts first (library write / git commit)
    let doc = props.getDoc();
    if (!doc?.trim()) return;
    if (props.ensureSavedForRun) {
      const saved = await props.ensureSavedForRun();
      if (!saved.ok) return;
      doc = saved.doc || doc;
    }
    if (!doc.trim()) return;
    const pe = await runPreevalNow(doc);
    if (isScriptRunBlockedByPreEval()) return;
    closeMenu();
    try {
      await runFromEditor(doc, {
        mode,
        inputs: store.editorInputValues || {},
      });
    } catch (err: unknown) {
      reportUiError(err, {
        source: 'run',
        context: mode === 'new' ? 'Add instance failed' : 'Run failed',
        status: true,
      });
    } finally {
      if (store.status === 'running') {
        setStatus('ready', 'Run finished');
      }
    }
  };

  const disabled = () => runBlocked() || isRunning();
  const caretDisabled = () => isRunning();

  return (
    <div
      class={`axis-run-split ${props.compact ? 'is-compact' : ''} ${props.class || ''}`.trim()}
      ref={rootEl}
      data-testid={ids().split}
    >
      <button
        type="button"
        class={`sc-btn axis-run-main ${
          props.compact ? 'sc-btn-ghost axis-editor-tool-btn' : 'sc-btn-primary'
        } ${isRunning() ? 'is-active' : ''} ${
          runBlocked() ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={() => void gateAndRun('auto')}
        data-testid={ids().main}
        aria-busy={isRunning()}
        disabled={disabled()}
        title={title()}
      >
        {props.compact ? (
          <span class="axis-editor-tool-icon" aria-hidden="true">
            {isRunning() || runBlocked() ? (
              <Icons.play size={14} />
            ) : (
              <Icons.plus size={14} />
            )}
          </span>
        ) : isRunning() || runBlocked() ? (
          <Icons.play />
        ) : (
          <Icons.plus />
        )}
        <span class={props.compact ? 'axis-editor-tool-label' : 'axis-tb-btn-label'}>
          {label()}
        </span>
      </button>

      <Show when={!isRunning()}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost axis-run-caret ${
            props.compact ? 'axis-editor-tool-btn' : ''
          } ${menuOpen() ? 'is-active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen()}
          aria-label="More add options"
          title="Add a built-in script, or another instance of this one"
          data-testid={ids().caret}
          disabled={caretDisabled()}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => {
              const next = !o;
              return next;
            });
          }}
        >
          <Icons.chevronDown size={14} />
        </button>
      </Show>

      <Popover
        open={menuOpen()}
        anchor={rootEl}
        onClose={closeMenu}
        class="axis-run-menu"
        role="menu"
        label="Add options"
        testId={ids().menu}
      >
          <Show when={hasInstance() && !runBlocked()}>
            <button
              type="button"
              role="menuitem"
              class="axis-run-menu-item"
              data-testid={ids().instance}
              onClick={() => void gateAndRun('new')}
            >
              <span class="axis-run-menu-title">Add another instance</span>
              <span class="axis-run-menu-hint">
                {instanceCount() === 1
                  ? 'Keep the current one; add a 2nd copy'
                  : `${instanceCount()} on chart — add another`}
              </span>
            </button>
          </Show>
          <button
            type="button"
            role="menuitem"
            class="axis-run-menu-item"
            data-testid={ids().builtin}
            onClick={() => {
              closeMenu();
              openBuiltinPicker();
            }}
          >
            <span class="axis-run-menu-title">Add built-in script…</span>
            <span class="axis-run-menu-hint">RSI, MACD, VWAP, Supertrend, …</span>
          </button>
      </Popover>
    </div>
  );
};
