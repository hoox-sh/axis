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
 * AXB1 binary envelope constants (HP PR 1).
 *
 * Magic `'AXB1'` stored little-endian as bytes `41 58 42 31`.
 *
 * @module hp/axb1/constants
 */

/** `'AXB1'` as a little-endian uint32 (`41 58 42 31`). */
export const AXB1_MAGIC = 0x31425841;

/** Control-block magic `'HPC1'` (little-endian `48 50 43 31`). Reserved for HP-2. */
export const HPC1_MAGIC = 0x31435048;

export const AXB1_VERSION = 1;

/** Envelope size; payload starts here and is 8-byte aligned. */
export const AXB1_HEADER_BYTES = 32;

/** Reject payloads larger than this (4 MiB). */
export const AXB1_MAX_PAYLOAD = 4 * 1024 * 1024;

/** Hot-window capacity (multiple of 64). SAB sizing for later PRs. */
export const HOT_CAP = 5120;

export enum Axb1Opcode {
  HEARTBEAT = 0x00,
  STATUS = 0x01,
  SNAPSHOT_OHLCV = 0x02,
  SNAPSHOT_PLOTS = 0x03,
  TIP_UPDATE = 0x04,
  APPEND_BAR = 0x05,
  PLOT_TIP = 0x06,
  CLOSE_VERIFY = 0x07,
  ERROR = 0x08,
  UNCHANGED = 0x09,
  JSON_BLOB = 0x0a,
}

export enum TipMask {
  OPEN = 1 << 0,
  HIGH = 1 << 1,
  LOW = 1 << 2,
  CLOSE = 1 << 3,
  VOLUME = 1 << 4,
  TIME = 1 << 5,
}

/** hdr_flags bit 0: envelope carries a UTF-8 sub id (unused in v1). */
export const AXB1_HDR_HAS_SUB_ID = 1 << 0;

/** hdr_flags bit 1: compressed payload. Must be 0 in v1. */
export const AXB1_HDR_COMPRESSED = 1 << 1;

export enum ValueKind {
  PriceTicks = 0,
  UnitFloat64 = 1,
}

/** STATUS payload code byte → JSON `status.code`. */
export const AXB1_STATUS_CODES = [
  'datafeed-loading',
  'datafeed-ready',
  'calculating',
  'live',
  'degraded',
  'error',
] as const;

export type Axb1StatusCode = (typeof AXB1_STATUS_CODES)[number];

export const PRICE_SCALE_MIN = 0;
export const PRICE_SCALE_MAX = 12;
export const PRICE_SCALE_DEFAULT = 8;
