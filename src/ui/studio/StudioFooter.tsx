// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sticky studio footer — status copy + actions.
 *
 * @module ui/studio/StudioFooter
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export function StudioFooter(props: {
  status?: JSX.Element;
  testId?: string;
  children: JSX.Element;
}) {
  return (
    <footer class="ax-page-footer" data-testid={props.testId}>
      <Show when={props.status} fallback={<span class="ax-page-footer-spacer" aria-hidden="true" />}>
        <p class="ax-page-footer-status">{props.status}</p>
      </Show>
      <div class="ax-page-footer-actions">{props.children}</div>
    </footer>
  );
}
