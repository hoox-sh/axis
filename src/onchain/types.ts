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
 * Core types for AXIS on-chain data plane (Phase 1).
 *
 * @module onchain/types
 */

/** Payload shape a dataset carries: bars, one/many scalar series, events, or table rows. */
export type DatasetKind = 'ohlcv' | 'scalar_series' | 'multi_series' | 'events' | 'table';

/** How settled the upstream data is; `unknown` when the provider signals nothing. */
export type Finality = 'pending' | 'safe' | 'finalized' | 'unknown';

/**
 * Identity of one on-chain series — chain, protocol or contract address,
 * metric and facet — as handed to a `DatasetPlugin`.
 */
export interface OnchainInstrument {
  chainId: string; // e.g. eip155:1 or "all" for multi-chain protocol metrics
  address?: string;
  protocolId?: string;
  metric: string; // e.g. 'tvl'
  facet?: string;
  symbol: string; // human label
}

/** One scalar sample: unix seconds plus value, with optional per-point metadata. */
export interface TimePoint {
  time: number; // unix seconds
  value: number;
  meta?: Record<string, number | string | boolean>;
}

/**
 * One on-chain event row — a synthetic TVL spike/drop or a provider event.
 * Feeds chart markers and the `onchain_event` / `onchain_tvl_spike` alerts.
 */
export interface EventPoint {
  time: number;
  type: string;
  title?: string;
  severity?: 'info' | 'warn' | 'critical';
  price?: number;
  payload?: Record<string, unknown>;
}

/**
 * Normalized dataset returned by a `DatasetPlugin`: exactly one of
 * `bars` / `series` / `points` / `events` / `rows` is populated, alongside the
 * instrument it describes, its provenance, and how final the data is.
 */
export interface OnchainDataset {
  id: string;
  kind: DatasetKind;
  instrument: OnchainInstrument;
  resolution: string;
  bars?: import('../store/types').Bar[];
  series?: Record<string, TimePoint[]>;
  points?: TimePoint[];
  events?: EventPoint[];
  rows?: Record<string, unknown>[];
  asOf: number;
  finality: Finality;
  provenance: { provider: string; queryId?: string; url?: string };
  /** true when OHLC was synthesized from mid/marks */
  synthetic?: boolean;
}

/**
 * Arguments to `DatasetPlugin.fetchDataset`. Time bounds are unix seconds;
 * `limit` caps the number of points returned (plugins may ignore it).
 */
export interface DatasetFetchOpts {
  instrument: OnchainInstrument;
  resolution?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}

/** Attached chart series (ephemeral UI state shape; store may re-export) */
export interface OnchainSeriesAttachment {
  id: string;
  datasetId: string;
  providerId: string;
  instrument: OnchainInstrument;
  label: string;
  color: string;
  visible: boolean;
  /** scale: left = independent metric scale; right = price scale */
  scale: 'left' | 'right';
  points: TimePoint[];
  provenance: OnchainDataset['provenance'];
  finality: Finality;
  loading?: boolean;
  error?: string | null;
}
