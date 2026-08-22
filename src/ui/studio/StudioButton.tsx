// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio button — primary / ghost / danger. No `sc-btn`.
 *
 * @module ui/studio/StudioButton
 */

import type { JSX } from 'solid-js';

export type StudioButtonVariant = 'primary' | 'ghost' | 'danger';

export function StudioButton(props: {
  variant?: StudioButtonVariant;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  title?: string;
  testId?: string;
  ariaLabel?: string;
  class?: string;
  children: JSX.Element;
}) {
  const variant = () => props.variant || 'ghost';
  const mod =
    variant() === 'primary'
      ? 'ax-btn--primary'
      : variant() === 'danger'
        ? 'ax-btn--danger'
        : 'ax-btn--ghost';
  return (
    <button
      type={props.type || 'button'}
      class={`ax-btn ${mod}${props.class ? ` ${props.class}` : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      data-testid={props.testId}
      aria-label={props.ariaLabel}
    >
      {props.children}
    </button>
  );
}
