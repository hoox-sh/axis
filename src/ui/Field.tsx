// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'solid-js';

/**
 * Compact labelled control — the `sc-field` shape.
 *
 * One component for the whole app: the DSM panel, the Dataset manager modal
 * and the Script Library forms all render the same markup, so they all use
 * this one.
 */
export function ScField(props: { label: string; class?: string; children: JSX.Element }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label class={`sc-field min-w-0 ${props.class || ''}`}>
      <span class="sc-label">{props.label}</span>
      {props.children}
    </label>
  );
}
