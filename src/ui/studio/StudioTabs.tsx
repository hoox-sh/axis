// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Underline tabs for in-page sections (Settings, Plugins).
 *
 * @module ui/studio/StudioTabs
 */

import { For } from 'solid-js';

export function StudioTabs<T extends string>(props: {
  tabs: Array<{ id: T; label: string; hint?: string }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  idPrefix: string;
  testId?: string;
}) {
  const focusTab = (id: T) => {
    props.onChange(id);
    queueMicrotask(() => {
      document.getElementById(`${props.idPrefix}-tab-${id}`)?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const ids = props.tabs.map((t) => t.id);
    const current = ids.indexOf(props.value);
    if (current < 0) return;
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else return;
    e.preventDefault();
    const id = ids[next];
    if (id !== undefined && id !== props.value) focusTab(id);
  };

  return (
    <div
      class="ax-tabs"
      role="tablist"
      aria-label={props.ariaLabel}
      aria-orientation="horizontal"
      data-testid={props.testId}
      onKeyDown={onKeyDown}
    >
      <For each={props.tabs}>
        {(t) => (
          <button
            type="button"
            role="tab"
            id={`${props.idPrefix}-tab-${t.id}`}
            aria-selected={props.value === t.id}
            aria-controls={`${props.idPrefix}-panel-${t.id}`}
            tabIndex={props.value === t.id ? 0 : -1}
            data-testid={`${props.idPrefix}-tab-${t.id}`}
            class="ax-tab"
            title={t.hint}
            onClick={() => props.onChange(t.id)}
          >
            {t.label}
          </button>
        )}
      </For>
    </div>
  );
}
