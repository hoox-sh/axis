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
 * Core types for AXIS on-chain data plane (Phase 1).
 *
 * @module onchain/types
 */

export type DatasetKind = 'ohlcv' | 'scalar_series' | 'multi_series' | 'events' | 'table';
export type Finality = 'pending' | 'safe' | 'finalized' | 'unknown';

export interface OnchainInstrument {
  chainId: string; // e.g. eip155:1 or "all" for multi-chain protocol metrics
  address?: string;
  protocolId?: string;
  metric: string; // e.g. 'tvl'
  facet?: string;
  symbol: string; // human label
}

export interface TimePoint {
  time: number; // unix seconds
  value: number;
  meta?: Record<string, number | string | boolean>;
}

export interface EventPoint {
  time: number;
  type: string;
  title?: string;
  severity?: 'info' | 'warn' | 'critical';
  price?: number;
  payload?: Record<string, unknown>;
}

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
