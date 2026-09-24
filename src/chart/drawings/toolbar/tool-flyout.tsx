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
 * Drawing-rail flyout — the multi-tool picker for one group.
 *
 * Owns listbox semantics (roving focus, ArrowUp/Down/Home/End, Escape to
 * close and return focus) so `DrawingToolbar` stays a composition root.
 *
 * @module chart/drawings/toolbar/tool-flyout
 */

import { type Component, For, onMount } from 'solid-js';
import type { DrawingToolId } from '../../drawing-types';
import { toolLabel } from '../../drawing-types';
import { DrawingToolIcon } from '../tool-icons';
import { TOOL_ICON_PX, TOOL_ICON_STROKE, TOOL_SHORTCUT, titleWithShortcut } from './shortcuts';

export const ToolFlyout: Component<{
  tools: DrawingToolId[];
  activeId: DrawingToolId;
  dockTop?: boolean;
  clamp?: Record<string, string>;
  onSelect: (id: DrawingToolId) => void;
  onClose: () => void;
}> = (props) => {
  let listRef: HTMLDivElement | undefined;

  onMount(() => {
    listRef?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  });

  const onKey = (e: KeyboardEvent) => {
    const items = listRef?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const current = document.activeElement as HTMLElement | null;
    const idx = current ? Array.from(items).indexOf(current) : -1;
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const next = items[(idx + dir + items.length) % items.length];
      next?.focus();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      class={`axis-draw-pop axis-draw-flyout ${props.dockTop ? 'is-top' : 'is-side'}`}
      role="menu"
      aria-label="Tool options"
      style={props.clamp}
      data-drawing-flyout
      onKeyDown={onKey}
    >
      <For each={props.tools}>
        {(tid) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={props.activeId === tid}
            class="axis-draw-flyout-item"
            classList={{ 'is-active': props.activeId === tid }}
            title={titleWithShortcut(toolLabel(tid), TOOL_SHORTCUT[tid])}
            onClick={() => props.onSelect(tid)}
          >
            <DrawingToolIcon id={tid} size={TOOL_ICON_PX} strokeWidth={TOOL_ICON_STROKE} />
            <span>{toolLabel(tid)}</span>
          </button>
        )}
      </For>
    </div>
  );
};
