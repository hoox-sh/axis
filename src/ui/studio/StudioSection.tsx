// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Titled studio block with optional lead copy.
 *
 * @module ui/studio/StudioSection
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export function StudioSection(props: {
  title?: string;
  lead?: JSX.Element;
  testId?: string;
  children: JSX.Element;
}) {
  return (
    <section class="ax-section" data-testid={props.testId}>
      <Show when={props.title}>
        <h3 class="ax-section-title">{props.title}</h3>
      </Show>
      <Show when={props.lead}>
        <p class="ax-section-lead">{props.lead}</p>
      </Show>
      {props.children}
    </section>
  );
}
