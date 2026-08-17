// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Built-in Hyperparameter Optimisation component plugin.
 * UI is first-class Solid (`HpoPanel`); mount is a no-op until slot host exists.
 *
 * @module plugins/hpo
 */

import { registry } from './registry';
import type { ComponentPlugin } from './types';

export const HPO_PLUGIN_ID = 'hyperparameter-optimisation';

export const hpoPlugin: ComponentPlugin = {
  id: HPO_PLUGIN_ID,
  name: 'Hyperparameter Optimisation',
  kind: 'component',
  builtIn: true,
  description:
    'Search strategy input.* values over N trials (TPE / random / grid). Strategies only.',
  version: '1.0.0',
  capabilities: { offline: true },
  slots: ['results-tab', 'topbar-action', 'manager-tab'],
  configSchema: {
    defaultTrials: {
      type: 'number',
      default: 30,
      min: 5,
      max: 200,
      label: 'Default trials',
    },
    defaultSampler: {
      type: 'select',
      default: 'auto',
      options: ['auto', 'random', 'tpe', 'grid'],
      label: 'Default sampler',
    },
    defaultValidation: {
      type: 'select',
      default: 'holdout',
      options: ['holdout', 'walk-forward', 'in-sample'],
      label: 'Default validation',
    },
  },
  mount() {
    return () => {};
  },
};

let registered = false;

/** Register the built-in HPO component (idempotent). */
export function ensureHpoRegistered(): void {
  if (registered && registry.getComponent(HPO_PLUGIN_ID)) return;
  registry.registerComponent(hpoPlugin);
  registered = true;
}

/** @internal */
export function _resetHpoRegistrationFlag(): void {
  registered = false;
}
