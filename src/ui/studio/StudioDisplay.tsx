// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio display primitives: card, stat, chip, status, empty, code, list.
 *
 * @module ui/studio/StudioDisplay
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

/**
 * Card container for studio content, with an optional kicker/title. When
 * `onClick` is supplied it renders as a button with `aria-pressed` reflecting
 * `selected`, so master-detail grids stay keyboard reachable.
 *
 * @param props - Kicker, title, click handler, selected state, and body.
 * @returns A `<button>` when clickable, otherwise a `<div>`.
 */
export function StudioCard(props: {
  kicker?: string;
  title?: string;
  onClick?: () => void;
  testId?: string;
  /** Visual selected state for master-detail grids. */
  selected?: boolean;
  children: JSX.Element;
}): JSX.Element {
  const className = () => `ax-card${props.selected ? ' is-on' : ''}`;
  const inner = (
    <>
      <Show when={props.kicker}>
        <span class="ax-card-kicker">{props.kicker}</span>
      </Show>
      <Show when={props.title}>
        <h3 class="ax-card-title">{props.title}</h3>
      </Show>
      {props.children}
    </>
  );
  if (props.onClick) {
    return (
      <button
        type="button"
        class={className()}
        classList={{ 'is-on': !!props.selected }}
        onClick={props.onClick}
        data-testid={props.testId}
        aria-pressed={!!props.selected}
      >
        {inner}
      </button>
    );
  }
  return (
    <div class={className()} data-testid={props.testId}>
      {inner}
    </div>
  );
}

/**
 * Label/value pair for compact metric readouts (endpoint, latency, counts).
 *
 * @param props - Metric label, already-rendered value node, and test id.
 * @returns A `div.ax-stat` with label and value spans.
 */
export function StudioStat(props: {
  label: string;
  value: JSX.Element;
  testId?: string;
}): JSX.Element {
  return (
    <div class="ax-stat" data-testid={props.testId}>
      <span class="ax-stat-label">{props.label}</span>
      <span class="ax-stat-value">{props.value}</span>
    </div>
  );
}

/**
 * Pressable filter/status chip. Disabled chips stay focusable-looking but
 * swallow clicks; `pressed` is exposed via `aria-pressed`.
 *
 * @param props - Pressed/disabled flags, click handler, title, and label.
 * @returns A `<button class="ax-chip">`.
 */
export function StudioChip(props: {
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
  title?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      class="ax-chip"
      classList={{
        'is-on': !!props.pressed,
        'is-disabled': !!props.disabled,
      }}
      aria-pressed={!!props.pressed}
      disabled={props.disabled}
      onClick={() => {
        if (props.disabled) return;
        props.onClick?.();
      }}
      data-testid={props.testId}
      title={props.title}
    >
      <span class="ax-chip-label">{props.children}</span>
    </button>
  );
}

/** Probe outcome vocabulary shared by Runtime/Wire/Workers status rows. */
export type StudioHealth = 'healthy' | 'degraded' | 'down' | 'idle' | 'unknown' | 'skipped';

/** Map probe status → visible word. Keep this as a function so Solid re-runs it. */
export function studioHealthLabel(status: StudioHealth, label?: string): string {
  if (label) return label;
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'down':
      return 'Down';
    case 'idle':
      return 'Idle';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Unknown';
  }
}

/**
 * Status pill whose dot color and word both follow `status`. Kept reactive so
 * an in-flight probe (`unknown`) repaints once the real result arrives.
 *
 * @param props - Health status and an optional label override.
 * @returns A `span.ax-status` with a `data-status` hook for styling/tests.
 */
export function StudioStatus(props: { status: StudioHealth; label?: string }): JSX.Element {
  // Do not close over props.status — first paint is often `unknown` (probe
  // in flight); the class string in JSX was reactive but the word was not,
  // so cards showed a green/red dot next to a frozen "Unknown".
  return (
    <span
      class="ax-status"
      classList={{ [`ax-status--${props.status}`]: true }}
      data-status={props.status}
    >
      {studioHealthLabel(props.status, props.label)}
    </span>
  );
}

/**
 * Muted "nothing here yet" paragraph used when a studio list has no rows.
 *
 * @param props - Empty-state copy.
 * @returns A `p.ax-empty`.
 */
export function StudioEmpty(props: { children: JSX.Element }): JSX.Element {
  return <p class="ax-empty">{props.children}</p>;
}

/**
 * Monospace preformatted block for payloads and log excerpts.
 *
 * @param props - Optional test id and the code content.
 * @returns A `pre.ax-code` wrapping `<code>`.
 */
export function StudioCode(props: { testId?: string; children: JSX.Element }): JSX.Element {
  return (
    <pre class="ax-code" data-testid={props.testId}>
      <code>{props.children}</code>
    </pre>
  );
}

/**
 * Unstyled list shell (`ul.ax-list`) so rows share spacing and separators.
 *
 * @param props - Optional extra class and the `<li>` children.
 * @returns A `ul.ax-list`.
 */
export function StudioList(props: { class?: string; children: JSX.Element }): JSX.Element {
  return <ul class={`ax-list${props.class ? ` ${props.class}` : ''}`}>{props.children}</ul>;
}

/**
 * List item shell (`li.ax-row`) matching {@link StudioList} spacing.
 *
 * @param props - Row content and optional test id.
 * @returns An `li.ax-row`.
 */
export function StudioRow(props: { children: JSX.Element; testId?: string }): JSX.Element {
  return (
    <li class="ax-row" data-testid={props.testId}>
      {props.children}
    </li>
  );
}
