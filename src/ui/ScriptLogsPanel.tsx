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
 * Script Logs panel — `log.info` / `log.warning` / `log.error`
 * output from the focused script run.
 *
 * Reads `store.lastRun` (focused via {@link ScriptRunSelect} /
 * `resultsFocusId`) via {@link normalizePyneLogs}. Multi-indicator live
 * re-runs keep per-script caches in `runResults` so the list does not thrash.
 * FloatableShell id `scriptlogs` (title **Script Logs**).
 */

import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { store, isPanelOpen } from '../store';
import {
  normalizePyneLogs,
  type PyneLogEntry,
  type PyneLogLevel,
} from '../results/pyne-logs';
import { jumpToDebugPin } from '../chart/manager-access';
import { flashDebugPinLine } from '../editor/inline-debug';
import { parseSourceLine } from '../results/inline-debug';
import { FloatableShell } from './panels/FloatableShell';
import { Icons } from './icons';
import { ScriptRunSelect } from './ScriptRunSelect';
import { copyToClipboard } from './clipboard';

/** Panel chrome id (see `PanelId` in panels/types). */
const PANEL_ID = 'scriptlogs' as const;

type LevelFilter = 'all' | PyneLogLevel;

const FILTERS: { id: LevelFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'info', label: 'Info' },
  { id: 'warning', label: 'Warning' },
  { id: 'error', label: 'Error' },
];

function normalizeLevel(level: unknown): LevelFilter | 'other' {
  const s = String(level ?? 'info').toLowerCase();
  if (s === 'error' || s === 'err') return 'error';
  if (s === 'warning' || s === 'warn') return 'warning';
  if (s === 'info' || s === 'ok' || s === 'debug') return 'info';
  return 'other';
}

function levelClass(level: unknown): string {
  switch (normalizeLevel(level)) {
    case 'error':
      return 'text-red';
    case 'warning':
      return 'text-orange';
    case 'info':
      return 'text-text-dim';
    default:
      return 'text-text-dim';
  }
}

function barIndexOf(entry: PyneLogEntry): number | null {
  const v = entry.barIndex;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function entryAsText(entry: PyneLogEntry): string {
  const lvl = String(entry.level ?? 'info').toUpperCase();
  const bi = barIndexOf(entry);
  const prefix = bi != null ? `[${bi}] ` : '';
  return `${lvl}\t${prefix}${entry.message ?? ''}`;
}

function logsAsText(entries: PyneLogEntry[]): string {
  return entries.map(entryAsText).join('\n');
}

/** Floatable script `log.*` output from the last run (Script Logs). */
export const ScriptLogsPanel: Component = () => {
  const [filter, setFilter] = createSignal<LevelFilter>('all');
  const [copied, setCopied] = createSignal(false);
  let listRef: HTMLDivElement | undefined;

  const hasRun = () => store.lastRun != null;

  const allEntries = createMemo((): PyneLogEntry[] => {
    const r = store.lastRun;
    if (r == null) return [];
    try {
      return normalizePyneLogs(r);
    } catch {
      return [];
    }
  });

  const filtered = createMemo(() => {
    const f = filter();
    const list = allEntries();
    if (f === 'all') return list;
    return list.filter((e) => normalizeLevel(e.level) === f);
  });

  createEffect(() => {
    // Auto-scroll when open and log list grows / filter changes
    void filtered().length;
    void allEntries().length;
    if (isPanelOpen(PANEL_ID) && listRef) {
      listRef.scrollTop = listRef.scrollHeight;
    }
  });

  const flashCopied = (ms = 1200) => {
    setCopied(true);
    setTimeout(() => setCopied(false), ms);
  };

  const copyAll = async () => {
    const text = logsAsText(filtered());
    if (!text) return;
    if (await copyToClipboard(text)) flashCopied(1200);
  };

  const copyLine = async (entry: PyneLogEntry, e?: Event) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    const text = String(entry.message ?? '');
    if (!text) return;
    if (await copyToClipboard(text)) flashCopied(800);
  };

  return (
    <Show when={isPanelOpen(PANEL_ID)}>
      <FloatableShell id={PANEL_ID} title="Script Logs" testId="axis-scriptlogs">
        {/* Toolbar: script picker + level filters + count + copy */}
        <div
          class="flex items-center gap-1.5 px-2 py-1 border-b border-border-soft flex-shrink-0 flex-wrap"
          data-testid="axis-scriptlogs-toolbar"
        >
          <ScriptRunSelect testId="axis-scriptlogs-script" />

          <div class="sc-chip-row" role="group" aria-label="Log level filter">
            <For each={FILTERS}>
              {(f) => (
                <button
                  type="button"
                  class={`sc-chip ${filter() === f.id ? 'is-active' : ''}`}
                  aria-pressed={filter() === f.id}
                  data-testid={`axis-scriptlogs-filter-${f.id}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              )}
            </For>
          </div>

          <span
            class="text-[0.78em] text-text-faint font-mono tabular-nums"
            data-testid="axis-scriptlogs-count"
          >
            {filtered().length}
            <Show when={filter() !== 'all' && allEntries().length !== filtered().length}>
              <span class="text-text-faint">/{allEntries().length}</span>
            </Show>
          </span>

          <div class="flex-1" />

          <Show when={copied()}>
            <span class="text-[0.78em] text-accent-2 inline-flex items-center gap-0.5">
              <Icons.check size={12} /> Copied
            </span>
          </Show>

          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 py-0.5 text-[0.78em] inline-flex items-center gap-1"
            title="Copy filtered logs"
            data-testid="axis-scriptlogs-copy"
            disabled={!filtered().length}
            onClick={() => void copyAll()}
          >
            <Icons.copy size={13} />
            Copy
          </button>
        </div>

        {/* Scrollable log list */}
        <div
          ref={listRef}
          class="flex-1 min-h-0 overflow-y-auto font-mono text-[0.8em] bg-bg-base"
          data-testid="axis-scriptlogs-list"
        >
          <Show
            when={hasRun()}
            fallback={
              <div
                class="p-3 text-text-faint italic text-[0.95em]"
                data-testid="axis-scriptlogs-empty"
              >
                Run a script that calls log.info / log.warning / log.error.
              </div>
            }
          >
            <Show
              when={allEntries().length > 0}
              fallback={
                <div
                  class="p-3 text-text-faint italic text-[0.95em]"
                  data-testid="axis-scriptlogs-empty"
                >
                  No script logs in the last run.
                </div>
              }
            >
              <Show
                when={filtered().length > 0}
                fallback={
                  <div class="p-3 text-text-faint italic text-[0.95em]">
                    No {filter()} logs in the last run.
                  </div>
                }
              >
                <For each={filtered()}>
                  {(entry, i) => {
                    const bi = () => barIndexOf(entry);
                    const lvl = () => normalizeLevel(entry.level);
                    const jumpable = () => bi() != null || entry.time != null;
                    const onJump = () => {
                      if (!jumpable()) return;
                      jumpToDebugPin({ barIndex: bi(), time: entry.time ?? null });
                      // Bidirectional: flash editor line when the log references one
                      const line =
                        parseSourceLine(entry.message) ??
                        (typeof (entry as { line?: number }).line === 'number'
                          ? (entry as { line?: number }).line!
                          : null);
                      if (line != null) flashDebugPinLine(line);
                    };
                    return (
                      <div
                        class={`group flex items-start gap-2 px-2 py-0.5 border-b border-border-soft/50 hover:bg-bg-hover/60 ${
                          jumpable() ? 'cursor-pointer' : ''
                        }`}
                        data-testid="axis-scriptlogs-row"
                        data-level={lvl()}
                        data-index={i()}
                        title={jumpable() ? 'Jump to bar on chart' : undefined}
                        role={jumpable() ? 'button' : undefined}
                        tabIndex={jumpable() ? 0 : undefined}
                        onClick={onJump}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onJump();
                          }
                        }}
                      >
                        <Show when={bi() != null}>
                          <span class="text-text-faint w-12 flex-shrink-0 select-none tabular-nums text-right text-accent/80">
                            [{bi()}]
                          </span>
                        </Show>
                        <span
                          class={`w-14 flex-shrink-0 uppercase select-none ${levelClass(entry.level)}`}
                        >
                          {String(entry.level ?? 'info')}
                        </span>
                        <span
                          class={`flex-1 min-w-0 break-all whitespace-pre-wrap ${levelClass(entry.level)}`}
                        >
                          {entry.message ?? ''}
                        </span>
                        <button
                          type="button"
                          class="sc-btn sc-btn-ghost px-1 py-0 opacity-40 group-hover:opacity-100 flex-shrink-0"
                          title="Copy message to clipboard"
                          data-testid="axis-scriptlogs-copy-line"
                          onClick={(e) => void copyLine(entry, e)}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Icons.copy size={11} />
                        </button>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </Show>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
