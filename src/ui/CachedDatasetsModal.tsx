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
 * Cached datasets modal — the studio Data page's dataset inventory in a
 * dialog shell.
 *
 * The inventory itself (filters, coverage, load window, delete, export) is
 * {@link module:ui/dsm/DatasetsBrowser}; this is only the chrome. The studio
 * Data page is the primary surface — this modal stays for the Topbar
 * "Datasets…" button and the data-manager venue switch.
 *
 * @module ui/CachedDatasetsModal
 */

import { type Component } from 'solid-js';
import { Modal } from './Modal';
import { DatasetsBrowser } from './dsm/DatasetsBrowser';

export interface CachedDatasetsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Modal: browse local OHLCV datasets from the Data Source Manager cache. */
export const CachedDatasetsModal: Component<CachedDatasetsModalProps> = (props) => {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Dataset manager"
      titleId="axis-cached-datasets-title"
      hintClass="sc-hint truncate"
      hint="Local OHLCV cache · filter, inspect coverage, load a date range or max bars"
      class="w-[min(960px,calc(100vw-2*var(--ui-dialog-margin)))] max-h-[min(88vh,820px)] flex flex-col"
      bodyClass="flex flex-col gap-3.5 min-h-0 overflow-hidden flex-1"
      testId="axis-cached-datasets-modal"
      autoFocus={false}
      footer={
        <>
          <div class="flex-1" />
          <button type="button" class="sc-btn sc-btn-ghost" onClick={() => props.onClose()}>
            Close
          </button>
        </>
      }
    >
      <DatasetsBrowser enableKeyboardNav onEscape={props.onClose} />
    </Modal>
  );
};
