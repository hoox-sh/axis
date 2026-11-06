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
 * Shared loading spinner.
 *
 * Replaces scattered `Icons.loader class="animate-spin"` call sites so the
 * same accessible attributes (`aria-busy`, stable `data-testid`) and sizing
 * behavior are used everywhere.
 *
 * @module ui/Spinner
 */

import type { Component } from 'solid-js';
import { Icons } from './icons';

/** Props for the shared spinner: pixel size, extra classes, and a11y label. */
export type SpinnerProps = {
  /** Pixel size forwarded to the underlying icon. */
  size?: number;
  /** Extra Tailwind classes (e.g. `text-accent`). */
  class?: string;
  /** Optional accessible label; defaults to "Loading". */
  label?: string;
};

/**
 * Shared loading spinner built on the loader icon; spins via CSS and exposes a
 * default "Loading" label with `role="status"`.
 */
export const Spinner: Component<SpinnerProps> = (props): JSX.Element => (
  <Icons.loader
    class={`animate-spin ${props.class ?? ''}`}
    size={props.size}
    data-testid="axis-spinner"
    role="status"
    aria-busy="true"
    aria-label={props.label ?? 'Loading'}
  />
);
