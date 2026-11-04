// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One studio color field: swatch picker + text for hex, rgb(), rgba(),
 * CSS names, and Pine `color.*` enums.
 *
 * The text stays the source of truth (Pine accepts all four formats), while
 * the swatch, format chip, and validity edge give instant visual confirmation.
 *
 * @module ui/studio/StudioColorInput
 */

import { For, Show, createEffect, createMemo, createSignal, useContext } from 'solid-js';
import {
  PINE_NAMED_COLORS,
  parseColorInput,
  rewriteColorKeepingFormat,
  toCssRgba,
  toHex6,
} from '../../editor/pine-colors';
import { StudioFieldContext } from './StudioField';

const ENUM_OPTIONS = [
  ...Object.keys(PINE_NAMED_COLORS).map((n) => `color.${n}`),
  ...Object.keys(PINE_NAMED_COLORS),
];

function colorFormat(value: string): string {
  const v = value.trim();
  if (!v) return '—';
  if (v.startsWith('#')) return v.length > 7 ? 'HEX8' : 'HEX';
  if (/^rgba?\(/i.test(v)) return /^rgba/i.test(v) ? 'RGBA' : 'RGB';
  if (/^hsla?\(/i.test(v)) return /^hsla/i.test(v) ? 'HSLA' : 'HSL';
  if (/^color\./i.test(v)) return 'PINE';
  if (/^[a-z]+$/i.test(v)) return 'NAME';
  return '—';
}

export function StudioColorInput(props: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const field = useContext(StudioFieldContext);
  const [draft, setDraft] = createSignal(props.value);
  const [focused, setFocused] = createSignal(false);

  createEffect(() => {
    setDraft(props.value);
  });

  const parsed = createMemo(() => parseColorInput(draft()) || parseColorInput(props.value));
  const hex6 = () => {
    const c = parsed();
    return c ? toHex6(c).toLowerCase() : '#000000';
  };
  const preview = () => {
    const c = parsed();
    return c ? toCssRgba(c) : 'transparent';
  };
  const invalid = () => !!props.invalid || (draft().trim() !== '' && !parseColorInput(draft()));
  const format = () => colorFormat(draft());

  const commitText = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    if (parseColorInput(s)) props.onChange(s);
  };

  const onPick = (hex: string) => {
    const next = parseColorInput(hex);
    if (!next) return;
    props.onChange(rewriteColorKeepingFormat(props.value || draft(), next));
  };

  const listId = () => `${props.id || 'ax-color'}-enums`;
  const describedBy = () => [field?.hintId, field?.errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      class="ax-color-input"
      classList={{
        'is-invalid': invalid(),
        'is-focused': focused(),
        'is-disabled': !!props.disabled,
      }}
      data-testid={props.testId}
    >
      <span class="ax-color-input-swatch" title="Pick a color">
        <span class="ax-color-input-fill" style={{ background: preview() }} aria-hidden="true" />
        <input
          type="color"
          value={hex6()}
          disabled={props.disabled}
          aria-label="Color picker"
          onInput={(e) => onPick(e.currentTarget.value)}
        />
      </span>
      <input
        id={props.id}
        type="text"
        class="ax-input ax-input--mono ax-color-input-text"
        value={draft()}
        list={listId()}
        placeholder={props.placeholder || '#rrggbb, rgb(), rgba(), or color.red'}
        spellcheck={false}
        autocomplete="off"
        disabled={props.disabled}
        aria-invalid={invalid() ? true : undefined}
        aria-describedby={describedBy()}
        title={
          invalid()
            ? 'Unrecognized color — use #rrggbb, rgb(), rgba(), a CSS name, or color.name'
            : undefined
        }
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          commitText(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText(e.currentTarget.value);
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setDraft(props.value);
            e.currentTarget.blur();
          }
        }}
        onInput={(e) => {
          const v = e.currentTarget.value;
          setDraft(v);
          commitText(v);
        }}
      />
      <Show when={format() !== '—'}>
        <span class="ax-color-format" aria-hidden="true">
          {format()}
        </span>
      </Show>
      <datalist id={listId()}>
        <For each={ENUM_OPTIONS}>{(opt) => <option value={opt} />}</For>
      </datalist>
    </div>
  );
}
