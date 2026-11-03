// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio button — primary / ghost / danger. No `sc-btn`.
 *
 * @module ui/studio/StudioButton
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export type StudioButtonVariant = 'primary' | 'ghost' | 'danger';

export function StudioButton(props: {
  variant?: StudioButtonVariant;
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** Busy / in-flight — keeps size stable and sets aria-busy. */
  loading?: boolean;
  onClick?: (e: MouseEvent) => void;
  title?: string;
  testId?: string;
  ariaLabel?: string;
  class?: string;
  children: JSX.Element;
}) {
  const variant = () => props.variant || 'ghost';
  const busy = () => !!props.loading;
  const blocked = () => !!props.disabled || busy();

  const className = () => {
    const mod =
      variant() === 'primary'
        ? 'ax-btn--primary'
        : variant() === 'danger'
          ? 'ax-btn--danger'
          : 'ax-btn--ghost';
    return `ax-btn ${mod}${busy() ? ' is-loading' : ''}${props.class ? ` ${props.class}` : ''}`;
  };

  return (
    <button
      type={props.type || 'button'}
      class={className()}
      disabled={blocked()}
      aria-busy={busy() ? true : undefined}
      aria-disabled={blocked() ? true : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if ((props.type || 'button') !== 'submit') e.preventDefault();
        if (blocked()) return;
        props.onClick?.(e);
      }}
      title={props.title}
      data-testid={props.testId}
      aria-label={props.ariaLabel}
    >
      <Show when={busy()}>
        <span class="ax-btn-spin" aria-hidden="true" />
      </Show>
      <span class="ax-btn-label">{props.children}</span>
    </button>
  );
}
