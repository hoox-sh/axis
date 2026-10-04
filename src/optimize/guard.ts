// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Study-in-flight flag so live multiplex defers re-runs.
 *
 * @module optimize/guard
 */

let depth = 0;

export function beginStudy(): void {
  depth += 1;
}

export function endStudy(): void {
  depth = Math.max(0, depth - 1);
}

export function isStudyActive(): boolean {
  return depth > 0;
}
