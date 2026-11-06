// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio page header — kicker, display title, purpose, actions.
 *
 * @module ui/studio/AppPageHeader
 */

import type { JSX } from 'solid-js';
import 'solid-js';
import type { StudioPageMeta } from './pages';
import { Icons } from '../icons';
import { StudioButton } from './StudioButton';

/**
 * Studio page header: kicker, display title, purpose line, and the close action.
 * `title`/`purpose` override the page metadata copy without mutating it.
 *
 * @param props - Page metadata plus optional title/purpose overrides and header actions.
 * @returns A `header.ax-page-header` with the shared close button.
 */
export function AppPageHeader(props: {
  meta: StudioPageMeta;
  title?: string;
  purpose?: string;
  headerRight?: JSX.Element;
  onClose: () => void;
}): JSX.Element {
  return (
    <header class="ax-page-header">
      <div>
        <p class="ax-page-kicker">{props.meta.kicker}</p>
        <h2 id={props.meta.titleId} data-testid={props.meta.titleId} class="ax-page-title">
          {props.title || props.meta.title}
        </h2>
        <p class="ax-page-purpose">{props.purpose || props.meta.purpose}</p>
      </div>
      <div class="ax-page-header-actions">
        {props.headerRight}
        <StudioButton
          variant="ghost"
          class="ax-btn--icon"
          onClick={props.onClose}
          ariaLabel="Close"
          testId={props.meta.closeTestId}
        >
          <Icons.x />
        </StudioButton>
      </div>
    </header>
  );
}
