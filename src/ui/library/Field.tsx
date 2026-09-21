// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'solid-js';

/** Compact labelled control for the Script Library forms. */
export function LibraryField(props: {
  label: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label class={`sc-field min-w-0 ${props.class || ''}`}>
      <span class="sc-label">{props.label}</span>
      {props.children}
    </label>
  );
}
