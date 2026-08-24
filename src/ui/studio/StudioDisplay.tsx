// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio display primitives: card, stat, chip, status, empty, code, list.
 *
 * @module ui/studio/StudioDisplay
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export function StudioCard(props: {
  kicker?: string;
  title?: string;
  onClick?: () => void;
  testId?: string;
  /** Visual selected state for master-detail grids. */
  selected?: boolean;
  children: JSX.Element;
}) {
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

export function StudioStat(props: { label: string; value: JSX.Element; testId?: string }) {
  return (
    <div class="ax-stat" data-testid={props.testId}>
      <span class="ax-stat-label">{props.label}</span>
      <span class="ax-stat-value">{props.value}</span>
    </div>
  );
}

export function StudioChip(props: {
  pressed?: boolean;
  onClick?: () => void;
  testId?: string;
  title?: string;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class={`ax-chip${props.pressed ? ' is-on' : ''}`}
      aria-pressed={!!props.pressed}
      onClick={props.onClick}
      data-testid={props.testId}
      title={props.title}
    >
      {props.children}
    </button>
  );
}

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

export function StudioStatus(props: { status: StudioHealth; label?: string }) {
  // Do not close over props.status — first paint is often `unknown` (probe
  // in flight); the class string in JSX was reactive but the word was not,
  // so cards showed a green/red dot next to a frozen "Unknown".
  return (
    <span class={`ax-status ax-status--${props.status}`}>
      {studioHealthLabel(props.status, props.label)}
    </span>
  );
}

export function StudioEmpty(props: { children: JSX.Element }) {
  return <p class="ax-empty">{props.children}</p>;
}

export function StudioCode(props: { testId?: string; children: JSX.Element }) {
  return (
    <pre class="ax-code" data-testid={props.testId}>
      <code>{props.children}</code>
    </pre>
  );
}

export function StudioList(props: { children: JSX.Element }) {
  return <ul class="ax-list">{props.children}</ul>;
}

export function StudioRow(props: { children: JSX.Element; testId?: string }) {
  return (
    <li class="ax-row" data-testid={props.testId}>
      {props.children}
    </li>
  );
}
