// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio form primitives: field, input, select, toggle, hint.
 *
 * The input is the smallest unit of trust in a trading terminal. These
 * primitives answer four questions at a glance: what is this, is it valid,
 * what will happen when I press Enter, and how do I undo it. Chrome carries
 * the state; the native control keeps semantics.
 *
 * @module ui/studio/StudioField
 */

import type { JSX } from 'solid-js';
import {
  Show,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  useContext,
} from 'solid-js';
import { Icons } from '../icons';
import { stepNativeInput } from './step-input';

export type StudioFieldContextValue = {
  hintId?: string;
  errorId?: string;
};

export const StudioFieldContext = createContext<StudioFieldContextValue | undefined>(undefined);

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function StudioHint(props: { class?: string; children: JSX.Element }) {
  return <p class={`ax-hint${props.class ? ` ${props.class}` : ''}`}>{props.children}</p>;
}

export function StudioField(props: {
  label?: JSX.Element;
  for?: string;
  hint?: JSX.Element;
  error?: JSX.Element;
  /** Positive confirmation shown only when there is no error. */
  success?: JSX.Element;
  /** Renders an “Optional” tag beside the label. */
  optional?: boolean;
  /** Renders a red required marker beside the label. */
  required?: boolean;
  /** Right-aligned counter, e.g. `12 / 64`. */
  counter?: string;
  /** Extra label-row content (badges, links, shortcuts). */
  labelEnd?: JSX.Element;
  testId?: string;
  class?: string;
  children: JSX.Element;
}) {
  const uid = createUniqueId();
  const hintId = () => (props.hint ? `${uid}-hint` : undefined);
  const errorId = () => (props.error ? `${uid}-error` : undefined);
  const hasHead = () =>
    Boolean(props.label || props.labelEnd || props.counter || props.optional || props.required);

  return (
    <div
      class={`ax-field${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'is-invalid': !!props.error }}
      data-testid={props.testId}
      data-invalid={props.error ? 'true' : undefined}
    >
      <Show when={hasHead()}>
        <div class="ax-field-head">
          <Show when={props.label}>
            <label class="ax-label" for={props.for}>
              {props.label}
              <Show when={props.required}>
                <span class="ax-field-req" aria-hidden="true">
                  *
                </span>
              </Show>
            </label>
          </Show>
          <span class="ax-field-meta">
            {props.labelEnd}
            <Show when={props.counter}>
              <span class="ax-field-counter">{props.counter}</span>
            </Show>
            <Show when={props.optional}>
              <span class="ax-field-tag">Optional</span>
            </Show>
          </span>
        </div>
      </Show>
      <StudioFieldContext.Provider value={{ hintId: hintId(), errorId: errorId() }}>
        {props.children}
      </StudioFieldContext.Provider>
      <Show when={props.hint}>
        <p class="ax-hint" id={hintId()}>
          {props.hint}
        </p>
      </Show>
      <Show when={props.error}>
        <p class="ax-error" id={errorId()} role="alert">
          <span class="ax-error-mark" aria-hidden="true">
            <Icons.alert />
          </span>
          <span>{props.error}</span>
        </p>
      </Show>
      <Show when={props.success && !props.error}>
        <p class="ax-success" role="status">
          <span class="ax-success-mark" aria-hidden="true">
            <Icons.check />
          </span>
          <span>{props.success}</span>
        </p>
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
  readonly?: boolean;
  invalid?: boolean;
  /** Positive state: a check replaces the trailing space. */
  valid?: boolean;
  /** Async validation in flight. */
  loading?: boolean;
  testId?: string;
  autocomplete?: string;
  spellcheck?: boolean;
  min?: number;
  max?: number;
  /** Numeric step, or `'any'` for free-form numbers (prices, percents). */
  step?: number | 'any';
  inputmode?: 'text' | 'none' | 'search' | 'numeric' | 'url' | 'decimal' | 'email' | 'tel';
  /** Leading adornment (usually an icon). */
  icon?: JSX.Element;
  /** Static leading text, e.g. `https://`. */
  prefix?: JSX.Element | string;
  /** Static trailing text, e.g. `ms`. */
  suffix?: JSX.Element | string;
  /** Shortcut hint shown while the field is empty and unfocused. */
  kbd?: string;
  /** Show a clear button once there is a value. Defaults to true. */
  clearable?: boolean;
  /** Copy-to-clipboard action (tokens, URLs, secrets). */
  copyable?: boolean;
  /** Password reveal. Defaults to true for `type="password"`. */
  reveal?: boolean;
  /** Character counter; pair with `maxLength`. */
  showCount?: boolean;
  maxLength?: number;
  /** Dense shell for inline rows (Pine `inline=` clusters, dock panels). */
  compact?: boolean;
  selectOnFocus?: boolean;
  ariaLabel?: string;
  title?: string;
  class?: string;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
  onFocus?: (value: string) => void;
  onEnter?: (value: string) => void;
  onEscape?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => void;
}) {
  const field = useContext(StudioFieldContext);
  const [live, setLive] = createSignal(
    props.value === undefined || props.value === null ? '' : String(props.value),
  );
  const [revealed, setRevealed] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let inputEl: HTMLInputElement | undefined;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    setLive(props.value === undefined || props.value === null ? '' : String(props.value));
  });

  onCleanup(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  const type = () => (props.type === 'password' && revealed() ? 'text' : props.type || 'text');
  const isPassword = () => props.type === 'password';
  const showReveal = () => isPassword() && props.reveal !== false && !props.disabled;
  const showClear = () =>
    props.clearable !== false && !props.disabled && !props.readonly && live().length > 0;
  const showCopy = () => !!props.copyable && !props.disabled && live().length > 0;
  const showStepper = () => props.type === 'number' && !props.disabled && !props.readonly;
  const describedBy = () => [field?.hintId, field?.errorId].filter(Boolean).join(' ') || undefined;
  const nearLimit = () => {
    const max = props.maxLength;
    return max ? live().length >= Math.max(0, max - Math.ceil(max * 0.15)) : false;
  };

  const emitInput = (value: string) => {
    setLive(value);
    props.onInput?.(value);
  };

  const clear = () => {
    if (inputEl) {
      inputEl.value = '';
      inputEl.focus();
    }
    setLive('');
    props.onInput?.('');
    props.onChange?.('');
  };

  const bump = (direction: 1 | -1) => {
    const el = inputEl;
    if (!el) return;
    const value = stepNativeInput(el, direction);
    if (value == null) return;
    // The native step already dispatched `input` + `change`, which the
    // handlers above forward to `onInput` / `onChange` exactly once. Calling
    // the props here as well fired every stepper click twice.
    setLive(value);
  };

  const copy = async () => {
    if (!live()) return;
    const ok = await writeClipboard(live());
    if (!ok) return;
    setCopied(true);
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      class={`ax-input-shell${props.class ? ` ${props.class}` : ''}`}
      classList={{
        'ax-input-shell--mono': !!props.mono,
        'ax-input-shell--number': props.type === 'number',
        'ax-shell--compact': !!props.compact,
        'is-invalid': !!props.invalid,
        'is-valid': !!props.valid,
        'is-disabled': !!props.disabled,
        'is-readonly': !!props.readonly,
        'is-loading': !!props.loading,
        'has-value': live().length > 0,
      }}
    >
      <Show when={props.icon}>
        <span class="ax-input-adorn ax-input-adorn--lead" aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <Show when={props.prefix}>
        <span class="ax-input-prefix">{props.prefix}</span>
      </Show>
      <input
        ref={inputEl}
        id={props.id}
        type={type()}
        class="ax-input ax-input--bare"
        classList={{ 'ax-input--mono': !!props.mono }}
        value={props.value ?? ''}
        placeholder={props.placeholder}
        disabled={props.disabled}
        readonly={props.readonly}
        aria-invalid={props.invalid ? true : undefined}
        aria-busy={props.loading ? true : undefined}
        aria-describedby={describedBy()}
        aria-label={props.ariaLabel}
        title={props.title}
        data-testid={props.testId}
        autocomplete={props.autocomplete}
        spellcheck={props.spellcheck}
        min={props.min}
        max={props.max}
        step={props.step}
        inputmode={props.inputmode}
        maxLength={props.maxLength}
        onInput={(e) => emitInput(e.currentTarget.value)}
        onChange={(e) => {
          setLive(e.currentTarget.value);
          props.onChange?.(e.currentTarget.value);
        }}
        onBlur={(e) => props.onBlur?.(e.currentTarget.value)}
        onFocus={(e) => {
          if (props.selectOnFocus) e.currentTarget.select();
          props.onFocus?.(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onEnter?.(e.currentTarget.value);
          if (e.key === 'Escape') props.onEscape?.(e.currentTarget.value);
          props.onKeyDown?.(e);
        }}
      />
      <Show when={props.suffix}>
        <span class="ax-input-suffix">{props.suffix}</span>
      </Show>
      <Show when={props.kbd && live().length === 0}>
        <kbd class="ax-input-kbd">{props.kbd}</kbd>
      </Show>
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
      <span class="ax-input-actions">
        <Show when={props.loading}>
          <span class="ax-input-spin" aria-hidden="true" />
        </Show>
        <Show when={!props.loading && props.valid}>
          <span class="ax-input-status is-success" aria-hidden="true">
            <Icons.check />
          </span>
        </Show>
        <Show when={!props.loading && props.invalid}>
          <span class="ax-input-status is-danger" aria-hidden="true">
            <Icons.alert />
          </span>
        </Show>
        <Show when={showCopy()}>
          <button
            type="button"
            class="ax-input-action"
            classList={{ 'is-success': copied() }}
            title={copied() ? 'Copied' : 'Copy'}
            aria-label={copied() ? 'Copied' : 'Copy value'}
            onClick={() => void copy()}
          >
            <Show when={copied()} fallback={<Icons.copy />}>
              <Icons.check />
            </Show>
          </button>
        </Show>
        <Show when={showReveal()}>
          <button
            type="button"
            class="ax-input-action"
            title={revealed() ? 'Hide value' : 'Show value'}
            aria-label={revealed() ? 'Hide value' : 'Show value'}
            aria-pressed={revealed()}
            onClick={() => setRevealed((v) => !v)}
          >
            <Show when={revealed()} fallback={<Icons.eye />}>
              <Icons.eyeOff />
            </Show>
          </button>
        </Show>
        <Show when={showClear()}>
          <button
            type="button"
            class="ax-input-action ax-input-action--clear"
            title="Clear"
            aria-label="Clear value"
            onClick={clear}
          >
            <Icons.x />
          </button>
        </Show>
      </span>
      <Show when={showStepper()}>
        <span class="ax-input-stepper">
          <button
            type="button"
            class="ax-input-step"
            aria-label="Increase value"
            onClick={() => bump(1)}
          >
            <Icons.chevronUp />
          </button>
          <button
            type="button"
            class="ax-input-step"
            aria-label="Decrease value"
            onClick={() => bump(-1)}
          >
            <Icons.chevronDown />
          </button>
        </span>
      </Show>
    </div>
  );
}

export function StudioSelect(props: {
  id?: string;
  value?: string;
  disabled?: boolean;
  invalid?: boolean;
  testId?: string;
  icon?: JSX.Element;
  /** Dense shell for inline rows (Pine `inline=` clusters, dock panels). */
  compact?: boolean;
  ariaLabel?: string;
  title?: string;
  class?: string;
  onChange?: (value: string) => void;
  children: JSX.Element;
}) {
  const field = useContext(StudioFieldContext);
  const describedBy = () => [field?.hintId, field?.errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      class={`ax-select-shell${props.class ? ` ${props.class}` : ''}`}
      classList={{
        'is-invalid': !!props.invalid,
        'is-disabled': !!props.disabled,
        'has-icon': !!props.icon,
        'ax-shell--compact': !!props.compact,
      }}
    >
      <Show when={props.icon}>
        <span class="ax-input-adorn ax-input-adorn--lead" aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <select
        id={props.id}
        class="ax-input ax-select ax-select--bare"
        value={props.value}
        disabled={props.disabled}
        aria-invalid={props.invalid ? true : undefined}
        aria-describedby={describedBy()}
        aria-label={props.ariaLabel}
        title={props.title}
        data-testid={props.testId}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
      >
        {props.children}
      </select>
      <span class="ax-select-chevron" aria-hidden="true">
        <Icons.chevronDown />
      </span>
    </div>
  );
}

export function StudioToggle(props: {
  id?: string;
  checked: boolean;
  label: JSX.Element;
  hint?: JSX.Element;
  testId?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  class?: string;
  onChange: (checked: boolean) => void;
}) {
  const autoId = createUniqueId();
  const inputId = () => props.id || autoId;
  const hintId = () => `${autoId}-toggle-hint`;

  return (
    <label
      class={`ax-toggle ax-toggle--${props.size || 'md'}${props.class ? ` ${props.class}` : ''}`}
      classList={{
        'is-checked': props.checked,
        'is-disabled': !!props.disabled,
      }}
      for={inputId()}
    >
      <input
        id={inputId()}
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        aria-checked={props.checked}
        aria-describedby={props.hint ? hintId() : undefined}
        data-testid={props.testId}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span class="ax-toggle-copy">
        <span class="ax-toggle-title">{props.label}</span>
        <Show when={props.hint}>
          <span class="ax-toggle-hint" id={hintId()}>
            {props.hint}
          </span>
        </Show>
      </span>
    </label>
  );
}
