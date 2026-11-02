// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/** OutputChannel name for AXIS run logs (command return value / tests). */
export const RUN_OUTPUT_CHANNEL_NAME = 'AXIS Run';

/** Command return when Run Script has no active Pine editor. */
export const RUN_NO_PINE_MESSAGE =
  'AXIS: Run Script needs an active Pine Script™ editor (.pyne / .pine).';

/** Re-export — electron tests + command return value when no Pine buffer. */
export { OPEN_CHART_NO_PINE_MESSAGE } from './host/open-chart';
