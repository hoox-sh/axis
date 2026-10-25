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
 * Redesign2 engine module barrel. Runtime wiring is intentionally deferred to
 * a follow-up feature-gated integration pass.
 *
 * @module engine
 */

export * from './policy';
export * from './ws-client';
export * from './frames';
export * from './rest-fallback';
export * from './session-multiplexer';
export * from './session-broker';
export * from './client-apply';
export * from './bar-close-verify';
export * from './market-identity';
export * from './feature-flag';
export * from './router';
export * from './apply-bridge';
export * from './live-wire';