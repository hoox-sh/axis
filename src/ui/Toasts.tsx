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
 * Transient toast stack (bottom-right, above the status bar).
 *
 * Toasts are raised via {@link notify} / auto-toast from `appendLog`
 * (warn/error) and every toast is also written to the System Logs strip.
 * Flood control (dedupe ×N, visible cap, level floor, per-category toggles)
 * lives in Settings → Notifications.
 *
 * @module ui/Toasts
 */

import { type Component, For, Show, onCleanup } from 'solid-js';
import { store, dismissToast, setSystemLogsPanelOpen } from '../store';
import type { LogLevel, ToastEntry } from '../store/types';
import { Icons, type IconProps } from './icons';

function levelStyle(level: LogLevel): {
  bar: string;
  text: string;
  icon: Component<IconProps>;
} {
  switch (level) {
    case 'error':
      return { bar: 'bg-[#F07178]', text: 'text-red', icon: Icons.alert };
    case 'warn':
      return { bar: 'bg-[#E8B84A]', text: 'text-orange', icon: Icons.alert };
    case 'ok':
      return { bar: 'bg-[#3DDC97]', text: 'text-accent-2', icon: Icons.check };
    default:
      return { bar: 'bg-[#6B7382]', text: 'text-text-dim', icon: Icons.activity };
  }
}

/** Auto-dismiss delay: base duration, errors stick ~2× longer. */
function delayFor(level: LogLevel): number {
  const base = Math.min(
    30000,
    Math.max(1500, store.notifications?.durationMs || 4500),
  );
  return level === 'error' ? Math.min(30000, base * 2) : base;
}

const ToastCard: Component<{ toast: ToastEntry }> = (props) => {
  const t = () => props.toast;
  const st = () => levelStyle(t().level);
  const I = st().icon;

  let timer: ReturnType<typeof setTimeout> | undefined;
  timer = setTimeout(() => dismissToast(t().id), delayFor(t().level));
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const openLogs = () => {
    dismissToast(t().id);
    try {
      setSystemLogsPanelOpen(true);
    } catch {
      /* panel optional */
    }
  };

  return (
    <div
      role={t().level === 'error' || t().level === 'warn' ? 'alert' : 'status'}
      data-testid="axis-toast"
      data-toast-level={t().level}
      class="pointer-events-auto w-[min(92vw,22rem)] border border-border-soft bg-bg-elev shadow-lg rounded-[var(--radius-sc)] overflow-hidden"
    >
      <div class="flex items-start gap-2 px-2.5 py-2">
        <span class={`mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${st().bar}`} />
        <span class={st().text}>
          <I size={13} />
        </span>
        <button
          type="button"
          class="flex-1 min-w-0 text-left text-[11px] font-mono leading-snug text-text-dim break-words"
          title="Open System Logs"
          onClick={openLogs}
        >
          <Show when={t().source} fallback={null}>
            <span class="text-text-faint">[{t().source}] </span>
          </Show>
          {t().message}
          <Show when={t().count > 1}>
            <span class="text-accent font-sans font-medium"> ×{t().count}</span>
          </Show>
        </button>
        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1 py-0.5 shrink-0"
          title="Dismiss"
          aria-label="Dismiss notification"
          data-testid="axis-toast-dismiss"
          onClick={() => dismissToast(t().id)}
        >
          <Icons.x size={12} />
        </button>
      </div>
    </div>
  );
};

/** Fixed toast stack; pointer-events pass through except on cards. */
export const Toasts: Component = () => {
  return (
    <Show when={store.toasts.length > 0}>
      <div
        class="pointer-events-none fixed bottom-12 right-3 z-[90] flex flex-col items-end gap-1.5"
        data-testid="axis-toasts"
        aria-live="polite"
      >
        <For each={store.toasts}>{(t) => <ToastCard toast={t} />}</For>
      </div>
    </Show>
  );
};
