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
 * Confirmation gate for destructive actions.
 *
 * Eight call sites hand-rolled the same `typeof window === 'undefined' ? true
 * : window.confirm(...)` guard. Centralising it means the "no DOM ⇒ allow"
 * rule for tests and SSR is stated once, and swapping in a styled dialog later
 * touches one function instead of eight.
 *
 * @module ui/confirm-destructive
 */

/**
 * Ask before an irreversible action.
 *
 * Returns `true` when there is no DOM to ask with (unit tests, SSR) — the same
 * fail-open rule the call sites already used, so headless paths are unchanged.
 *
 * @param message Question to show. Keep it specific: what is lost, and whether
 *   it can be undone.
 */
export function confirmDestructive(message: string): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof window.confirm !== 'function') return true;
  return window.confirm(message);
}
