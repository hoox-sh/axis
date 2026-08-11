// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Split Run / Re-run control for the topbar.
 *
 * - **Run** when the editor script is not on the chart
 * - **Re-run** when a matching instance exists (replaces it)
 * - Chevron menu → **Add another instance** (2nd / 3rd copy of the same script)
 */

import {
  Component,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
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

export const RunSplitButton: Component<{
  getDoc: () => string;
  /**
   * Optional: save unsaved editor buffer to the library before run.
   * Wired from the app editorRef (`ensureSavedForRun`).
   */
  ensureSavedForRun?: () => Promise<{ ok: boolean; doc: string }>;
  /** Optional class on the outer split group */
  class?: string;
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
    return hasInstance() ? 'Re-run' : 'Run';
  });

  const title = createMemo(() => {
    if (isRunning()) return 'Running…';
    if (runBlocked()) return 'Fix script errors in the editor before running';
    if (hasInstance()) {
      const n = instanceCount();
      return n > 1
        ? `Re-run replaces the focused instance (${n} on chart). Use ▾ to add another.`
        : 'Re-run replaces the script already on the chart. Use ▾ to add another instance.';
    }
    return 'Run script against loaded bars (or use detached editor)';
  });

  const closeMenu = () => setMenuOpen(false);

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuOpen()) return;
      const t = e.target as Node | null;
      if (rootEl && t && !rootEl.contains(t)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    });
  });

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
    if (pe.hasErrors || isScriptRunBlockedByPreEval()) return;
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

  return (
    <div
      class={`axis-run-split ${props.class || ''}`.trim()}
      ref={rootEl}
      data-testid="axis-run-split"
    >
      <button
        type="button"
        class={`sc-btn axis-run-main ${
          isRunning() ? 'sc-btn-primary is-active' : 'sc-btn-ghost'
        } ${runBlocked() ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => void gateAndRun('auto')}
        data-testid="axis-btn-run"
        aria-busy={isRunning()}
        disabled={disabled()}
        title={title()}
      >
        {hasInstance() && !isRunning() && !runBlocked() ? (
          <Icons.refresh />
        ) : (
          <Icons.play />
        )}
        <span class="axis-tb-btn-label">{label()}</span>
      </button>

      <Show when={hasInstance() && !isRunning() && !runBlocked()}>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost axis-run-caret ${menuOpen() ? 'is-active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen()}
          aria-label="More run options"
          title="Add another instance of this script on the chart"
          data-testid="axis-btn-run-menu"
          disabled={disabled()}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
        >
          <Icons.chevronDown size={14} />
        </button>
      </Show>

      <Show when={menuOpen() && hasInstance()}>
        <div
          class="axis-run-menu"
          role="menu"
          aria-label="Run options"
          data-testid="axis-run-menu"
        >
          <button
            type="button"
            role="menuitem"
            class="axis-run-menu-item"
            data-testid="axis-btn-run-add-instance"
            onClick={() => void gateAndRun('new')}
          >
            <span class="axis-run-menu-title">Add another instance</span>
            <span class="axis-run-menu-hint">
              {instanceCount() === 1
                ? 'Keep the current one; add a 2nd copy'
                : `${instanceCount()} on chart — add another`}
            </span>
          </button>
        </div>
      </Show>
    </div>
  );
};
