// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared Layers panel chrome: section, empty state, visibility row.
 *
 * @module ui/layers/rows
 */

import { type Component, Show, type JSX } from 'solid-js';
import { Icons } from '../icons';

let nextSection = 0;

/** Titled block with an optional count. The heading is the accessible name. */
export const LayerSection: Component<{
  title: string;
  count?: number;
  children: JSX.Element;
}> = (props) => {
  const headingId = `axis-layer-section-${++nextSection}`;
  return (
    <section aria-labelledby={headingId} class="flex flex-col gap-1">
      <h2
        id={headingId}
        class="sc-section-title m-0 px-0.5 flex items-baseline justify-between gap-2"
      >
        <span>{props.title}</span>
        <Show when={props.count != null}>
          <span class="font-mono font-normal text-text-faint normal-case tracking-normal tabular-nums">
            {props.count}
          </span>
        </Show>
      </h2>
      <div class="flex flex-col gap-0.5">{props.children}</div>
    </section>
  );
};

export const LayerEmpty: Component<{ children: JSX.Element }> = (props) => (
  <div class="axis-empty-state text-[12px] text-text-dim px-1 py-2">{props.children}</div>
);

/** Show / hide control. Locked rows stay visible and explain why. */
export const VisibilityToggle: Component<{
  label: string;
  visible: boolean;
  locked?: boolean;
  onToggle: () => void;
}> = (props) => {
  const name = () =>
    props.locked
      ? `${props.label} stays visible`
      : props.visible
        ? `Hide ${props.label}`
        : `Show ${props.label}`;
  return (
    <button
      type="button"
      class={`w-5 h-5 min-w-5 flex items-center justify-center border flex-shrink-0 rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent ${
        props.visible
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-border bg-bg-hover text-text-dim'
      } ${props.locked ? 'opacity-50 cursor-not-allowed' : ''}`}
      disabled={props.locked}
      aria-pressed={props.visible}
      aria-label={name()}
      title={name()}
      onClick={(e) => {
        e.stopPropagation();
        if (!props.locked) props.onToggle();
      }}
    >
      {props.visible ? <Icons.eye size={12} /> : <Icons.eyeOff size={12} />}
    </button>
  );
};

/** Pane, overlay, script, or on-chain series row. */
export const LayerRow: Component<{
  label: string;
  sub?: string;
  visible: boolean;
  locked?: boolean;
  onToggle: () => void;
  onSettings?: () => void;
  onRemove?: () => void;
  /** Optional root data-testid (e.g. axis-layers-onchain-*). */
  testId?: string;
  /** Tooltip for the remove/detach control. */
  removeTitle?: string;
}> = (props) => (
  <div
    class="axis-list-row flex items-center gap-1.5 h-8 px-1 bg-bg-elev border-b border-border-soft"
    data-testid={props.testId}
  >
    <VisibilityToggle
      label={props.label}
      visible={props.visible}
      locked={props.locked}
      onToggle={props.onToggle}
    />
    <div class="min-w-0 flex-1">
      <div class="text-text truncate font-medium leading-tight">{props.label}</div>
      <Show when={props.sub}>
        <div class="text-[0.78em] text-text-faint font-mono truncate">{props.sub}</div>
      </Show>
    </div>
    <Show when={props.onSettings}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1"
        title="Script settings"
        aria-label={`Settings for ${props.label}`}
        onClick={props.onSettings}
      >
        <Icons.settings />
      </button>
    </Show>
    <Show when={props.onRemove}>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
        title={props.removeTitle || 'Remove'}
        aria-label={props.removeTitle ? `${props.removeTitle}: ${props.label}` : `Remove ${props.label}`}
        data-testid={props.testId ? `${props.testId}-detach` : undefined}
        onClick={props.onRemove}
      >
        <Icons.x />
      </button>
    </Show>
  </div>
);
