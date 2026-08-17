// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AXIS-side types for strategy hyperparameter search.
 * The evaluation SoT is `pynescript.optimize` / `POST /optimize`.
 *
 * @module optimize/types
 */

import type { StrategyStats } from '../results/strategy';

export type SamplerId = 'auto' | 'random' | 'tpe' | 'grid';
export type ObjectiveId = 'net_pnl' | 'profit_factor' | 'calmar' | 'composite';
export type ValidationId = 'holdout' | 'walk-forward' | 'in-sample';
export type ParamKind = 'int' | 'float' | 'bool' | 'categorical';

export const MAX_TRIALS = 200;
export const MAX_ENGINE_RUNS = 400;
export const HPO_STORAGE_KEY = 'pynescript.axis.hpo.v1';

export type ParamValue = number | boolean | string;

export interface ParamSpec {
  name: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  choices?: ParamValue[];
  enabled?: boolean;
}

export interface ValidationSpec {
  mode: ValidationId;
  holdoutFrac: number;
  trainBars: number;
  testBars: number;
  stepBars: number;
}

export interface TrialRow {
  index: number;
  params: Record<string, ParamValue>;
  isStats?: Partial<StrategyStats> | null;
  oosStats?: Partial<StrategyStats> | null;
  isScore?: number | null;
  oosScore?: number | null;
  error?: string | null;
  engineRuns?: number;
  ms?: number;
}

export interface StudySnapshot {
  status: string;
  sampler: string;
  objective: string;
  validation: ValidationSpec;
  nTrials: number;
  trials: TrialRow[];
  bestIndex?: number | null;
  bestParams?: Record<string, ParamValue> | null;
  bestIsScore?: number | null;
  bestOosScore?: number | null;
  engineRuns: number;
  ms: number;
  warning?: string | null;
  error?: string | null;
  backend?: 'pyne' | 'client';
}
