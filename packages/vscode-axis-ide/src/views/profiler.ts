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
  PROFILER_VIEW_ID,
  createProfilerProvider,
  type ProfilerWebviewViewProvider,
} from './profiler-panel';

export { PROFILER_VIEW_ID } from './profiler-panel';
export { buildProfilerWebviewHtml } from './profiler-html';
export { createProfilerProvider } from './profiler-panel';

/** Register the Profiler WebviewViewProvider (`axis.profiler`). */
export function registerProfilerView(
  context: ExtensionContext,
  store: ResultsFocusStore,
): ProfilerWebviewViewProvider {
  const provider = createProfilerProvider(context, store);
  try {
    context.subscriptions.push(
      window.registerWebviewViewProvider(PROFILER_VIEW_ID, provider, {
        webviewOptions: { retainContextWhenHidden: false },
      }),
    );
  } catch {
    // uncontributed view id / test host
  }
  return provider;
}
