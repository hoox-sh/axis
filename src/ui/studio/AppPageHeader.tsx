// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio page header — kicker, display title, purpose, actions.
 *
 * @module ui/studio/AppPageHeader
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import type { StudioPageMeta } from './pages';
import { Icons } from '../icons';
import { StudioButton } from './StudioButton';

export function AppPageHeader(props: {
  meta: StudioPageMeta;
  title?: string;
  purpose?: string;
  headerRight?: JSX.Element;
  onClose: () => void;
}) {
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
