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
 * System Logs pane — app / transport / boot telemetry (`store.logs`).
 *
 * FloatableShell id `logs` (title **System Logs**). Distinct from
 * {@link ScriptLogsPanel} (`scriptlogs` — Pine `log.*` from a run).
 *
 * @module ui/SystemLogs
 */

import { Component, For, Show, createEffect, createSignal } from 'solid-js';
import { store, clearLogs, isPanelOpen } from '../store';
import type { LogEntry } from '../store/types';
import { Icons } from './icons';
import { copyToClipboard } from './clipboard';
import { FloatableShell } from './panels/FloatableShell';

const PANEL_ID = 'logs' as const;

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 23); // HH:mm:ss.sss
}

function levelClass(level: LogEntry['level']): string {
  switch (level) {
    case 'error':
      return 'text-red';
    case 'ok':
      return 'text-accent-2';
    case 'warn':
      return 'text-orange';
    default:
      return 'text-text-dim';
  }
}

function logsAsText(logs: LogEntry[]): string {
  return logs
    .map(
      (l) =>
        `${formatTs(l.ts)}\t${l.level.toUpperCase()}\t[${l.source || 'system'}]\t${l.message}`,
    )
    .join('\n');
}

/** Dockable system log list with copy and clear controls. */
export const SystemLogs: Component = () => {
  const [copied, setCopied] = createSignal(false);
  let listRef: HTMLDivElement | undefined;

  createEffect(() => {
    void store.logs.length;
    if (isPanelOpen(PANEL_ID) && listRef) {
      listRef.scrollTop = listRef.scrollHeight;
    }
  });

  const flashCopied = (ms = 1200) => {
    setCopied(true);
    setTimeout(() => setCopied(false), ms);
  };

  const copyAll = async () => {
    const text = logsAsText(store.logs);
    if (!text) return;
    if (await copyToClipboard(text)) flashCopied(1200);
  };

  const copyLine = async (entry: LogEntry, e?: Event) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    const text = String(entry.message ?? '');
    if (!text) return;
    if (await copyToClipboard(text)) flashCopied(800);
  };

  return (
    <Show when={isPanelOpen(PANEL_ID)}>
      <FloatableShell
        id={PANEL_ID}
        title="System Logs"
        testId="axis-system-logs"
        class="min-h-0"
        headerExtra={
          <div
            class="flex items-center gap-1 flex-shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span class="text-[10px] text-text-faint font-mono tabular-nums">
              {store.logs.length}
            </span>
            <Show when={copied()}>
              <span class="text-[10px] text-accent-2 inline-flex items-center gap-0.5">
                <Icons.check size={12} /> Copied
              </span>
            </Show>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-1.5 py-0.5"
              title="Copy all system logs"
              disabled={!store.logs.length}
              onClick={() => void copyAll()}
            >
              <Icons.copy size={13} />
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-1.5 py-0.5"
              title="Clear system logs"
              disabled={!store.logs.length}
              onClick={() => clearLogs()}
            >
              <Icons.x size={13} />
            </button>
          </div>
        }
      >
        <div
          ref={listRef}
          class="overflow-auto h-full min-h-0 font-mono text-[10px] bg-bg-base"
          data-axis-system-logs
        >
          <Show
            when={store.logs.length > 0}
            fallback={
              <div class="p-3 text-text-faint uppercase tracking-wider">
                Waiting for system events…
              </div>
            }
          >
            <For each={store.logs}>
              {(entry) => (
                <div
                  class="group flex items-start gap-2 px-2 py-0.5 border-b border-border-soft/50 hover:bg-bg-hover/60"
                  onDblClick={(e) => void copyLine(entry, e)}
                  title="Double-click to copy message"
                >
                  <span class="text-text-faint w-[72px] flex-shrink-0 select-none">
                    {formatTs(entry.ts)}
                  </span>
                  <span
                    class={`w-10 flex-shrink-0 uppercase select-none ${levelClass(entry.level)}`}
                  >
                    {entry.level}
                  </span>
                  <span class="text-text-faint w-14 flex-shrink-0 truncate select-none">
                    {entry.source}
                  </span>
                  <span class={`flex-1 min-w-0 break-all ${levelClass(entry.level)}`}>
                    {entry.message}
                  </span>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1 py-0 opacity-40 group-hover:opacity-100 flex-shrink-0"
                    title="Copy message to clipboard"
                    data-testid="axis-log-copy-line"
                    onClick={(e) => void copyLine(entry, e)}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Icons.copy size={11} />
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
