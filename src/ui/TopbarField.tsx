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
 * Compact topbar form field with an integrated label (floating-in-border).
 *
 * Replaces separate `sc-label` + `sc-input` pairs for dense trading chrome:
 *
 * ```
 * ┌─ SYMBOL ─────────┐
 * │ BTCUSDT          │
 * └──────────────────┘
 * ```
 *
 * @module ui/TopbarField
 */

import { Component, JSX, Show, splitProps } from 'solid-js';

export type TopbarFieldVariant = 'input' | 'select' | 'static';

export type TopbarFieldProps = {
  /** Uppercase integrated label text */
  label: string;
  /** Control id (also wires label `for`) */
  id?: string;
  /** Tooltip on the field shell */
  title?: string;
  /** Extra classes on the field shell */
  class?: string;
  /** `data-testid` on the interactive control (select/input), not the shell */
  testId?: string;
  /** Field kind — default `input` */
  variant?: TopbarFieldVariant;
  /** Monospace control text (symbols) */
  mono?: boolean;
  /** Static / read-only body (variant `static`) or select options */
  children?: JSX.Element;
  /** Disabled state for input/select */
  disabled?: boolean;
  value?: string | number | string[];
  placeholder?: string;
  onChange?: JSX.EventHandlerUnion<HTMLInputElement | HTMLSelectElement, Event>;
  onInput?: JSX.EventHandlerUnion<HTMLInputElement, InputEvent>;
  onBlur?: JSX.EventHandlerUnion<HTMLInputElement | HTMLSelectElement, FocusEvent>;
  onKeyDown?: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent>;
  spellcheck?: boolean;
  autocomplete?: string;
  name?: string;
};

/**
 * Integrated-label field for the workspace top bar.
 * Focus ring lives on the shell (`.axis-tb-field:focus-within`).
 */
export const TopbarField: Component<TopbarFieldProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'label',
    'id',
    'title',
    'class',
    'testId',
    'variant',
    'mono',
    'children',
    'disabled',
    'value',
    'placeholder',
    'onChange',
    'onInput',
    'onBlur',
    'onKeyDown',
    'spellcheck',
    'autocomplete',
    'name',
  ]);

  const variant = () => local.variant ?? 'input';
  const controlId = () => local.id;
  const shellClass = () =>
    [
      'axis-tb-field',
      local.mono ? 'axis-tb-field--mono' : '',
      variant() === 'select' ? 'axis-tb-field--select' : '',
      variant() === 'static' ? 'axis-tb-field--static' : '',
      local.disabled ? 'axis-tb-field--disabled' : '',
      local.class || '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <div class={shellClass()} title={local.title} {...rest}>
      <label class="axis-tb-field-label" for={controlId() || undefined}>
        {local.label}
      </label>

      <Show when={variant() === 'input'}>
        <input
          type="text"
          id={controlId()}
          class="axis-tb-field-control"
          data-testid={local.testId}
          disabled={local.disabled}
          value={local.value as string | number | undefined}
          name={local.name}
          placeholder={local.placeholder}
          spellcheck={local.spellcheck}
          autocomplete={local.autocomplete as JSX.HTMLAutocomplete | undefined}
          onInput={local.onInput}
          onChange={local.onChange as JSX.EventHandlerUnion<HTMLInputElement, Event> | undefined}
          onBlur={local.onBlur as JSX.EventHandlerUnion<HTMLInputElement, FocusEvent> | undefined}
          onKeyDown={local.onKeyDown}
        />
      </Show>

      <Show when={variant() === 'select'}>
        <select
          id={controlId()}
          class="axis-tb-field-control"
          data-testid={local.testId}
          disabled={local.disabled}
          value={local.value as string | number | string[] | undefined}
          name={local.name}
          onChange={local.onChange as JSX.EventHandlerUnion<HTMLSelectElement, Event> | undefined}
          onBlur={local.onBlur as JSX.EventHandlerUnion<HTMLSelectElement, FocusEvent> | undefined}
        >
          {local.children}
        </select>
      </Show>

      <Show when={variant() === 'static'}>
        <div
          id={controlId()}
          class="axis-tb-field-control axis-tb-field-control--static"
          data-testid={local.testId}
        >
          {local.children ?? local.value}
        </div>
      </Show>
    </div>
  );
};
