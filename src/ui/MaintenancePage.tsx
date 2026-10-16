// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maintenance page — the whole app while `VITE_MAINTENANCE_MODE` is on.
 *
 * Composed like the hoox landing hero: a dark void background, a dimmed
 * overlay, the landing `texture-cross` hairlines (a 0.8px accent grid on a
 * 10px pitch, 25% opacity), and a {@link SideRays} light fan painted ABOVE
 * the content (`mix-blend-screen`, z-20) so the rays wash over the brand mark
 * and copy — the spotlight lights them up instead of sitting behind them.
 * No dust motes: the beam is the only light.
 *
 * Stage: the HOOX mark is anchored dead-center of the viewport. It flickers
 * once on load and again on hover — the landing `logo-flicker` stagger,
 * driven by `HooxLogo`'s one-shot `introFlicker` / `hoverFlicker` (no
 * continuous loader animation), with the phosphor glow ring behind it.
 * Everything else hangs off
 * that center anchor: the status line ("Planned maintenance — will be back
 * soon"), the upcoming-major-release teaser label, and the AXIS slogans typed
 * by {@link SloganTypewriter} (the hoox.sh/axis hero headline + the three
 * footer phrases, same type/hold/delete rhythm) sit `mt-[92px]` below it
 * (56px half-mark + 36px gap), horizontally centered; the site link is pinned
 * to the bottom edge.
 *
 * Rendered by `index.tsx` instead of the chart workspace / editor popout —
 * no panels, no engines, nothing that could half-work while a deployment
 * is down. Informational only: there is deliberately no in-app escape.
 * Boot side effects that still run (service worker, update poll) are safe:
 * navigations and unversioned statics are network-first, so this page stays
 * fresh after deploy (`public/sw.js`).
 *
 * Reduced motion: the flicker stagger is a no-op (`runHoverFlicker` early
 * returns) and the glow is silenced app-wide by the `prefers-reduced-motion`
 * block in `index.css`; SideRays renders a single static frame.
 *
 * @module ui/MaintenancePage
 */

import type { Component } from 'solid-js';
import { HooxLogo } from './HooxLogo';
import { SideRays } from './SideRays';
import { SloganTypewriter } from './SloganTypewriter';

/** Product page URL teased in the footer link. */
const AXIS_SITE = 'https://hoox.sh/axis';

/** Mark size (px) — the center anchor every other block is measured from. */
const MARK_SIZE = 112;

/** Space between the mark's bottom edge and the teaser label, in px. */
const MARK_TO_TEASER = 36;

/** Top offset for the block hanging below the centered mark. */
const BELOW_MARK = `${MARK_SIZE / 2 + MARK_TO_TEASER}px`;

/**
 * AXIS slogans as typed on hoox.sh/axis — the hero headline doubles as the
 * second phrase, and the footer cycles all three (`typewriterPhrases` in
 * `hoox-landing-page/lib/products.ts`).
 */
const SLOGANS = [
  'Price and time. Your coordinates.',
  'Own the axes. Swap the engine.',
  'Compose. Evaluate. Export.',
] as const;

/**
 * `hoox-landing-page` `texture-cross` (the route texture for AXIS): hairline
 * accent lines every 10px in both axes, mixed at 22% so the 25% layer opacity
 * lands the grid barely above the void background.
 */
const CROSS_TEXTURE = [
  'repeating-linear-gradient(0deg, color-mix(in oklch, var(--color-accent) 22%, transparent) 0 0.8px, transparent 0.8px 10px)',
  'repeating-linear-gradient(90deg, color-mix(in oklch, var(--color-accent) 22%, transparent) 0 0.8px, transparent 0.8px 10px)',
].join(', ');

/** Full-viewport maintenance screen (mounted by `index.tsx` at boot). */
export const MaintenancePage: Component = () => (
  <div
    class="relative h-screen w-screen overflow-hidden bg-bg-base text-text"
    data-testid="axis-maintenance-page"
    role="status"
    aria-live="polite"
    aria-label="AXIS is under maintenance"
  >
    {/* Dimmed overlay above the dark background (drop-overlay idiom from app.tsx) */}
    <div
      class="pointer-events-none absolute inset-0 bg-void/75 backdrop-blur-[2px]"
      data-testid="axis-maintenance-overlay"
      aria-hidden="true"
    />

    {/* Background grid — hoox landing `texture-cross` behind the content */}
    <div
      class="pointer-events-none absolute inset-0 opacity-25"
      style={{ 'background-image': CROSS_TEXTURE, 'background-size': '10px 10px' }}
      data-testid="axis-maintenance-texture"
      aria-hidden="true"
    />

    {/* Brand mark — dead-center anchor; every other block hangs off it */}
    <div
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      data-testid="axis-maintenance-mark"
    >
      <div
        class="relative flex items-center justify-center"
        style={{ width: `${MARK_SIZE}px`, height: `${MARK_SIZE}px` }}
      >
        <HooxLogo
          size={MARK_SIZE}
          introFlicker
          class="relative"
          data-testid="axis-maintenance-logo"
          title="HOOX"
        />
        <span class="hoox-loader-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      </div>
    </div>

    {/* Status + teaser — anchored below the mark, horizontally centered */}
    <div
      class="absolute left-1/2 top-1/2 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-4 px-6 text-center"
      style={{ 'margin-top': BELOW_MARK }}
      data-testid="axis-maintenance-status"
    >
      <h1 class="m-0 text-[15px] font-medium tracking-tight text-text">
        Planned maintenance — will be back soon
      </h1>
      <div
        class="flex items-center gap-2 text-[10px] font-medium tracking-[0.24em] text-accent uppercase"
        data-testid="axis-maintenance-teaser"
      >
        <span class="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        Upcoming · major release
      </div>

      {/* Slogans typed exactly as on hoox.sh/axis (hero + footer) */}
      <SloganTypewriter
        phrases={SLOGANS}
        class="mt-2 font-mono text-[13px] tracking-wide text-accent/95"
      />
    </div>

    {/* Site link — pinned to the bottom edge */}
    <div class="absolute inset-x-0 bottom-0 flex justify-center px-6 pb-6">
      <p class="m-0 text-[11px] text-text-faint">
        Thanks for your patience ·{' '}
        <a
          href={AXIS_SITE}
          target="_blank"
          rel="noopener noreferrer"
          class="text-text-dim no-underline transition-colors hover:text-accent"
          data-testid="axis-maintenance-link"
        >
          hoox.sh/axis
        </a>
      </p>
    </div>

    {/* Spotlight — rays over everything (screen blend) so the beam grazes the mark + copy */}
    <div
      class="pointer-events-none absolute inset-0 z-20 mix-blend-screen"
      data-testid="axis-maintenance-rays"
      aria-hidden="true"
    >
      <SideRays
        rayColor1="#8B9CFF"
        rayColor2="#96c8ff"
        origin="top-right"
        speed={1.6}
        intensity={1.5}
        spread={2.2}
        density={5}
        falloff={1.15}
        glow={0.9}
        mouseInfluence={0.4}
      />
    </div>
  </div>
);
