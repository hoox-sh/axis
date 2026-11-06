// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared Layers panel chrome: collapsible section, empty state, layer row.
 *
 * Sections collapse from their heading and can host section-level controls
 * (show/hide all, overflow menu). Rows are dense: visibility first, optional
 * kind glyph or color swatch, name + subtitle, then hover-revealed actions.
 *
 * @module ui/layers/rows
 */

import { type Component, Show, type JSX } from 'solid-js';
import { Icons } from '../icons';

let nextSection = 0;

/** Titled, collapsible block with an optional count and header actions. */
export const LayerSection: Component<{
  title: string;
  /** Total rows in the section. */
  count?: number;
  /** Rows left after the panel search; renders `matched / count` when lower. */
  matched?: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Section-level controls rendered next to the count. */
  actions?: JSX.Element;
  testId?: string;
  children: JSX.Element;
}> = (props): JSX.Element => {
  const headingId = `axis-layer-section-${++nextSection}`;
  const showCount = () => props.count != null;
  return (
    <section class="ax-layers-section" aria-labelledby={headingId} data-testid={props.testId}>
      <div class="ax-layers-section-head">
        <h2 id={headingId} class="ax-layers-section-title">
          <button
            type="button"
            class="ax-layers-section-toggle"
            aria-expanded={props.collapsed ? 'false' : 'true'}
            title={props.collapsed ? `Expand ${props.title}` : `Collapse ${props.title}`}
            onClick={props.onToggleCollapsed}
            disabled={!props.onToggleCollapsed}
          >
            <Icons.chevronDown
              size={10}
              class={`ax-layers-chevron${props.collapsed ? '' : ' is-open'}`}
            />
            <span>{props.title}</span>
          </button>
        </h2>
        <Show when={showCount()}>
          <span class="ax-layers-count" title={`${props.count} layer(s)`}>
            {props.matched != null && props.matched < (props.count ?? 0)
              ? `${props.matched}/${props.count}`
              : props.count}
          </span>
        </Show>
        <Show when={props.actions}>
          <div class="ax-layers-section-actions">{props.actions}</div>
        </Show>
      </div>
      <Show when={!props.collapsed}>
        <div class="ax-layers-section-body">{props.children}</div>
      </Show>
    </section>
  );
};

/**
 * Placeholder rendered when a layer section has no rows (or no search hits).
 *
 * @param props - Message content and optional test id.
 * @returns A `div.ax-layers-empty`.
 */
export const LayerEmpty: Component<{ children: JSX.Element; testId?: string }> = (
  props,
): JSX.Element => (
  <div class="ax-layers-empty" data-testid={props.testId}>
    {props.children}
  </div>
);

/** Show / hide control. Locked rows stay visible and explain why. */
export const VisibilityToggle: Component<{
  label: string;
  visible: boolean;
  locked?: boolean;
  onToggle: () => void;
}> = (props): JSX.Element => {
  const name = () =>
    props.locked
      ? `${props.label} stays visible`
      : props.visible
        ? `Hide ${props.label}`
        : `Show ${props.label}`;
  return (
    <button
      type="button"
      class="ax-layers-eye"
      classList={{ 'is-on': props.visible, 'is-locked': props.locked }}
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

/** Pane, overlay, script, on-chain series, or drawing row. */
export const LayerRow: Component<{
  label: string;
  sub?: string;
  visible: boolean;
  /** Visibility cannot be changed (the price pane). */
  visibilityLocked?: boolean;
  /** Optional leading glyph (script kind, pane type, series). */
  icon?: JSX.Element;
  /** Optional color swatch before the label. */
  swatch?: string;
  /** Small trailing tag, e.g. `est.`, `locked`, `hidden`. */
  badge?: string;
  /** Rendered muted when the layer is currently hidden. */
  hidden?: boolean;
  selected?: boolean;
  /** Makes the name a select-on-chart button. */
  onSelect?: () => void;
  onToggle: () => void;
  onSettings?: () => void;
  /** Drawing lock toggle (separate from visibility). */
  isLocked?: boolean;
  onToggleLock?: () => void;
  onRemove?: () => void;
  /** Optional root data-testid (e.g. axis-layers-onchain-*). */
  testId?: string;
  /** Tooltip for the remove/detach control. */
  removeTitle?: string;
}> = (props): JSX.Element => {
  const main = () => (
    <>
      <div class="ax-layers-row-label" title={props.label}>
        {props.label}
      </div>
      <Show when={props.sub}>
        <div class="ax-layers-row-sub" title={props.sub}>
          {props.sub}
        </div>
      </Show>
    </>
  );
  return (
    <div
      class="ax-layers-row"
      classList={{ 'is-selected': props.selected, 'is-hidden': props.hidden }}
      data-testid={props.testId}
      data-hidden={props.hidden || undefined}
      data-selected={props.selected ? '1' : undefined}
    >
      <VisibilityToggle
        label={props.label}
        visible={props.visible}
        locked={props.visibilityLocked}
        onToggle={props.onToggle}
      />
      <Show when={props.swatch}>
        <span
          class="ax-layers-swatch"
          style={{ background: props.swatch }}
          title={props.swatch}
          aria-hidden="true"
        />
      </Show>
      <Show when={props.icon}>
        <span class="ax-layers-glyph" aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <Show when={props.onSelect} fallback={<div class="ax-layers-row-main">{main()}</div>}>
        <button
          type="button"
          class="ax-layers-row-main is-button"
          aria-pressed={props.selected}
          title="Select on chart"
          onClick={() => props.onSelect?.()}
        >
          {main()}
        </button>
      </Show>
      <Show when={props.badge}>
        <span class="ax-layers-badge">{props.badge}</span>
      </Show>
      <div class="ax-layers-row-actions">
        <Show when={props.onToggleLock}>
          <button
            type="button"
            class="ax-layers-icon"
            classList={{ 'is-on': props.isLocked }}
            title={props.isLocked ? `Unlock ${props.label}` : `Lock ${props.label}`}
            aria-label={props.isLocked ? `Unlock ${props.label}` : `Lock ${props.label}`}
            aria-pressed={props.isLocked}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleLock?.();
            }}
          >
            {props.isLocked ? <Icons.lock size={11} /> : <Icons.unlock size={11} />}
          </button>
        </Show>
        <Show when={props.onSettings}>
          <button
            type="button"
            class="ax-layers-icon"
            title="Script settings"
            aria-label={`Settings for ${props.label}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onSettings?.();
            }}
          >
            <Icons.settings size={11} />
          </button>
        </Show>
        <Show when={props.onRemove}>
          <button
            type="button"
            class="ax-layers-icon is-danger"
            title={props.removeTitle || 'Remove'}
            aria-label={
              props.removeTitle ? `${props.removeTitle}: ${props.label}` : `Remove ${props.label}`
            }
            data-testid={props.testId ? `${props.testId}-detach` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove?.();
            }}
          >
            <Icons.x size={11} />
          </button>
        </Show>
      </div>
    </div>
  );
};
