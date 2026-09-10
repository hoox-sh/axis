// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Full-viewport studio overlay. One shell for Runtime, Wire, Settings,
 * Workers, and Plugins. Pages render as the canvas; they do not mount
 * their own dialog chrome.
 *
 * @module ui/studio/AppPage
 */

import { For, Show, createEffect, type JSX, onCleanup } from 'solid-js';
import { Icons } from '../icons';
import { installFocusTrap } from '../focus-trap';
import type { StudioPageId } from './types';
import { STUDIO_PAGES, studioPageMeta } from './pages';
import { AppPageHeader } from './AppPageHeader';

export function AppPage(props: {
  open: boolean;
  page: StudioPageId;
  onNavigate: (id: StudioPageId) => void;
  onClose: () => void;
  title?: string;
  purpose?: string;
  headerRight?: JSX.Element;
  tabs?: JSX.Element;
  flush?: boolean;
  children: JSX.Element;
  /**
   * Render non-modally: no focus trap, and no Escape-steal. Used by the
   * Workers page; every other page defaults to the modal overlay.
   */
  modal?: boolean;
}) {
  const meta = () => studioPageMeta(props.page);
  const flush = () => props.flush || props.page === 'wire';
  const modal = () => props.modal ?? true;
  const primary = STUDIO_PAGES.filter((p) => p.group === 'primary');
  const catalog = STUDIO_PAGES.filter((p) => p.group === 'catalog');

  const onKey = (e: KeyboardEvent) => {
    // Non-modal pages never steal Escape — the app behind owns its keys.
    if (!modal()) return;
    if (e.key === 'Escape') {
      // A shortcut-recording session owns Escape (capture phase + stop).
      if (document.body?.hasAttribute('data-axis-recording-chord')) return;
      e.preventDefault();
      props.onClose();
    }
  };

  // Focus trap follows modality: tracked so navigating the rail between a
  // modal and a non-modal page installs/disposes the trap correctly.
  let pageEl: HTMLDivElement | undefined;
  createEffect(() => {
    const el = pageEl;
    if (!el) return;
    if (!modal()) return;
    const dispose = installFocusTrap(el, { autoFocus: true });
    onCleanup(dispose);
  });

  return (
    <Show when={props.open}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop captures Escape to close the page; no semantic role fits a dismiss surface */}
      <div
        class={`ax-page-backdrop${modal() ? '' : ' ax-page-backdrop--nonmodal'}`}
        onKeyDown={onKey}
        role="presentation"
      >
        <div
          class="ax-page"
          role="dialog"
          aria-modal={modal() ? true : undefined}
          aria-labelledby={meta().titleId}
          data-testid={meta().testId}
          data-studio-page={props.page}
          tabIndex={-1}
          ref={(el) => {
            pageEl = el;
          }}
        >
          <Show when={meta().aliasTestIds}>
            <For each={meta().aliasTestIds}>
              {(id) => <span data-testid={id} hidden />}
            </For>
          </Show>
          <aside class="ax-page-rail" aria-label="Studio">
            <div class="ax-page-rail-brand">
              AXIS
              <span>studio</span>
            </div>
            <nav class="ax-page-rail-nav">
              <p class="ax-page-rail-label">Workspace</p>
              <For each={primary}>
                {(item) => (
                  <button
                    type="button"
                    class={`ax-page-rail-item${props.page === item.id ? ' is-on' : ''}`}
                    aria-current={props.page === item.id ? 'page' : undefined}
                    data-testid={`axis-studio-rail-${item.id}`}
                    onClick={() => props.onNavigate(item.id)}
                  >
                    {item.id === 'runtime' ? (
                      <Icons.runtimes size={16} />
                    ) : item.id === 'wire' ? (
                      <Icons.architecture size={16} />
                    ) : (
                      <Icons.settings size={16} />
                    )}
                    {item.label}
                  </button>
                )}
              </For>
              <p class="ax-page-rail-label">Catalog</p>
              <For each={catalog}>
                {(item) => (
                  <button
                    type="button"
                    class={`ax-page-rail-item${props.page === item.id ? ' is-on' : ''}`}
                    aria-current={props.page === item.id ? 'page' : undefined}
                    data-testid={`axis-studio-rail-${item.id}`}
                    onClick={() => props.onNavigate(item.id)}
                  >
                    {item.id === 'workers' ? (
                      <Icons.cpu size={16} />
                    ) : (
                      <Icons.library size={16} />
                    )}
                    {item.label}
                  </button>
                )}
              </For>
            </nav>
          </aside>
          <div class="ax-page-main">
            <AppPageHeader
              meta={meta()}
              title={props.title}
              purpose={props.purpose}
              headerRight={props.headerRight}
              onClose={props.onClose}
            />
            <Show when={props.tabs}>{props.tabs}</Show>
            <div class={`ax-page-body${flush() ? ' ax-page-body--flush' : ''}`}>
              {props.children}
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
