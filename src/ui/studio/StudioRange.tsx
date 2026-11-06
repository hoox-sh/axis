// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio range — native range input with a filled track, a live value chip,
 * and a keyboard-friendly focus ring. The fill is a single custom property so
 * dragging never touches layout.
 *
 * @module ui/studio/StudioRange
 */

import type { JSX } from 'solid-js';
import { Show, createEffect, createSignal } from 'solid-js';

/**
 * Range slider with a CSS-variable fill and a live value chip.
 *
 * The local value mirrors the prop so dragging repaints immediately without
 * waiting for the owner; `onInput` fires continuously while dragging and
 * `onChange` on commit. `format` drives both the chip and `aria-valuetext`.
 *
 * @param props - Value, bounds (default 0–100, step 1), formatter, and handlers.
 * @returns A range input plus optional value chip.
 */
export function StudioRange(props: {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  testId?: string;
  class?: string;
  ariaLabel?: string;
  /** Formats the value chip and `aria-valuetext`. */
  format?: (value: number) => string;
  /** Hide the value chip when the label already carries the value. */
  showValue?: boolean;
  onInput?: (value: number) => void;
  onChange?: (value: number) => void;
}): JSX.Element {
  const [live, setLive] = createSignal(props.value);
  createEffect(() => setLive(props.value));

  const min = () => props.min ?? 0;
  const max = () => props.max ?? 100;
  const step = () => props.step ?? 1;
  const pct = () => {
    const span = max() - min();
    if (!Number.isFinite(span) || span <= 0) return 0;
    return Math.max(0, Math.min(100, ((live() - min()) / span) * 100));
  };
  const label = () => (props.format ? props.format(live()) : String(live()));

  return (
    <div
      class={`ax-range-shell${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'is-disabled': !!props.disabled }}
      style={{ '--ax-range-fill': `${pct()}%` } as JSX.CSSProperties}
    >
      <input
        id={props.id}
        type="range"
        class="ax-range"
        min={min()}
        max={max()}
        step={step()}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        aria-valuemin={min()}
        aria-valuemax={max()}
        aria-valuenow={live()}
        aria-valuetext={label()}
        data-testid={props.testId}
        onInput={(e) => {
          const value = Number(e.currentTarget.value);
          setLive(value);
          props.onInput?.(value);
        }}
        onChange={(e) => props.onChange?.(Number(e.currentTarget.value))}
      />
      <Show when={props.showValue !== false}>
        <output class="ax-range-value" for={props.id}>
          {label()}
        </output>
      </Show>
    </div>
  );
}
