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

import type { ExtensionContext } from 'vscode';
import { window } from 'vscode';
import type { ResultsFocusStore } from '../run/results-store';
import {
  RESULTS_VIEW_ID,
  createResultsProvider,
  type ResultsWebviewViewProvider,
} from './results-panel';

export { RESULTS_VIEW_ID, STRATEGY_VIEW_ID } from './results-panel';
export { buildResultsWebviewHtml } from './results-html';
export { handleResultsWebviewMessage, encodeResultsSet } from './results-messages';

/** Register the Results WebviewViewProvider (`axis.results`). */
export function registerResultsView(
  context: ExtensionContext,
  store: ResultsFocusStore,
): ResultsWebviewViewProvider {
  const provider = createResultsProvider(context, store);
  context.subscriptions.push(
    window.registerWebviewViewProvider(RESULTS_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );
  return provider;
}
