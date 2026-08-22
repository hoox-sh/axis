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
  return (
    <div class="ax-tabs" role="tablist" aria-label={props.ariaLabel} data-testid={props.testId}>
      <For each={props.tabs}>
        {(t) => (
          <button
            type="button"
            role="tab"
            id={`${props.idPrefix}-tab-${t.id}`}
            aria-selected={props.value === t.id}
            aria-controls={`${props.idPrefix}-panel-${t.id}`}
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
