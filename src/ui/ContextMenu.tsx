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
 * Pointer-positioned context menu (portaled to `document.body`).
 *
 * Closes on outside pointerdown, Escape, scroll, and resize. Arrow keys move
 * between enabled rows.
 *
 * @module ui/ContextMenu
 */

import { type Component, For, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { clampMenuPosition, type ContextMenuEntry } from './context-menu';
import { dismissOnOutside } from './dismiss-on-outside';

export const ContextMenu: Component<{
  x: number;
  y: number;
  label: string;
  items: ContextMenuEntry[];
  onClose: () => void;
  onSelect: (id: string) => void;
}> = (props) => {
  let root: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal({ x: props.x, y: props.y });

  const itemButtons = () => {
    if (!root) return [] as HTMLButtonElement[];
    return Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)'),
    );
  };

  const focusAt = (index: number) => {
    const buttons = itemButtons();
    if (!buttons.length) return;
    const i = (index + buttons.length) % buttons.length;
    buttons[i]?.focus();
  };

  onMount(() => {
    const rect = root?.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (rect && rect.width > 0) {
      setPos(clampMenuPosition(props.x, props.y, rect.width, rect.height, vw, vh));
    }
    queueMicrotask(() => focusAt(0));

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        return;
      }
      const buttons = itemButtons();
      if (!buttons.length) return;
      const cur = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusAt(cur < 0 ? 0 : cur + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusAt(cur < 0 ? buttons.length - 1 : cur - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusAt(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusAt(buttons.length - 1);
      }
    };
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (root && t && (t === root || root.contains(t))) return;
      props.onClose();
    };
    const onDismiss = () => props.onClose();
    // Escape is handled above (capture + stopPropagation), so only the
    // outside-pointer dismiss comes from the shared helper here.
    const disposeDismiss = dismissOnOutside({
      inside: () => [root],
      onDismiss: () => props.onClose(),
      escape: false,
    });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onDismiss);
    onCleanup(() => {
      disposeDismiss();
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onDismiss);
    });
  });

  return (
    <Portal>
      <div
        ref={root}
        class="axis-context-menu"
        role="dialog"
        aria-label={props.label}
        data-testid="axis-context-menu"
        style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {/* Dialog shell so the shortcut hub leaves Escape for this menu. */}
        <div role="menu" aria-label={props.label}>
        <For each={props.items}>
          {(entry) => {
            if (entry.type === 'sep') return <hr class="axis-context-sep" />;
            const onClick = () => {
              if (entry.disabled) return;
              props.onSelect(entry.id);
              props.onClose();
            };
            const row = {
              class: 'axis-context-item',
              classList: {
                'is-active': !!entry.checked,
                'is-danger': !!entry.danger,
              },
              disabled: !!entry.disabled,
              'data-testid': `axis-context-${entry.id}`,
              onClick,
            };
            if (entry.checked == null) {
              return (
                <button type="button" role="menuitem" {...row}>
                  <span class="axis-context-label">{entry.label}</span>
                </button>
              );
            }
            if (entry.id.startsWith('type.')) {
              return (
                <button type="button" role="menuitemradio" aria-checked={entry.checked} {...row}>
                  <span class="axis-context-label">{entry.label}</span>
                </button>
              );
            }
            return (
              <button type="button" role="menuitemcheckbox" aria-checked={entry.checked} {...row}>
                <span class="axis-context-label">{entry.label}</span>
              </button>
            );
          }}
        </For>
        </div>
      </div>
    </Portal>
  );
};
