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
 * AXIS first-party built-in scripts — original Pine, not third-party templates.
 *
 * @module indicators/builtins
 */

export { applyBuiltinScript, type ApplyBuiltinResult } from './apply';
export {
  BUILTIN_SCRIPTS,
  builtinCategoryLabel,
  builtinsInCategory,
  filterBuiltinScripts,
  getBuiltinScript,
  listBuiltinCategories,
} from './catalog';
export { AXIS_PINE_BANNER, COL } from './pine';
export { SKIPPED_STUDIES } from './skipped';
export type { BuiltinCategory, BuiltinKind, BuiltinScript, SkippedStudy } from './types';
