/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * AppButton — next-gen app button covering the three Storybook design
 * explorations (soft / signal / term) plus the shared microfeedback
 * layer (contact → process → outcome). Compositor-only animations,
 * height-stable loading, auto promise handling, reduced-motion safe.
 *
 * Shapes beyond the classic rectangle: `pill` (chips/filters), `orb`
 * (circular icon action), `cut` (chamfered tech CTA), `tab` (borderless
 * underline for module bars). All shapes share tones, sizes, and the
 * microfeedback contract — see Studio/ButtonDesigns → Shapes.
 *
 * @module ui/studio/AppButton
 */

import { Show, createSignal, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';

export type ButtonDesign = 'soft' | 'signal' | 'term';
export type ButtonTone = 'primary' | 'ghost' | 'danger' | 'success' | 'warning';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';
export type ButtonShape = 'rect' | 'pill' | 'orb' | 'cut' | 'tab';
export type FeedbackState = 'idle' | 'loading' | 'success' | 'error';

export function AppButton(props: {
  design?: ButtonDesign;
  tone?: ButtonTone;
  size?: ButtonSize;
  shape?: ButtonShape;
  /** Controlled feedback state. Omit for automatic promise handling. */
  feedback?: FeedbackState;
  /** Force loading (uncontrolled convenience). */
  loading?: boolean;
  /** Pressed/toggled state (interval selected, engine active). */
  active?: boolean;
  /** Full-width block button (dialog footers, stacked forms). */
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  testId?: string;
  ariaLabel?: string;
  kbd?: string;
  icon?: JSX.Element;
  /** Live dot (pairs the button with ambient status, e.g. Live). */
  live?: boolean;
  liveOn?: boolean;
  /** Disable the pointer ripple dot. */
  noRipple?: boolean;
  class?: string;
  onClick?: (e: MouseEvent) => void | Promise<unknown>;
  children?: JSX.Element;
}) {
  const design = () => props.design ?? 'soft';
  const tone = () => props.tone ?? 'ghost';
  const shape = () => props.shape ?? 'rect';
  const size = () => {
    if (props.size) return props.size;
    // Icon-only cells: orb takes the md disc, everything else the square cell.
    if (props.icon && !props.children) return shape() === 'orb' ? 'md' : 'icon';
    return design() === 'term' ? 'sm' : 'md';
  };

  const [auto, setAuto] = createSignal<FeedbackState>('idle');
  const state = (): FeedbackState => {
    if (props.feedback) return props.feedback;
    if (props.loading) return 'loading';
    return auto();
  };
  let successTimer: ReturnType<typeof setTimeout> | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let dotsRoot: HTMLButtonElement | undefined;

  onCleanup(() => {
    if (successTimer) clearTimeout(successTimer);
    if (errorTimer) clearTimeout(errorTimer);
  });

  const settle = (next: Exclude<FeedbackState, 'idle' | 'loading'>) => {
    if (props.feedback) return; // controlled — owner clears the state
    setAuto(next);
    const hold = 900;
    const timer = setTimeout(() => setAuto('idle'), hold);
    if (next === 'success') successTimer = timer;
    else errorTimer = timer;
  };

  const spawnDot = (e: MouseEvent) => {
    if (props.noRipple || !dotsRoot) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const r = dotsRoot.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'axd-dot';
    dot.style.left = `${e.clientX - r.left}px`;
    dot.style.top = `${e.clientY - r.top}px`;
    dotsRoot.appendChild(dot);
    setTimeout(() => dot.remove(), 500);
  };

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if ((props.type ?? 'button') !== 'submit') e.preventDefault();
    if (props.disabled || state() === 'loading') return;
    spawnDot(e);
    try {
      const out = props.onClick?.(e);
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        if (!props.feedback && !props.loading) setAuto('loading');
        (out as Promise<unknown>).then(
          () => settle('success'),
          () => settle('error'),
        );
      }
    } catch {
      settle('error');
    }
  };

  const cls = () => {
    const s = state();
    return [
      'axd-btn',
      `axd-${design()}`,
      `axd-btn--${tone()}`,
      `axd-btn--${size()}`,
      `axd-shape-${shape()}`,
      s === 'loading' ? 'is-loading' : '',
      s === 'success' ? 'is-success' : '',
      s === 'error' ? 'is-error' : '',
      props.active ? 'is-active' : '',
      props.block ? 'axd-btn--block' : '',
      props.class ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  /** Icon-only cells show the spinner/check alone — no crowded doubling. */
  const showIcon = () => {
    if (!props.icon) return false;
    if (!props.children && (state() === 'loading' || state() === 'success')) return false;
    return true;
  };

  return (
    <button
      ref={dotsRoot}
      type={props.type ?? 'button'}
      class={cls()}
      disabled={props.disabled || state() === 'loading'}
      aria-busy={state() === 'loading'}
      aria-pressed={props.active ?? undefined}
      aria-live="polite"
      title={props.title}
      data-testid={props.testId}
      data-design={design()}
      data-tone={tone()}
      data-shape={shape()}
      aria-label={props.ariaLabel}
      onClick={handleClick}
    >
      <Show when={state() === 'loading'}>
        <span class="axd-spin" aria-hidden="true" />
      </Show>
      <Show when={state() === 'success'}>
        <span class="axd-check" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 8.5 6.5 12 13 4.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </Show>
      <Show when={props.live}>
        <span class={`axd-live${props.liveOn ? ' is-on' : ''}`} aria-hidden="true" />
      </Show>
      <Show when={showIcon()}>
        <span class="axd-btn__icon" aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <Show when={props.children}>
        <span class="axd-btn__label">
          {state() === 'loading'
            ? 'Working…'
            : state() === 'success'
              ? 'Done'
              : state() === 'error'
                ? 'Retry'
                : props.children}
        </span>
      </Show>
      <Show when={props.kbd && props.children}>
        <span class="axd-kbd" aria-hidden="true">
          {props.kbd}
        </span>
      </Show>
      <Show when={state() === 'loading'}>
        <span class="axd-fill" aria-hidden="true" />
      </Show>
    </button>
  );
}
