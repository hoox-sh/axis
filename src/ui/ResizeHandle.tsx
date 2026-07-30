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
 * Resize grip for docked panels (vertical or horizontal).
 * Pointer capture + body cursor while dragging; clamps size via min/max.
 * Direction encodes which way “grow” maps to client delta.
 */

import { Component, onCleanup } from 'solid-js';

export type ResizeDirection = 'grow-right' | 'grow-left' | 'grow-up' | 'grow-down';

interface Props {
  /** grow-right: drag right increases size (left-side panels)
   *  grow-left:  drag left increases size (right-side panels)
   *  grow-up:    drag up increases size (bottom panels)
   *  grow-down:  drag down increases size (top panels) */
  direction: ResizeDirection;
  getSize: () => number;
  setSize: (size: number) => void;
  min?: number;
  max?: number;
  class?: string;
}

function isVertical(dir: ResizeDirection): boolean {
  return dir === 'grow-right' || dir === 'grow-left';
}

/**
 * Drag handle on a panel border. Thin hit strip with void indigo hover.
 * Default min is 1px (border-width only).
 */
export const ResizeHandle: Component<Props> = (props) => {
  let dragging = false;
  let startPos = 0;
  let startSize = 0;

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startPos = isVertical(props.direction) ? e.clientX : e.clientY;
    startSize = props.getSize();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = isVertical(props.direction) ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const pos = isVertical(props.direction) ? e.clientX : e.clientY;
    const delta = pos - startPos;
    let raw: number;
    switch (props.direction) {
      case 'grow-right':
        raw = startSize + delta;
        break;
      case 'grow-left':
        raw = startSize - delta;
        break;
      case 'grow-down':
        raw = startSize + delta;
        break;
      case 'grow-up':
        raw = startSize - delta;
        break;
    }
    const min = props.min ?? 1;
    const max =
      props.max ??
      (isVertical(props.direction)
        ? Math.floor(window.innerWidth * 0.9)
        : Math.floor(window.innerHeight * 0.9));
    props.setSize(Math.min(Math.max(raw, min), max));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  onCleanup(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  const orientation = () => (isVertical(props.direction) ? 'vertical' : 'horizontal');
  const handleClass = () =>
    isVertical(props.direction) ? 'sc-resize-handle' : 'sc-pane-resize-handle';

  return (
    <div
      class={`${handleClass()} ${props.class || ''}`}
      role="separator"
      aria-orientation={orientation()}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
};
