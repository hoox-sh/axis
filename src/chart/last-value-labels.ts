// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Last-value label title helper — hide plot/hline names on the scale
 * while keeping the numeric last value.
 *
 * @module chart/last-value-labels
 */

import { store } from '../store';

/** True when plot/hline names should appear next to last-value labels. */
export function lastValueNamesOn(): boolean {
  try {
    return store.lastValueNamesVisible !== false;
  } catch {
    return true;
  }
}

/** Series / price-line `title` to send to LWC (empty when names are off). */
export function seriesLabelTitle(name: string | null | undefined): string {
  if (!lastValueNamesOn()) return '';
  return name != null ? String(name) : '';
}
