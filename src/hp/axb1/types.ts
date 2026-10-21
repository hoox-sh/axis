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
 * AXB1 frame shapes (header + typed payload).
 *
 * @module hp/axb1/types
 */

import type { Axb1Opcode, Axb1StatusCode, ValueKind } from './constants';

export interface Axb1HeaderFields {
  seq: number;
  subIdHash: number;
  sessionHash: number;
  tsMs: bigint;
  hdrFlags?: number;
}

export interface Axb1TipFields {
  mask: number;
  flags: number;
  timeS?: number;
  open?: bigint;
  high?: bigint;
  low?: bigint;
  close?: bigint;
  volume?: number;
}

export interface Axb1OhlcvSnapshot {
  priceScale: number;
  count: number;
  closedUpto: number;
  hotFromIndex: number;
  timeS: number[];
  open: bigint[];
  high: bigint[];
  low: bigint[];
  close: bigint[];
  volume: number[];
  flags: number[];
}

export interface Axb1PlotColumn {
  key: string;
  kind: ValueKind;
  ticks?: bigint[];
  values?: number[];
}

export type Axb1Frame =
  | (Axb1HeaderFields & { opcode: Axb1Opcode.HEARTBEAT })
  | (Axb1HeaderFields & { opcode: Axb1Opcode.UNCHANGED })
  | (Axb1HeaderFields & {
      opcode: Axb1Opcode.STATUS;
      statusCode: Axb1StatusCode | string;
      detail: string;
      have: number;
      need: number;
    })
  | (Axb1HeaderFields & { opcode: Axb1Opcode.SNAPSHOT_OHLCV } & Axb1OhlcvSnapshot)
  | (Axb1HeaderFields & {
      opcode: Axb1Opcode.SNAPSHOT_PLOTS;
      count: number;
      closedUpto: number;
      times: number[] | null;
      plots: Axb1PlotColumn[];
    })
  | (Axb1HeaderFields & { opcode: Axb1Opcode.TIP_UPDATE } & Axb1TipFields)
  | (Axb1HeaderFields & {
      opcode: Axb1Opcode.APPEND_BAR;
      priceScale: number;
      closedIndex: number;
      closedTime: number;
      open: bigint;
      high: bigint;
      low: bigint;
      close: bigint;
      volume: number;
      tip: Axb1TipFields;
    })
  | (Axb1HeaderFields & {
      opcode: Axb1Opcode.PLOT_TIP;
      plots: Array<{ keyHash: number; kind: ValueKind; ticks?: bigint; value?: number }>;
    })
  | (Axb1HeaderFields & {
      opcode: Axb1Opcode.CLOSE_VERIFY;
      index: number;
      timeS: number;
      open: bigint;
      high: bigint;
      low: bigint;
      close: bigint;
      volume: number;
    })
  | (Axb1HeaderFields & {
      opcode: Axb1Opcode.ERROR;
      code: string;
      message: string;
      retryable: boolean;
    })
  | (Axb1HeaderFields & { opcode: Axb1Opcode.JSON_BLOB; json: string });
