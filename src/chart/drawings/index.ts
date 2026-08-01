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
 * Interactive drawings package — D0 foundation barrel.
 *
 * Re-exports the pure foundation for chart drawings:
 * - **types / defaults** — unified model, palette, tool arities, fib levels
 * - **normalize** — legacy ↔ dual-shape hydrate (`points` + `p1`/`p2`/`price`)
 * - **geometry / coords / snap / draft** — hit math, LWC mapping, magnet, placement
 * - **svg-primitives / tool-catalog** — overlay builders, toolbar groups
 *
 * Later slices will re-export renderers, hit-testing, migration, and store
 * adapters from this entry.
 *
 * Does **not** mount UI, open WebSockets, or evaluate Pine Script™ drawings.
 */

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  ChartPoint,
  Point,
  LineStyle,
  DrawingStyle,
  DrawingKind,
  DrawingToolId,
  DrawingMeta,
  Drawing,
  PointArity,
  ToolSpec,
  HandleId,
  Handle,
  DraftPhase,
  DragState,
  DraftState,
  MagnetMode,
  LegacyDrawingKind,
  LegacyDrawingToolId,
  LegacyDrawingBase,
  LegacyHLineDrawing,
  LegacyTwoPointDrawing,
  LegacyTextDrawing,
  LegacyDrawing,
  HLineDrawing,
  TwoPointDrawing,
  TextDrawing,
  IsLegacyDrawing,
  MigrateLegacyDrawing,
  IsUnifiedDrawing,
} from './types';

// ── Defaults / palette / tools ──────────────────────────────────────────────
export {
  DRAWING_COLORS,
  DEFAULT_STYLE,
  FIB_LEVELS,
  FIB_EXT_LEVELS,
  TOOL_SPECS,
  ALL_DRAWING_TOOLS,
  requiredPoints,
  needsTwoPoints,
  toolLabel,
} from './defaults';
export type { DrawingColorKey, RequiredPoints } from './defaults';

// ── Pure modules (D0) ───────────────────────────────────────────────────────
export {
  normalizeDrawing,
  normalizeUserDrawings,
  attachLegacyFields,
} from './normalize';
/** Drawing shape produced by `normalize` (local dual-shape interface). */
export type { Drawing as NormalizedDrawing } from './normalize';

export {
  distToSegment,
  nearPoint,
  nearRectEdge,
  extendSegment,
  rayExtendPixels,
  shiftPoints,
  resizePoint,
  fibPrices,
  fibExtensionPrices,
  channelEdges,
  ellipseBBox,
} from './geometry';

export { createCoordContext } from './coords';
export type { CoordContext, ViewSize } from './coords';

export { el, line, circle, label, strokeDashFor } from './svg-primitives';

export { snapToBars, findNearestBarIndex } from './snap';
/** Magnet mode from snap (aliased to avoid clashing with types.MagnetMode). */
export type { MagnetMode as SnapMagnetMode, BarLike, SnapOptions } from './snap';

export { createDraftController } from './draft';
/** Draft controller phase (distinct from types.DraftPhase string union). */
export type { DraftController, DraftPhase as DraftControllerPhase } from './draft';

export {
  TOOL_GROUPS,
  defaultToolForGroup,
  groupForTool,
} from './tool-catalog';
export type { ToolGroupId, ToolGroupDef } from './tool-catalog';

// ── Copy / merge / symbol filter (multi-chart prep) ──────────────────────────
export {
  newDrawingId,
  deepCloneDrawing,
  cloneDrawing,
  cloneDrawings,
  drawingsForSymbol,
  tagDrawingsSymbol,
  mergeDrawings,
  offsetDrawingGeometry,
  cloneDrawingsOffset,
} from './sync';
export type {
  DrawingSyncLike,
  MergeDrawingsMode,
  CloneDrawingsOptions,
  DrawingsForSymbolOptions,
  OffsetDrawingOptions,
} from './sync';

// ── Drawing templates (analysis packs) ──────────────────────────────────────
export {
  DRAWING_TEMPLATES_KEY,
  TEMPLATE_FORMAT,
  TEMPLATE_VERSION,
  serializeDrawing,
  serializeDrawings,
  deserializeDrawing,
  deserializeDrawings,
  hydrateTemplateDrawings,
  parseTemplateMeta,
  parseTemplate,
  createTemplate,
  parseTemplatesStore,
  applyTemplateDrawings,
  loadTemplates,
  saveTemplates,
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  exportTemplateJson,
  exportAllTemplatesJson,
  parseImportPayload,
  importTemplateJson,
  importTemplates,
} from './templates';
export type {
  DrawingTemplateMeta,
  SerializedDrawing,
  DrawingTemplate,
  DrawingTemplatesStore,
  DrawingTemplateSummary,
  LoadTemplateMode,
  DrawingTemplateExport,
  DrawingTemplatesExport,
} from './templates';
