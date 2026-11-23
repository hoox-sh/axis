// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Token sections. The list is the catalog; each {@link TokenField} subscribes
 * on its own, so this column does not read the store.
 *
 * @module ui/theme-panel/TokenGroups
 */

import { For, Show } from 'solid-js';
import { THEME_GROUPS, tokensForGroup, type ThemeTokenDef, type ThemeTokenType } from '../../theme';
import { StudioSection } from '../studio';
import { BarColorLibrary } from '../ThemeLibrary';
import { TokenField } from './TokenField';

const KIND_ORDER: readonly ThemeTokenType[] = ['color', 'number', 'boolean'];
const KIND_LABEL: Record<ThemeTokenType, string> = {
  color: 'Color',
  number: 'Number',
  boolean: 'Switch',
};

interface KindBucket {
  kind: ThemeTokenType;
  label: string;
  defs: ThemeTokenDef[];
  showLabel: boolean;
}

/** Keep catalog order inside each kind. Label the split only when a section mixes kinds. */
function kindBuckets(defs: readonly ThemeTokenDef[]): KindBucket[] {
  const present = KIND_ORDER.filter((kind) => defs.some((def) => def.type === kind));
  return present.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    defs: defs.filter((def) => def.type === kind),
    showLabel: present.length > 1,
  }));
}

const GROUPS = THEME_GROUPS.map((group) => ({
  ...group,
  defs: tokensForGroup(group.id),
})).filter((group) => group.defs.length > 0);

function groupLead(id: string, description?: string): string {
  if (id === 'bar') {
    return 'Body, border, and wick. Save a bar palette on its own; it also embeds in the selected theme.';
  }
  if (id === 'chart') {
    return 'Canvas colors. Pine aliases: chart.color_background / chart.color_foreground.';
  }
  return description ?? '';
}

/** Right column: catalog groups, bar library, and typed token clusters. */
export function TokenGroups(): JSX.Element {
  return (
    <div class="ax-split-col">
      <For each={GROUPS}>
        {(group) => (
          <StudioSection title={group.label} lead={groupLead(group.id, group.description)}>
            <Show when={group.id === 'bar'}>
              <BarColorLibrary />
            </Show>
            <div class="ax-token-kinds">
              <For each={kindBuckets(group.defs)}>
                {(bucket) => (
                  <div class="ax-token-kind" data-kind={bucket.kind}>
                    <Show when={bucket.showLabel}>
                      <p class="ax-token-kind-label">{bucket.label}</p>
                    </Show>
                    <div class="ax-token-grid">
                      <For each={bucket.defs}>{(def) => <TokenField def={def} />}</For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </StudioSection>
        )}
      </For>
    </div>
  );
}
