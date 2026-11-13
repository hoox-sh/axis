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
 * Compact sparkline for a numeric series (Plots subpage and saved-run rows).
 *
 * @module ui/results/Sparkline
 */

import { sparklinePath } from '../../results/overlay';

/** A 100×34 inline SVG path; `null` points create gaps. */
export function Sparkline(props: { data: (number | null)[]; positive?: boolean }) {
  const path = () => sparklinePath(props.data, { w: 100, h: 34, pad: 3 });
  return (
    <svg viewBox="0 0 100 34" class="ax-spark" preserveAspectRatio="none" aria-hidden="true">
      <path d={path()} fill="none" class={props.positive ? 'ax-spark-pos' : 'ax-spark-neg'} />
    </svg>
  );
}
