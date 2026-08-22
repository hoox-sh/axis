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
 * Full-height sheet that slides in from the right.
 *
 * Used by Settings, Runtimes, and Wire so those surfaces share one chrome:
 * dimmed chart, large fields, room to scroll. Compact centered dialogs stay
 * for pickers (symbol, script settings, about).
 *
 * @module ui/AppDrawer
 */

import { type JSX, Show, onCleanup } from 'solid-js';
import { Icons } from './icons';
import { installFocusTrap } from './focus-trap';

export type AppDrawerWidth = 'md' | 'lg' | 'xl';

export type AppDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  titleId?: string;
  hint?: string;
  testId?: string;
  closeTestId?: string;
  width?: AppDrawerWidth;
  /** Extra class on the panel (e.g. architecture grid). */
  panelClass?: string;
  tabs?: JSX.Element;
  footer?: JSX.Element;
  headerRight?: JSX.Element;
  /** Drop body padding (nested managers / architecture grid). */
  flush?: boolean;
  children: JSX.Element;
};

const WIDTH_CLASS: Record<AppDrawerWidth, string> = {
  md: 'sc-drawer--md',
  lg: 'sc-drawer--lg',
  xl: 'sc-drawer--xl',
};

export function AppDrawer(props: AppDrawerProps) {
  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    }
  };
  const titleId = () => props.titleId || `${props.testId || 'axis-drawer'}-title`;

  return (
    <Show when={props.open}>
      <div
        class="sc-drawer-backdrop"
        onClick={onBackdrop}
        onKeyDown={onKey}
        role="presentation"
      >
        <aside
          class={`sc-drawer ${WIDTH_CLASS[props.width || 'md']} ${props.panelClass || ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId()}
          data-testid={props.testId}
          tabIndex={-1}
          ref={(el) => {
            if (!el) return;
            const dispose = installFocusTrap(el, { autoFocus: true });
            onCleanup(dispose);
          }}
        >
          <div class="sc-dialog-accent" />
          <header class="sc-drawer-header">
            <div class="min-w-0">
              <h2 id={titleId()} data-testid={titleId()} class="sc-drawer-title">
                {props.title}
              </h2>
              <Show when={props.hint}>
                <p class="sc-hint mt-1">{props.hint}</p>
              </Show>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              {props.headerRight}
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-2"
                onClick={() => props.onClose()}
                aria-label="Close"
                data-testid={props.closeTestId || (props.testId ? `${props.testId}-close` : undefined)}
              >
                <Icons.x />
              </button>
            </div>
          </header>
          <Show when={props.tabs}>{props.tabs}</Show>
          <div class={`sc-drawer-body${props.flush ? ' sc-drawer-body--flush' : ''}`}>
            {props.children}
          </div>
          <Show when={props.footer}>
            <footer class="sc-drawer-footer">{props.footer}</footer>
          </Show>
        </aside>
      </div>
    </Show>
  );
}
