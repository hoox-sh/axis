// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Leaf flag for the dev-only mock-walk venue. Kept in a standalone module
 * (no imports) so any layer — store, streams, chart — can fence itself off
 * from live traffic while the deterministic venue owns the chart, without
 * import cycles.
 */

let active = false;

/** Mark the mock-walk venue as owning the chart (or not). */
export function setMockWalkVenueActive(v: boolean): void {
  active = v;
}

/** True while the mock-walk venue owns the chart. */
export function isMockWalkVenueActive(): boolean {
  return active;
}
