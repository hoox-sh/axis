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
 * Storage change confirmation dialog.
 *
 * Appears whenever the user switches the active storage plugin. Offers two
 * paths:
 * - **Copy scripts** — duplicate every script onto the new engine (source is
 *   never deleted), then signal completion via
 *   {@link StorageChangeDialogProps.onConfirm}.
 * - **Switch without copying** — just switch, leave both libraries as-is.
 *
 * Copy orchestration lives in {@link copyScriptsBetweenStorages} so the
 * active plugin stays pinned to the source until the user commits.
 *
 * Surface is a standard AXIS modal (`.sc-dialog-backdrop` + `.sc-dialog` +
 * `.sc-dialog-header` + `.sc-dialog-body` + `.sc-dialog-footer`), matching
 * {@link AboutModal} / {@link ScriptSettingsModal}. Reuses Lucide icons via
 * the project-wide `Icons` map.
 *
 * @module ui/StorageChangeDialog
 */

import {
  For,
  Show,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { Icons } from './icons';
import { installFocusTrap } from './focus-trap';
import { copyScriptsBetweenStorages } from '../storage/service';
import { resolveCloudConfig } from '../storage/cloud-config';
import { appendLog } from '../store';

/** Storage change confirmation mode passed to {@link StorageChangeDialogProps.onConfirm}. */
export type StorageChangeMode = 'migrate' | 'fresh';

/** Props for {@link StorageChangeDialog}. Re-exported as a named type for testability. */
export interface StorageChangeDialogProps {
  /** Whether the dialog is visible. When false, the component renders nothing. */
  open: boolean;
  /** Source plugin id (e.g. `"local"`). */
  fromEngineId: string;
  /** Human label for the source plugin (e.g. `"Local (IndexedDB)"`). */
  fromEngineLabel: string;
  /** Destination plugin id (e.g. `"git"`). */
  toEngineId: string;
  /** Human label for the destination plugin (e.g. `"Git (GitHub/GitLab)"`). */
  toEngineLabel: string;
  /**
   * Called once the user has committed to a mode.
   * - `'migrate'` — fired **after** the bulk copy finishes successfully.
   *   The parent handler at the call site is expected to call `setActivePlugin`
   *   to commit the engine switch.
   * - `'fresh'` — fired immediately when the user picks "Switch without copying".
   *
   * May return a promise; the dialog awaits it before settling so the parent
   * can update store state. Errors thrown here surface as an error state in
   * the dialog so the user can retry.
   */
  onConfirm: (mode: StorageChangeMode) => void | Promise<void>;
  /** Abort the change without modifying any storage. */
  onCancel: () => void;
}

/** Internal phase machine. */
type Phase = 'idle' | 'migrating' | 'error';

/** Progress snapshot exposed to the body during a bulk copy. */
interface MigrationProgress {
  /** 0-based index of the script being processed (or count so far if done). */
  current: number;
  /** Total number of scripts discovered on the source plugin. */
  total: number;
  /** Display name of the script currently being copied (or just finished). */
  currentName: string;
}

/** Single failed-script detail surfaced in the error state. */
interface FailedScript {
  name: string;
  error: string;
}

/** Shared mutable handle so the Escape key handler can read the live phase. */
function makeAbortHandle() {
  return { aborted: false };
}

/** Storage change confirmation dialog. See file header for semantics. */
const StorageChangeDialog: Component<StorageChangeDialogProps> = (props) => {
  /** Current phase. */
  const [phase, setPhase] = createSignal<Phase>('idle');
  /** Live copy progress (only meaningful while `phase === 'migrating'`). */
  const [progress, setProgress] = createSignal<MigrationProgress>({
    current: 0,
    total: 0,
    currentName: '',
  });
  /** Error message shown in the body. */
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  /** Failed-script list shown beneath the error message. */
  const [failures, setFailures] = createSignal<FailedScript[]>([]);
  /** Mutated by the user to abort an in-flight copy. */
  const [abort, setAbort] = createSignal(makeAbortHandle());

  /** Whether any primary action is in flight (blocks buttons). */
  const busy = () => phase() === 'migrating';

  /** Reset transient state every time the dialog (re-)opens. */
  createEffect(() => {
    if (props.open) {
      setPhase('idle');
      setProgress({ current: 0, total: 0, currentName: '' });
      setErrorMsg(null);
      setFailures([]);
      setAbort(makeAbortHandle());
    }
  });

  /** Install keydown listener and focus trap on every open. */
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        // Escape mid-migration = abort the copy and surface partial state.
        if (phase() === 'migrating') {
          abort().aborted = true;
          return;
        }
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  /** Close on backdrop click (no change to storage). */
  const onBackdrop = (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (busy()) {
      abort().aborted = true;
      return;
    }
    handleCancel();
  };

  /** Cancel handler: abort any in-flight copy and tell the parent. */
  const handleCancel = () => {
    if (busy()) {
      abort().aborted = true;
      return;
    }
    props.onCancel();
  };

  /**
   * Bulk **copy** orchestrator. Source scripts are never deleted.
   */
  const runMigration = async (handle: { aborted: boolean }): Promise<void> => {
    appendLog(
      'info',
      `Copying scripts ${props.fromEngineId} → ${props.toEngineId} (source kept)`,
      'library',
    );

    const result = await copyScriptsBetweenStorages(props.fromEngineId, props.toEngineId, {
      abort: handle,
      onProgress: (p) => {
        setProgress({ current: p.current, total: p.total, currentName: p.name });
      },
    });

    setProgress({
      current: result.copied,
      total: result.total,
      currentName: '',
    });

    const failed: FailedScript[] = result.failed.map((f) => ({
      name: f.name,
      error: f.error,
    }));

    if (result.aborted) {
      const msg =
        `Cancelled after copying ${result.copied} of ${result.total} scripts. ` +
        `Source scripts were not removed.`;
      setErrorMsg(msg);
      setFailures(failed);
      setPhase('error');
      appendLog('warn', msg, 'library');
      return;
    }

    if (failed.length > 0) {
      const summary =
        failed.length === result.total
          ? `Copy failed for all ${result.total} scripts. Source library is unchanged.`
          : `Copied ${result.copied} of ${result.total} scripts — ${failed.length} failed. Source library is unchanged.`;
      setErrorMsg(summary);
      setFailures(failed);
      setPhase('error');
      appendLog('error', summary, 'library');
      return;
    }

    appendLog(
      'ok',
      `Copied ${result.copied} scripts ${props.fromEngineId} → ${props.toEngineId} (source kept)`,
      'library',
    );
    await props.onConfirm('migrate');
  };

  /** Migrate button handler. */
  const handleMigrate = async () => {
    setPhase('migrating');
    setErrorMsg(null);
    setFailures([]);
    const handle = makeAbortHandle();
    setAbort(handle);
    try {
      await runMigration(handle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase('error');
      appendLog('error', `Storage migration aborted: ${msg}`, 'library');
    }
  };

  /** Retry button handler (error → idle → migrate again). */
  const handleRetry = () => {
    setPhase('idle');
    setErrorMsg(null);
    setFailures([]);
    void handleMigrate();
  };

  const targetNeedsKey = () => {
    if (props.toEngineId !== 'cloud') return false;
    return !resolveCloudConfig().apiKey;
  };

  /** Switch-without-copying handler — source stays intact. */
  const handleFresh = async () => {
    setErrorMsg(null);
    try {
      await props.onConfirm('fresh');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase('error');
    }
  };

  /** Body copy differs based on phase. */
  const bodyDescription = () => {
    if (phase() === 'migrating') {
      const p = progress();
      if (p.total === 0) return 'Reading script list from source storage…';
      if (p.currentName) {
        return `Copying ${p.current} of ${p.total}: ${p.currentName}`;
      }
      return `Copying 0 of ${p.total}…`;
    }
    if (phase() === 'error') {
      return errorMsg() ?? 'Copy failed.';
    }
    return `Copy your library to ${props.toEngineLabel}. Scripts stay on ${props.fromEngineLabel} too — nothing is deleted.`;
  };

  /** Heading question shown above the body copy. */
  const heading = () => {
    if (phase() === 'migrating') return 'Copying scripts…';
    if (phase() === 'error') return 'Copy incomplete';
    return `Switch storage engine?`;
  };

  return (
    <Show when={props.open}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop is an intentional click-away dismiss surface for the dialog */}
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        role="presentation"
        data-testid="axis-storage-change-backdrop"
      >
        <div
          class="sc-dialog w-[min(520px,calc(100vw-2*var(--ui-dialog-margin)))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-storage-change-title"
          aria-describedby="axis-storage-change-body"
          data-testid="axis-storage-change-dialog"
          tabIndex={-1}
          ref={(el) => {
            if (!el) return;
            const dispose = installFocusTrap(el, { autoFocus: true });
            onCleanup(dispose);
          }}
        >
          <div class="sc-dialog-accent" />

          <div class="sc-dialog-header">
            <div class="flex items-center gap-2.5 min-w-0">
              <Show when={phase() === 'error'} fallback={<Icons.shuffle class="text-accent flex-shrink-0" />}>
                <Icons.alert class="text-red flex-shrink-0" />
              </Show>
              <div class="min-w-0">
                <div
                  id="axis-storage-change-title"
                  class="text-[0.95em] font-semibold text-text tracking-tight"
                >
                  {heading()}
                </div>
                <div class="sc-hint truncate">
                  {props.fromEngineLabel} → {props.toEngineLabel}
                </div>
              </div>
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2"
              onClick={handleCancel}
              aria-label="Close"
              disabled={busy() && failures().length === 0}
              data-testid="axis-storage-change-close"
            >
              <Icons.x />
            </button>
          </div>

          <div
            id="axis-storage-change-body"
            class="sc-dialog-body flex flex-col gap-3 text-[0.9em]"
          >
            <p class="text-text-dim leading-relaxed m-0">{bodyDescription()}</p>

            <Show when={phase() === 'idle' && targetNeedsKey()}>
              <p class="text-red text-[11px] m-0" data-testid="axis-storage-change-need-key">
                Cloud API key is not set — add the Worker URL and key in Settings before copying.
              </p>
            </Show>

            <Show when={phase() === 'idle'}>
              <div class="border border-border-soft/80 rounded-[var(--radius-sc)] px-2.5 py-2 bg-bg-base/40 flex flex-col gap-1.5">
                <div class="flex items-center gap-2 text-[0.85em]">
                  <Icons.database class="text-text-dim flex-shrink-0" />
                  <span class="text-text-dim">From</span>
                  <span class="font-medium text-text truncate">{props.fromEngineLabel}</span>
                </div>
                <div class="flex items-center gap-2 text-[0.85em]">
                  <Icons.arrowRight class="text-accent flex-shrink-0" />
                  <span class="text-text-dim">To</span>
                  <span class="font-medium text-text truncate">{props.toEngineLabel}</span>
                </div>
              </div>
            </Show>

            <Show when={phase() === 'migrating'}>
              <div
                class="flex items-center gap-2 text-[11px] text-text-dim"
                role="status"
                aria-live="polite"
                data-testid="axis-storage-change-progress"
              >
                <Icons.loader class="animate-spin text-accent" />
                <span class="font-mono">
                  {progress().current}/{progress().total}
                </span>
                <Show when={progress().currentName}>
                  <span class="truncate text-text-faint">— {progress().currentName}</span>
                </Show>
              </div>
            </Show>

            <Show when={phase() === 'error' && failures().length > 0}>
              <div class="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
                <div class="text-[10px] uppercase tracking-wider text-text-dim font-semibold">
                  Failed scripts
                </div>
                <For each={failures()}>
                  {(f) => (
                    <div class="border border-red/40 bg-red/5 rounded px-2 py-1 text-[11px]">
                      <div class="font-medium text-text truncate">{f.name}</div>
                      <div class="text-red font-mono truncate">{f.error}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="sc-dialog-footer">
            <Show
              when={phase() === 'error'}
              fallback={
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost"
                  onClick={handleCancel}
                  disabled={busy()}
                  data-testid="axis-storage-change-cancel"
                >
                  Cancel
                </button>
              }
            >
              <button
                type="button"
                class="sc-btn sc-btn-ghost"
                onClick={handleCancel}
                data-testid="axis-storage-change-discard"
              >
                Close
              </button>
              <div class="flex-1" />
              <button
                type="button"
                class="sc-btn"
                onClick={handleRetry}
                data-testid="axis-storage-change-retry"
              >
                <Icons.refresh />
                Retry copy
              </button>
            </Show>

            <Show when={phase() === 'idle'}>
              <div class="flex-1" />
              <button
                type="button"
                class="sc-btn sc-btn-ghost"
                onClick={() => void handleFresh()}
                data-testid="axis-storage-change-fresh"
              >
                <Icons.eraser />
                Switch without copying
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-primary"
                onClick={() => void handleMigrate()}
                data-testid="axis-storage-change-migrate"
                disabled={targetNeedsKey()}
                title={
                  targetNeedsKey()
                    ? 'Set the Worker API key in Settings before copying'
                    : 'Copy scripts to the new engine (keep the source library)'
                }
              >
                <Icons.shuffle />
                Copy scripts
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default StorageChangeDialog;
