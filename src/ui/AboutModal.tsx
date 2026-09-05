// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * About AXIS — versions, philosophy, and stack links.
 * Open via logo click, Help → About (desktop), or the command palette.
 *
 * @module ui/AboutModal
 */

import { Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusTrap } from './focus-trap';
import { Icons } from './icons';
import { HooxLogo } from './HooxLogo';

/** App + engine versions shown in the about chrome (keep in sync with package.json). */
const AXIS_VERSION = '2.3.1';
const PYNE_VERSION = '0.4.2';

const LINKS = {
  axis: 'https://hoox.sh/axis',
  axisApp: 'https://axis.hoox.sh',
  axisDocs: 'https://hoox.sh/axis/docs',
  axisGithub: 'https://github.com/hoox-sh/axis',
  pyne: 'https://hoox.sh/pyne',
  pyneDocs: 'https://hoox.sh/pyne/docs',
  hoox: 'https://hoox.sh',
} as const;

const [aboutOpen, setAboutOpen] = createSignal(false);

/** Open the About AXIS modal (logo, Help → About, command palette). */
export function openAboutModal(): void {
  setAboutOpen(true);
}

/** Close the About AXIS modal. */
export function closeAboutModal(): void {
  setAboutOpen(false);
}

/** Whether the About modal is open (for tests / host chrome). */
export function isAboutModalOpen(): boolean {
  return aboutOpen();
}

/** Modal: versions, philosophy, and stack links. */
export const AboutModal: Component = () => {
  const close = () => setAboutOpen(false);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!aboutOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  return (
    <Show when={aboutOpen()}>
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        role="presentation"
        data-testid="axis-about-backdrop"
      >
        <div
          class="sc-dialog w-[min(560px,calc(100vw-2*var(--ui-dialog-margin)))] max-h-[min(88vh,720px)] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-about-title"
          data-testid="axis-about-modal"
          tabIndex={-1}
          ref={(el) => {
            if (!el) return;
            const dispose = installFocusTrap(el, { autoFocus: true });
            onCleanup(dispose);
          }}
        >
          <div class="sc-dialog-accent" />

          <div class="sc-dialog-header">
            <div class="flex items-center gap-2.5 min-w-0">
              <HooxLogo size="l" class="text-accent flex-shrink-0" />
              <div class="min-w-0">
                <div
                  id="axis-about-title"
                  class="text-[0.95em] font-semibold text-text tracking-tight"
                >
                  About AXIS
                </div>
                <div class="sc-hint">
                  v{AXIS_VERSION} · open charting · AGPL-3.0
                </div>
              </div>
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2"
              onClick={close}
              aria-label="Close"
              data-testid="axis-about-close"
            >
              <Icons.x />
            </button>
          </div>

          <div class="sc-dialog-body overflow-y-auto flex flex-col gap-5 text-[0.9em]">
            {/* Versions */}
            <section>
              <h3 class="sc-section-title">Versions</h3>
              <div class="grid grid-cols-2 gap-2">
                <div class="border border-border-soft/80 rounded-[var(--radius-sc)] px-2.5 py-2 bg-bg-base/40">
                  <span class="font-mono text-[10px] text-accent tracking-wider">AXIS</span>
                  <span class="text-text font-medium text-[0.92em] ml-1.5">v{AXIS_VERSION}</span>
                </div>
                <div class="border border-border-soft/80 rounded-[var(--radius-sc)] px-2.5 py-2 bg-bg-base/40">
                  <span class="font-mono text-[10px] text-accent tracking-wider">PYNE</span>
                  <span class="text-text font-medium text-[0.92em] ml-1.5">v{PYNE_VERSION}</span>
                </div>
              </div>
            </section>

            {/* Philosophy */}
            <section>
              <h3 class="sc-section-title">Philosophy</h3>
              <p class="text-text-dim leading-relaxed m-0">
                No walled garden. The software is free — self-hostable,
                auditable, and forkable under AGPL-3.0. We charge for hosted
                service, not for the code.
              </p>
              <p class="text-text-faint leading-relaxed mt-2 mb-0 text-[0.92em]">
                Pluggable engines. Multi-exchange sources. On-chain TVL and DEX
                pools. A void-shell editor — independent of TradingView®, Inc.
              </p>
            </section>

            {/* Stack links */}
            <section>
              <h3 class="sc-section-title">Stack &amp; links</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <AboutLink href={LINKS.axis} label="AXIS product" hint="hoox.sh/axis" />
                <AboutLink href={LINKS.axisApp} label="Live demo" hint="axis.hoox.sh" />
                <AboutLink href={LINKS.axisDocs} label="AXIS docs" hint="docs" />
                <AboutLink href={LINKS.axisGithub} label="AXIS GitHub" hint="hoox-sh/axis" />
                <AboutLink href={LINKS.pyne} label="PYNE" hint="hoox.sh/pyne" />
                <AboutLink href={LINKS.pyneDocs} label="PYNE docs" hint="evaluator" />
              </div>
            </section>

            <p class="text-text-faint text-[10px] leading-relaxed m-0 border-t border-border-soft pt-3">
              Pine Script™ and TradingView® are trademarks of TradingView, Inc.
              AXIS is independent and not affiliated with TradingView.
              License: AGPL-3.0-only.
            </p>
          </div>

          <div class="sc-dialog-footer">
            <button
              type="button"
              class="sc-btn sc-btn-primary px-3"
              onClick={close}
              data-testid="axis-about-done"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

const AboutLink: Component<{ href: string; label: string; hint: string }> = (props) => (
  <a
    href={props.href}
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center justify-between gap-2 px-2.5 py-2 border border-border-soft rounded-[var(--radius-sc)] text-text-dim hover:border-accent/50 hover:text-accent transition-colors no-underline"
  >
    <span class="font-medium text-[0.9em]">{props.label}</span>
    <span class="font-mono text-[10px] text-text-faint truncate">{props.hint}</span>
  </a>
);
