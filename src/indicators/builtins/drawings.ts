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
 * Original AXIS drawing gallery — one overlay that places every script drawing.
 *
 * @module indicators/builtins/drawings
 */

import { def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

export const DRAWING_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'drawings',
    title: 'AXIS Drawings',
    shorttitle: 'Draw',
    description: 'Label, line, linefill, box, polyline, and table on one overlay',
    category: 'drawing',
    covers: 'Pine drawings',
    tags: ['drawing', 'label', 'line', 'linefill', 'box', 'polyline', 'table', 'overlay'],
    code: pineIndicator(
      'AXIS Drawings',
      'Draw',
      true,
      `var line hi = na
var line lo = na
var linefill band = na
var box bx = na
var label tag = na
var polyline path = na
var table board = na

// Series calls stay outside the last-bar block. Objects born at bar_index 0
// sit off the left edge of a long history.
top = ta.highest(high, 16)
bot = ta.lowest(low, 16)
mid = (top + bot) / 2
if barstate.islast
    left = bar_index - 16
    if not na(hi)
        line.delete(hi)
    if not na(lo)
        line.delete(lo)
    if not na(band)
        linefill.delete(band)
    if not na(bx)
        box.delete(bx)
    if not na(tag)
        label.delete(tag)
    if not na(path)
        polyline.delete(path)
    hi := line.new(left, top, bar_index, top, color = color.yellow, width = 3)
    lo := line.new(left, bot, bar_index, bot, color = color.purple, width = 3)
    band := linefill.new(hi, lo, color = color.new(color.yellow, 80))
    bx := box.new(
         bar_index - 12,
         top,
         bar_index - 6,
         mid,
         border_color = color.aqua,
         border_width = 2,
         bgcolor = color.new(color.aqua, 70))
    tag := label.new(
         bar_index,
         top,
         "Label",
         style = label.style_label_down,
         color = color.blue,
         textcolor = color.white,
         size = size.large)
    path := polyline.new(
         array.from(
             chart.point.from_index(bar_index - 14, bot),
             chart.point.from_index(bar_index - 8, top),
             chart.point.from_index(bar_index - 2, mid)),
         false,
         xloc.bar_index,
         color.fuchsia,
         width = 3)
    if na(board)
        board := table.new(position.top_right, 2, 6, bgcolor = color.new(#0c0e14, 10))
        table.cell(board, 0, 0, "Drawing")
        table.cell(board, 1, 0, "Sample")
        table.cell(board, 0, 1, "Line")
        table.cell(board, 1, 1, "hi / lo")
        table.cell(board, 0, 2, "Linefill")
        table.cell(board, 1, 2, "band")
        table.cell(board, 0, 3, "Box")
        table.cell(board, 1, 3, "range")
        table.cell(board, 0, 4, "Label")
        table.cell(board, 1, 4, "tag")
        table.cell(board, 0, 5, "Polyline")
        table.cell(board, 1, 5, "path")

plot(close, "Close", display = display.none)`,
      'max_lines_count=20, max_labels_count=20, max_boxes_count=20, max_polylines_count=10',
    ),
  }),
];
