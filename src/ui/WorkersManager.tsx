// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Thin re-export of the Workers studio page for leftover imports.
 * Prefer {@link WorkersPage}.
 *
 * @module ui/WorkersManager
 */

import { Show } from 'solid-js';
import type { WorkerId } from '../workers';
import type { StudioPageId } from './studio/types';
import { WorkersPage } from './workers/WorkersPage';

export function WorkersManager(props: {
  open?: boolean;
  onClose: () => void;
  onChanged?: () => void;
  onOpenPlugins?: () => void;
  initialWorkerId?: WorkerId;
  /** Ignored — Workers is a studio page, not a dialog. */
  embedded?: boolean;
  /** Ignored — master-detail replaced Overview/Detail/Install/Configure. */
  initialTab?: 'overview' | 'detail' | 'install' | 'configure';
}) {
  const onNavigate = (id: StudioPageId) => {
    if (id === 'plugins') props.onOpenPlugins?.();
  };

  return (
    <Show when={props.open !== false}>
      <WorkersPage
        onClose={props.onClose}
        onChanged={props.onChanged}
        onNavigate={onNavigate}
        initialWorkerId={props.initialWorkerId}
      />
    </Show>
  );
}
