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

export {
  PRO_API_KEY_RE,
  PRO_KEY_ERROR,
  SECRET_SLOTS,
  SECRET_STORE_ERROR,
  WORKER_API_KEY_RE,
  WORKER_KEY_ERROR,
  type SecretSlot,
} from './slots';
export {
  formatSecretStatus,
  type SecretPresence,
  type SecretStatusLabel,
} from './status';
export {
  AxisSecretStorage,
  createMemorySecretStore,
  type SecretStore,
} from './storage';
export {
  redactSecret,
  validateProKey,
  validateWorkerKey,
  type ValidateErr,
  type ValidateOk,
  type ValidateResult,
} from './validate';
