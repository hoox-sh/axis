// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { redactSecret } from '../secrets/validate';

/**
 * Scrub Pro/Worker keys and Bearer tokens from user-visible strings
 * (OutputChannel, diagnostics, toasts). Never returns the raw secret.
 */
export function scrubSecrets(value: unknown): string {
  try {
    if (value == null) return '';
    const text = typeof value === 'string' ? value : String(value);
    return text
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ****')
      .replace(/pyn_[A-Za-z0-9_-]{8,}/g, (m) => redactSecret(m))
      .replace(/pn_[a-fA-F0-9]{16,}/g, (m) => redactSecret(m));
  } catch {
    return '(redacted)';
  }
}
