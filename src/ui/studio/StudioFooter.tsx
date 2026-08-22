// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sticky studio footer — status copy + actions.
 *
 * @module ui/studio/StudioFooter
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export function StudioFooter(props: { status?: JSX.Element; children: JSX.Element }) {
  return (
    <footer class="ax-page-footer">
      <Show when={props.status}>
        <p class="ax-page-footer-status">{props.status}</p>
      </Show>
      {props.children}
    </footer>
  );
}
