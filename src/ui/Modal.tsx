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
 * The shared AXIS modal shell.
 *
 * Six dialogs carried the same chrome — backdrop, accent, header (title,
 * hint, close), body, footer — each with its own copy of the focus trap, the
 * Escape handling and the backdrop dismiss. One of them (the shortcuts modal)
 * had `aria-modal="true"` and **no** focus trap.
 *
 * This component owns that chrome once. The Escape listener is installed only
 * while the dialog is open, so a closed modal holds no listener.
 *
 * @module ui/Modal
 */

import { type JSX, Show, onCleanup } from 'solid-js';
import { useEventListener } from './use-event-listener';
import { installFocusTrap } from './focus-trap';
import { Icons } from './icons';

/** Props for {@link Modal}. */
export interface ModalProps {
  /** Whether the dialog is visible. When false, nothing is rendered. */
  open: boolean;
  /** Called when the dialog is dismissed. */
  onClose: () => void;
  /** Dialog title. */
  title: string;
  /** `id` of the title element — the dialog's `aria-labelledby`. */
  titleId: string;
  /** Secondary line under the title. */
  hint?: JSX.Element;
  /** Classes for the hint line. Defaults to `sc-hint`. */
  hintClass?: string;
  /** `data-testid` for the hint line. */
  hintTestId?: string;
  /** Classes for the dialog element (on top of `sc-dialog`). */
  class?: string;
  /** Classes for the body element (on top of `sc-dialog-body`). */
  bodyClass?: string;
  /** Classes for the backdrop element (on top of `sc-dialog-backdrop`). */
  backdropClass?: string;
  /** `data-testid` for the dialog element. */
  testId?: string;
  /** `data-testid` for the backdrop element. */
  backdropTestId?: string;
  /** `id` for the body element. */
  bodyId?: string;
  /** `aria-describedby` for the dialog element. */
  describedBy?: string;
  /** Content rendered before the title (a logo, a status icon). */
  headerLead?: JSX.Element;
  /** Extra header controls, rendered before the close button. */
  headerActions?: JSX.Element;
  /** Focus the first focusable element when the dialog opens. Default `true`. */
  autoFocus?: boolean;
  /** `aria-label` of the close button. Default `Close`. */
  closeLabel?: string;
  /** `data-testid` of the close button. */
  closeTestId?: string;
  /** Disable the close button (e.g. while a migration is in flight). */
  closeDisabled?: boolean;
  /** What the close button does. Defaults to {@link ModalProps.onClose}. */
  onCloseClick?: () => void;
  /**
   * What Escape does.
   *
   * Defaults to {@link ModalProps.onClose}. A dialog with its own Escape
   * semantics (abort a migration, for example) passes its own handler.
   */
  onEscape?: (e: KeyboardEvent) => void;
  /** What a backdrop click does. Defaults to {@link ModalProps.onClose}. */
  onBackdropClick?: (e: MouseEvent) => void;
  /** Key handler on the dialog element (arrow-key navigation, for example). */
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Called with the dialog element once it is mounted. */
  onDialogRef?: (el: HTMLDivElement) => void;
  /** Content between the header and the body (a tab row, for example). */
  aboveBody?: JSX.Element;
  /** Footer content. */
  footer?: JSX.Element;
  /** Body content. */
  children?: JSX.Element;
}

/**
 * The modal shell.
 *
 * Rendered only while `open` is true — the Escape listener and the focus trap
 * exist for exactly as long as the dialog does.
 */
export function Modal(props: ModalProps) {
  return (
    <Show when={props.open}>
      <ModalShell {...props} />
    </Show>
  );
}

/** The mounted part of the modal — owns the listeners and the focus trap. */
function ModalShell(props: ModalProps) {
  const close = () => (props.onCloseClick ?? props.onClose)();

  useEventListener<KeyboardEvent>(window, 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (props.onEscape) props.onEscape(e);
    else close();
  });

  const onBackdrop = (e: MouseEvent) => {
    // A click inside the dialog bubbles to the backdrop; only a click on the
    // backdrop itself dismisses.
    if (e.target !== e.currentTarget) return;
    if (props.onBackdropClick) props.onBackdropClick(e);
    else close();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop is an intentional click-away dismiss surface for the dialog
    <div
      class={`sc-dialog-backdrop ${props.backdropClass ?? ''}`}
      onClick={onBackdrop}
      role="presentation"
      data-testid={props.backdropTestId}
    >
      <div
        class={`sc-dialog ${props.class ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.titleId}
        aria-describedby={props.describedBy}
        data-testid={props.testId}
        tabIndex={-1}
        onKeyDown={props.onKeyDown}
        ref={(el) => {
          if (!el) return;
          // Tab cycles inside the dialog; dispose restores prior focus on close.
          const dispose = installFocusTrap(el, { autoFocus: props.autoFocus !== false });
          onCleanup(dispose);
          props.onDialogRef?.(el);
        }}
      >
        <div class="sc-dialog-accent" />

        <div class="sc-dialog-header">
          <div class="flex items-center gap-2.5 min-w-0">
            {props.headerLead}
            <div class="min-w-0">
              <div id={props.titleId} class="text-[0.95em] font-semibold text-text tracking-tight">
                {props.title}
              </div>
              {props.hint != null && (
                <div class={props.hintClass ?? 'sc-hint'} data-testid={props.hintTestId}>
                  {props.hint}
                </div>
              )}
            </div>
          </div>
          {props.headerActions}
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-2"
            onClick={close}
            aria-label={props.closeLabel ?? 'Close'}
            disabled={props.closeDisabled}
            data-testid={props.closeTestId}
          >
            <Icons.x />
          </button>
        </div>

        {props.aboveBody}

        <div id={props.bodyId} class={`sc-dialog-body ${props.bodyClass ?? ''}`}>
          {props.children}
        </div>

        {props.footer && <div class="sc-dialog-footer">{props.footer}</div>}
      </div>
    </div>
  );
}
