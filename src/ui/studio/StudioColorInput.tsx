// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One studio color field: swatch picker + text for hex, rgb(), rgba(),
 * CSS names, and Pine `color.*` enums.
 *
 * @module ui/studio/StudioColorInput
 */

import { For, createEffect, createMemo, createSignal } from 'solid-js';
import {
  PINE_NAMED_COLORS,
  parseColorInput,
  rewriteColorKeepingFormat,
  toCssRgba,
  toHex6,
} from '../../editor/pine-colors';

const ENUM_OPTIONS = [
  ...Object.keys(PINE_NAMED_COLORS).map((n) => `color.${n}`),
  ...Object.keys(PINE_NAMED_COLORS),
];

export function StudioColorInput(props: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = createSignal(props.value);

  createEffect(() => {
    setDraft(props.value);
  });

  const parsed = createMemo(
    () => parseColorInput(draft()) || parseColorInput(props.value),
  );
  const hex6 = () => {
    const c = parsed();
    return c ? toHex6(c).toLowerCase() : '#000000';
  };
  const preview = () => {
    const c = parsed();
    return c ? toCssRgba(c) : 'transparent';
  };

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

  return (
    <div class="ax-color-input" data-testid={props.testId}>
      <span class="ax-color-input-swatch" title="Pick a color">
        <span class="ax-color-input-fill" style={{ background: preview() }} aria-hidden="true" />
        <input
          type="color"
          value={hex6()}
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
        onInput={(e) => {
          const v = e.currentTarget.value;
          setDraft(v);
          commitText(v);
        }}
        onBlur={(e) => commitText(e.currentTarget.value)}
      />
      <datalist id={listId()}>
        <For each={ENUM_OPTIONS}>{(opt) => <option value={opt} />}</For>
      </datalist>
    </div>
  );
}
