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

/**
 * Sticky page footer with status copy on the left and actions on the right.
 * When no status is supplied a spacer keeps the action cluster right-aligned.
 *
 * @param props - Optional status node, test id, and action children.
 * @returns A `footer.ax-page-footer`.
 */
export function StudioFooter(props: {
  status?: JSX.Element;
  testId?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <footer class="ax-page-footer" data-testid={props.testId}>
      <Show
        when={props.status}
        fallback={<span class="ax-page-footer-spacer" aria-hidden="true" />}
      >
        <p class="ax-page-footer-status">{props.status}</p>
      </Show>
      <div class="ax-page-footer-actions">{props.children}</div>
    </footer>
  );
}
