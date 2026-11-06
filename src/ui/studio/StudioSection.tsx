// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Titled studio block with optional lead copy and header actions.
 *
 * @module ui/studio/StudioSection
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

/**
 * Titled block that groups studio controls under a heading, optional lead copy,
 * and trailing header actions. The header row is omitted entirely when neither
 * `title` nor `headerEnd` is supplied.
 *
 * @param props - Heading, lead copy, header-end slot, test id, and body content.
 * @returns A `<section class="ax-section">` wrapper.
 */
export function StudioSection(props: {
  title?: string;
  lead?: JSX.Element;
  /** Optional trailing control(s) on the title row (probe, refresh, etc.). */
  headerEnd?: JSX.Element;
  testId?: string;
  children: JSX.Element;
}): JSX.Element {
  const hasHead = () => !!(props.title || props.headerEnd);

  return (
    <section class="ax-section" data-testid={props.testId}>
      <Show when={hasHead()}>
        <div class="ax-section-head">
          <Show when={props.title}>
            <h3 class="ax-section-title">{props.title}</h3>
          </Show>
          <Show when={props.headerEnd}>
            <div class="ax-section-head-end">{props.headerEnd}</div>
          </Show>
        </div>
      </Show>
      <Show when={props.lead}>
        <p class="ax-section-lead">{props.lead}</p>
      </Show>
      {props.children}
    </section>
  );
}
