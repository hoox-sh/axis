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
 * Collapsible **System Logs** strip above the status bar.
 *
 * Visibility (show/hide entire strip): panel chrome `logs` — topbar **System Logs**.
 * Expand/collapse body: `store.logsPanel.open` (header toggle, like before).
 * Distinct from {@link ScriptLogsPanel} (Pine `log.*` from a run).
 *
 * @module ui/SystemLogs
 */

import { Component, For, Show, createEffect, createSignal } from 'solid-js';
import { store, setStore, persist, clearLogs, isPanelOpen } from '../store';
import type { LogEntry } from '../store/types';
import { Icons } from './icons';
import { copyToClipboard } from './clipboard';

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

/** Classic collapsible system log strip (when System Logs pane is enabled). */
export const SystemLogs: Component = () => {
  const [copied, setCopied] = createSignal(false);
  let listRef: HTMLDivElement | undefined;

  /** Expanded body (collapsed shows last line only). */
  const expanded = () => !!store.logsPanel.open;

  createEffect(() => {
    void store.logs.length;
    if (isPanelOpen('logs') && expanded() && listRef) {
      listRef.scrollTop = listRef.scrollHeight;
    }
  });

  const toggleExpand = () => {
    // Expand/collapse body only — strip stays visible while chrome `logs` is open
    setStore('logsPanel', 'open', !store.logsPanel.open);
    persist();
  };

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

  const last = () => store.logs[store.logs.length - 1];

  /**
   * Expanded body height, clamped to the viewport. Reserve room for topbar,
   * workspace and the Status strip so System Logs can never clip them.
   */
  const clampLogsBodyHeight = (): number => {
    const preferred = Math.max(80, store.logsPanel.height - 28);
    const reserved = 260; // topbar + workspace minimum + status strip
    const max = Math.max(80, (typeof window !== 'undefined' ? window.innerHeight : 900) - reserved);
    return Math.min(preferred, max);
  };

  return (
    <Show when={isPanelOpen('logs')}>
      <div
        class="flex flex-col border-t-2 border-border bg-bg-panel flex-shrink-0"
        data-axis-system-logs
        data-testid="axis-system-logs"
      >
        {/* Collapsed header / expand toggle row */}
        <div class="flex items-center gap-1.5 px-2 py-0.5 min-h-[24px]">
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5 py-0.5 text-[10px] inline-flex items-center gap-1"
            onClick={toggleExpand}
            title={
              expanded()
                ? 'Collapse system logs'
                : 'Expand system logs'
            }
            aria-expanded={expanded()}
            data-testid="axis-systemlogs-expand"
          >
            <Icons.scrollText size={13} />
            <span class="uppercase tracking-wider text-text-dim">System Logs</span>
            <span class="text-text-faint font-mono">({store.logs.length})</span>
            {expanded() ? (
              <Icons.chevronDown size={12} />
            ) : (
              <Icons.chevronUp size={12} />
            )}
          </button>

          <Show when={!expanded() && last()}>
            <button
              type="button"
              class={`flex-1 min-w-0 text-left text-[10px] font-mono truncate px-1 ${levelClass(last()!.level)}`}
              title="Click to expand"
              onClick={toggleExpand}
            >
              <span class="text-text-faint mr-1.5">{formatTs(last()!.ts)}</span>
              {last()!.message}
            </button>
          </Show>
          <Show when={!expanded() && !last()}>
            <span class="flex-1 text-[10px] text-text-faint px-1">No log entries yet</span>
          </Show>
          <Show when={expanded()}>
            <div class="flex-1" />
          </Show>

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
            <Icons.trash size={13} />
          </button>
        </div>

        {/* Expanded body */}
        <Show when={expanded()}>
          <div
            ref={listRef}
            class="overflow-auto border-t border-border-soft font-mono text-[10px] bg-bg-base"
            style={{
              // Clamp against the viewport so a persisted oversized height can
              // never push the Status strip (rendered below) off-screen.
              height: `${clampLogsBodyHeight()}px`,
            }}
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
        </Show>
      </div>
    </Show>
  );
};
