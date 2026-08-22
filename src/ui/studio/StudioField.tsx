// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio form primitives: field, input, select, toggle, hint.
 *
 * @module ui/studio/StudioField
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export function StudioHint(props: { class?: string; children: JSX.Element }) {
  return <p class={`ax-hint${props.class ? ` ${props.class}` : ''}`}>{props.children}</p>;
}

export function StudioField(props: {
  label?: string;
  for?: string;
  hint?: JSX.Element;
  error?: JSX.Element;
  testId?: string;
  children: JSX.Element;
}) {
  return (
    <div class="ax-field" data-testid={props.testId}>
      <Show when={props.label}>
        <label class="ax-label" for={props.for}>
          {props.label}
        </label>
      </Show>
      {props.children}
      <Show when={props.hint}>
        <p class="ax-hint">{props.hint}</p>
      </Show>
      <Show when={props.error}>
        <p class="ax-error">{props.error}</p>
      </Show>
    </div>
  );
}

export function StudioInput(props: {
  id?: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  testId?: string;
  autocomplete?: string;
  spellcheck?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
}) {
  return (
    <input
      id={props.id}
      type={props.type || 'text'}
      class={`ax-input${props.mono ? ' ax-input--mono' : ''}`}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      disabled={props.disabled}
      data-testid={props.testId}
      autocomplete={props.autocomplete}
      spellcheck={props.spellcheck}
      min={props.min}
      max={props.max}
      step={props.step}
      onInput={(e) => props.onInput?.(e.currentTarget.value)}
      onChange={(e) => props.onChange?.(e.currentTarget.value)}
      onBlur={(e) => props.onBlur?.(e.currentTarget.value)}
    />
  );
}

export function StudioSelect(props: {
  id?: string;
  value?: string;
  disabled?: boolean;
  testId?: string;
  onChange?: (value: string) => void;
  children: JSX.Element;
}) {
  return (
    <select
      id={props.id}
      class="ax-input ax-select"
      value={props.value}
      disabled={props.disabled}
      data-testid={props.testId}
      onChange={(e) => props.onChange?.(e.currentTarget.value)}
    >
      {props.children}
    </select>
  );
}

export function StudioToggle(props: {
  id?: string;
  checked: boolean;
  label: string;
  hint?: JSX.Element;
  testId?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="ax-toggle" for={props.id}>
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span>
        <span class="ax-toggle-title">{props.label}</span>
        <Show when={props.hint}>
          <span class="ax-toggle-hint">{props.hint}</span>
        </Show>
      </span>
    </label>
  );
}
