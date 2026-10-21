// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { type JSX, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { dismissOnOutside } from './dismiss-on-outside';

/**
 * The shared popover shell.
 *
 * Four menus (chart layout, screenshot, extra widgets, the editor run split)
 * carried the same skeleton: an open flag, an anchor element, a measure-and-
 * clamp placement, a resize/scroll reposition, an outside-click dismiss, an
 * Escape handler and a portalled `sc-popover` element. Two of them had drifted
 * — one dismissed on `mousedown` where the others used `pointerdown`, and one
 * hand-rolled the outside check the shared helper already provided.
 *
 * This component owns that skeleton once.
 *
 * @module ui/Popover
 */

/** Props for {@link Popover}. */
export interface PopoverProps {
  /** Whether the popover is open. */
  open: boolean;
  /** The trigger element the popover is positioned against. */
  anchor: HTMLElement | undefined;
  /** Called when the popover should close. */
  onClose: () => void;
  /**
   * The popover width used for the on-screen clamp.
   *
   * Measured from the panel when omitted — use it when the panel's width is
   * content-driven rather than fixed.
   */
  width?: number;
  /** Extra classes for the popover element (on top of `sc-popover`). */
  class?: string;
  /** ARIA role of the popover element. */
  role?: 'menu' | 'dialog';
  /** `aria-label` of the popover element. */
  label?: string;
  /** `data-testid` of the popover element. */
  testId?: string;
  /**
   * Flip above the anchor when the popover does not fit below it.
   *
   * The extra-widgets panel grows with its ticker section, and the module bar
   * can sit low on a short viewport — without the flip it runs off-screen.
   */
  flip?: boolean;
  /** The popover content. */
  children: JSX.Element;
}

/** Viewport margin the popover keeps on every side. */
const MARGIN = 8;
/** Gap between the anchor and the popover, in px. */
const OFFSET = 4;

/**
 * The popover.
 *
 * Rendered only while `open` — the outside-dismiss listeners and the
 * reposition listeners exist for exactly as long as the popover does.
 */
export function Popover(props: PopoverProps) {
  return (
    <Show when={props.open}>
      <PopoverShell {...props} />
    </Show>
  );
}

/** The mounted part of the popover — owns the listeners and the placement. */
function PopoverShell(props: PopoverProps) {
  const [pos, setPos] = createSignal({ top: 0, left: 0 });
  let panelEl: HTMLDivElement | undefined;

  const place = () => {
    const el = props.anchor;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(
      props.width ?? panelEl?.offsetWidth ?? 240,
      window.innerWidth - 2 * MARGIN,
    );
    const left = Math.max(MARGIN, Math.min(r.right - width, window.innerWidth - width - MARGIN));
    let top = r.bottom + OFFSET;
    if (props.flip) {
      // Flip above the anchor when the panel would run off the bottom.
      const panelH = panelEl?.offsetHeight ?? 0;
      const below = window.innerHeight - r.bottom - OFFSET - MARGIN;
      if (panelH > 0 && below < panelH && r.top - OFFSET - panelH >= MARGIN) {
        top = r.top - OFFSET - panelH;
      }
    }
    setPos({ top, left });
  };

  // Place once mounted (the panel must exist to measure its height) and
  // re-place whenever the viewport moves.
  createEffect(() => {
    if (!props.open) return;
    place();
    const onReposition = () => place();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    const disposeDismiss = dismissOnOutside({
      inside: () => [props.anchor, panelEl],
      onDismiss: props.onClose,
    });
    onCleanup(() => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      disposeDismiss();
    });
  });

  return (
    <Portal>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is a prop — `menu` and `dialog` both take an accessible name */}
      <div
        ref={panelEl}
        class={`fixed z-[200] ${props.class ?? ''}`}
        style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
        role={props.role ?? 'dialog'}
        aria-label={props.label}
        data-testid={props.testId}
      >
        {props.children}
      </div>
    </Portal>
  );
}
