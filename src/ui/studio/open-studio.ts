// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one studio open seam.
 *
 * Surfaces that are not the studio itself (Settings, topbar, status bar, HUD)
 * do not reach into `App`'s signal. They dispatch {@link OPEN_STUDIO_EVENT};
 * `app.tsx` routes the detail through {@link createStudioRouter}. That keeps
 * the Data shortcuts on one page id and lets the routing be executed in tests
 * (`tests/studio-open-routing.test.ts`) without a DOM.
 *
 * @module ui/studio/open-studio
 */

import { createSignal } from 'solid-js';
import { isStudioPageId, type StudioPageId } from './types';

/** Window event every non-studio surface dispatches to open a studio page. */
export const OPEN_STUDIO_EVENT = 'axis-open-studio';

/** Dispatch the open-studio event for `page` (Data shortcuts use `'data'`). */
export function openStudioPage(page: StudioPageId): void {
  window.dispatchEvent(new CustomEvent(OPEN_STUDIO_EVENT, { detail: { page } }));
}

/**
 * Route an `axis-open-studio` detail to a page id.
 *
 * A known id opens that page; anything unknown falls back to Wire, which is
 * the composer every other page composes from.
 *
 * @param detail - Untrusted `CustomEvent.detail` from the window event.
 * @returns The page id to open.
 */
export function studioPageFromDetail(detail: unknown): StudioPageId {
  const page = (detail as { page?: unknown } | null | undefined)?.page;
  return isStudioPageId(page) ? page : 'wire';
}

/** Studio page state plus the event routing `app.tsx` installs. */
export type StudioRouter = {
  page: () => StudioPageId | null;
  open: (page: StudioPageId) => void;
  close: () => void;
  /** Apply an `axis-open-studio` detail. */
  handleDetail: (detail: unknown) => void;
};

/**
 * Create the studio page signal and its routing rule.
 *
 * @param initial - Page to start on, or `null` for closed.
 * @returns The page accessor, open/close, and the event-detail handler.
 */
export function createStudioRouter(initial: StudioPageId | null = null): StudioRouter {
  const [page, setPage] = createSignal<StudioPageId | null>(initial);
  const open = (id: StudioPageId) => setPage(id);
  const close = () => setPage(null);
  const handleDetail = (detail: unknown) => open(studioPageFromDetail(detail));
  return { page, open, close, handleDetail };
}
