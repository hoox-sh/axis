// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Underline tabs for in-page sections (Settings, Plugins).
 *
 * @module ui/studio/StudioTabs
 */

import { For, createMemo } from 'solid-js';

/**
 * Underline tab strip for in-page sections (Settings, Plugins) with roving
 * focus: Arrow/Home/End move selection and focus the newly selected tab.
 *
 * @param props - Tab list, selected id, change handler, a11y label, and DOM id prefix.
 * @returns A `role="tablist"` element with one `role="tab"` button per entry.
 */
export function StudioTabs<T extends string>(props: {
  tabs: Array<{ id: T; label: string; hint?: string }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  idPrefix: string;
  testId?: string;
}): JSX.Element {
  const ids = createMemo(() => props.tabs.map((t) => t.id));

  const focusTab = (id: T) => {
    props.onChange(id);
    queueMicrotask(() => {
      document.getElementById(`${props.idPrefix}-tab-${id}`)?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const list = ids();
    const current = list.indexOf(props.value);
    if (current < 0) return;
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    const id = list[next];
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
        {(t) => {
          const selected = () => props.value === t.id;
          return (
            <button
              type="button"
              role="tab"
              id={`${props.idPrefix}-tab-${t.id}`}
              aria-selected={selected()}
              aria-controls={`${props.idPrefix}-panel-${t.id}`}
              tabIndex={selected() ? 0 : -1}
              data-testid={`${props.idPrefix}-tab-${t.id}`}
              data-state={selected() ? 'active' : 'inactive'}
              class="ax-tab"
              classList={{ 'is-active': selected() }}
              title={t.hint}
              onClick={() => {
                if (!selected()) props.onChange(t.id);
              }}
            >
              <span class="ax-tab-label">{t.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
