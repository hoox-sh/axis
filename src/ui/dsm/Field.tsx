// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'solid-js';

/** Compact labelled control used by the DSM panel and Dataset manager modal. */
export function DsmField(props: {
  label: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label class={`flex flex-col gap-0.5 ${props.class || ''}`}>
      <span class="text-muted text-[0.68rem] uppercase tracking-wide">{props.label}</span>
      {props.children}
    </label>
  );
}
