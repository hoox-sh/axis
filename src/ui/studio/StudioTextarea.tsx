// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio textarea — multiline input with optional autosize, counter, and the
 * same focus / invalid language as {@link StudioInput}.
 *
 * @module ui/studio/StudioTextarea
 */

import { Show, createEffect, createSignal, useContext } from 'solid-js';
import { StudioFieldContext } from './StudioField';

export function StudioTextarea(props: {
  id?: string;
  value?: string;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  invalid?: boolean;
  maxLength?: number;
  showCount?: boolean;
  /** Grow with content instead of showing a resize handle. */
  autosize?: boolean;
  testId?: string;
  ariaLabel?: string;
  class?: string;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
}) {
  const field = useContext(StudioFieldContext);
  const [live, setLive] = createSignal(props.value ?? '');
  let areaEl: HTMLTextAreaElement | undefined;

  createEffect(() => setLive(props.value ?? ''));

  const resize = () => {
    const el = areaEl;
    if (!el || !props.autosize) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  createEffect(() => {
    // Track programmatic value updates; typing resizes in onInput.
    props.value;
    resize();
  });

  const describedBy = () => [field?.hintId, field?.errorId].filter(Boolean).join(' ') || undefined;
  const nearLimit = () => {
    const max = props.maxLength;
    return max ? live().length >= Math.max(0, max - Math.ceil(max * 0.15)) : false;
  };

  return (
    <div
      class={`ax-textarea-shell${props.class ? ` ${props.class}` : ''}`}
      classList={{
        'is-invalid': !!props.invalid,
        'is-disabled': !!props.disabled,
        'is-autosize': !!props.autosize,
        'ax-textarea-shell--mono': !!props.mono,
      }}
    >
      <textarea
        ref={areaEl}
        id={props.id}
        class="ax-input ax-textarea"
        classList={{ 'ax-input--mono': !!props.mono }}
        value={props.value ?? ''}
        placeholder={props.placeholder}
        rows={props.autosize ? 1 : (props.rows ?? 3)}
        disabled={props.disabled}
        readonly={props.readonly}
        aria-invalid={props.invalid ? true : undefined}
        aria-describedby={describedBy()}
        aria-label={props.ariaLabel}
        maxLength={props.maxLength}
        data-testid={props.testId}
        onInput={(e) => {
          setLive(e.currentTarget.value);
          resize();
          props.onInput?.(e.currentTarget.value);
        }}
        onChange={(e) => {
          setLive(e.currentTarget.value);
          props.onChange?.(e.currentTarget.value);
        }}
        onBlur={(e) => props.onBlur?.(e.currentTarget.value)}
      />
      <Show when={props.showCount && props.maxLength}>
        <span
          class="ax-input-count"
          classList={{
            'is-near': nearLimit(),
            'is-over': live().length > (props.maxLength ?? 0),
          }}
          aria-hidden="true"
        >
          {live().length}/{props.maxLength}
        </span>
      </Show>
    </div>
  );
}
