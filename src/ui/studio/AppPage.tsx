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

import { For, Show, type JSX, onCleanup } from 'solid-js';
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
}) {
  const meta = () => studioPageMeta(props.page);
  const flush = () => props.flush || props.page === 'wire';
  const primary = STUDIO_PAGES.filter((p) => p.group === 'primary');
  const catalog = STUDIO_PAGES.filter((p) => p.group === 'catalog');

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    }
  };

  return (
    <Show when={props.open}>
      <div class="ax-page-backdrop" onKeyDown={onKey} role="presentation">
        <div
          class="ax-page"
          role="dialog"
          aria-modal="true"
          aria-labelledby={meta().titleId}
          data-testid={meta().testId}
          data-studio-page={props.page}
          tabIndex={-1}
          ref={(el) => {
            if (!el) return;
            const dispose = installFocusTrap(el, { autoFocus: true });
            onCleanup(dispose);
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
