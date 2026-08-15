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
 * About AXIS — product, author, and HOOX ethos (from hoox.sh/axis · /pyne · /manifesto).
 * Open via logo click, Help → About (desktop), or the command palette.
 *
 * @module ui/AboutModal
 */

import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusTrap } from './focus-trap';
import { Icons } from './icons';
import { HooxLogo } from './HooxLogo';

/** App version shown in the about chrome (keep near package.json). */
const AXIS_VERSION = '2.0.8';

const LINKS = {
  axis: 'https://hoox.sh/axis',
  axisApp: 'https://axis.hoox.sh',
  axisDocs: 'https://hoox.sh/axis/docs',
  axisGithub: 'https://github.com/hoox-sh/axis',
  pyne: 'https://hoox.sh/pyne',
  pyneDocs: 'https://hoox.sh/pyne/docs',
  hoox: 'https://hoox.sh',
  manifesto: 'https://hoox.sh/manifesto',
} as const;

/** Six personal ethos constraints from hoox.sh/manifesto. */
const ETHOS = [
  {
    id: '01',
    title: 'Minimal trusted computing base',
    body: 'Every public surface is intentional. Internal workers have no open HTTP. Secrets inject into V8 isolates. Failure is local; resilience is global. The fewer places trust is required, the harder the system is to coerce.',
  },
  {
    id: '02',
    title: 'Resistance to centralized control',
    body: 'Self-host first. Open core free forever. No artificial limits that force a cloud subscription for retail operators. Enterprise is additive isolation and compliance — not a wall around the commons.',
  },
  {
    id: '03',
    title: 'Cryptographic enforcement of invariants',
    body: 'Idempotency, auth, and audit are not polite conventions. Durable Object mutexes, Service Binding identity, and immutable logs turn “should not happen” into “cannot happen without evidence.”',
  },
  {
    id: '04',
    title: 'Research with AI assistance',
    body: 'HOOX is a single-author research artifact. AI accelerates drafting, testing, and exploration — the architecture, constraints, and responsibility remain human. Publish the design. Keep proprietary enterprise code separate.',
  },
  {
    id: '05',
    title: 'Edge over empire',
    body: 'Prefer Cloudflare’s edge mesh over always-on regional VMs. Prefer free-tier viability over infrastructure theatre. Prefer reproducible latency numbers and open papers over marketing fog.',
  },
  {
    id: '06',
    title: 'Open core',
    body: 'AGPL for the charting and evaluation stack you can self-host, audit, and fork. Free to run on your metal. Commercial multi-tenant SaaS and compliance pipelines live outside the public commons.',
  },
] as const;

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

/** Modal: product, author, ethos, and stack links. */
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
            {/* Product */}
            <section>
              <h3 class="sc-section-title">AXIS</h3>
              <p class="text-text-dim leading-relaxed m-0">
                Open charting PWA for Pine Script™. Own the axes. Swap the engine.
                Multi-exchange sources and streams, on-chain TVL and DEX pools,
                pluggable engines (PYNE Pro API, Pyodide, Cloudflare Workers), and
                a void-shell editor — independent of TradingView®, Inc.
              </p>
              <p class="text-text-faint leading-relaxed mt-2 mb-0 text-[0.92em]">
                Part of the HOOX stack: edge workers ·{' '}
                <strong class="text-text-dim font-medium">PYNE</strong> evaluator ·{' '}
                <strong class="text-text-dim font-medium">AXIS</strong> charting face.
                Self-hostable. Free to audit and fork.
              </p>
            </section>

            {/* Author */}
            <section>
              <h3 class="sc-section-title">Author</h3>
              <p class="text-text-dim leading-relaxed m-0">
                <span class="text-text font-medium">jango_blockchained</span>
                <span class="text-text-faint"> · 2024–2026</span>
              </p>
              <p class="text-text-faint leading-relaxed mt-1.5 mb-0 text-[0.92em]">
                Engineered as a single-author research artifact with AI assistance —
                an edge-native trading system with a minimal trusted computing base,
                resistance to centralized control, and cryptographic enforcement of
                invariants.
              </p>
            </section>

            {/* Ethos */}
            <section>
              <h3 class="sc-section-title">Ethos</h3>
              <p class="text-text-faint leading-relaxed m-0 mb-3 text-[0.92em]">
                Constraints behind HOOX (from{' '}
                <a
                  href={LINKS.manifesto}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-accent hover:underline"
                >
                  hoox.sh/manifesto
                </a>
                ). Trade at the edge. Own your stack.
              </p>
              <ul class="list-none m-0 p-0 flex flex-col gap-2.5">
                <For each={[...ETHOS]}>
                  {(item) => (
                    <li class="border border-border-soft/80 rounded-[var(--radius-sc)] px-2.5 py-2 bg-bg-base/40">
                      <div class="flex items-baseline gap-2">
                        <span class="font-mono text-[10px] text-accent tracking-wider flex-shrink-0">
                          [{item.id}]
                        </span>
                        <span class="text-text font-medium text-[0.92em]">
                          {item.title}
                        </span>
                      </div>
                      <p class="text-text-faint leading-relaxed mt-1 mb-0 text-[0.88em] pl-[calc(2ch+0.5rem)]">
                        {item.body}
                      </p>
                    </li>
                  )}
                </For>
              </ul>
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
                <AboutLink href={LINKS.hoox} label="HOOX" hint="hoox.sh" />
                <AboutLink href={LINKS.manifesto} label="Manifesto" hint="ethos" />
              </div>
            </section>

            <p class="text-text-faint text-[10px] leading-relaxed m-0 border-t border-border-soft pt-3">
              Pine Script™ and TradingView® are trademarks of TradingView, Inc.
              AXIS is independent and not affiliated with TradingView.
              License: AGPL-3.0-only.
            </p>
          </div>

          <div class="sc-dialog-footer">
            <a
              href={LINKS.manifesto}
              target="_blank"
              rel="noopener noreferrer"
              class="sc-btn sc-btn-ghost text-[0.85em]"
            >
              Read manifesto
              <Icons.externalLink size={12} />
            </a>
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
