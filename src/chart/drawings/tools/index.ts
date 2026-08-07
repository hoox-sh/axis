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
 * Side-effect imports that register extended drawing tools.
 * Import once from DrawingLayer / DrawingToolbar bootstrap.
 */

import './lines';
import './fib';
import './shapes';
import './measure-trading';
import './annotation';

export {
  registerToolHandler,
  getToolHandler,
  listToolHandlers,
  toolArity,
  toolNeedsMultiClick,
  type ToolHandler,
  type ToolViewCtx,
  type ToolHitCtx,
} from './registry';
