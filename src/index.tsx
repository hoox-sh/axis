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
 * Vite / PWA entry — mounts Solid into `#app`.
 *
 * Routes by URL via `isEditorView()`:
 * - Editor popout → {@link EditorApp} (detached Pine editor)
 * - Default → {@link App} (full chart workspace)
 *
 * Global styles: `./index.css` (Tailwind + void theme tokens).
 *
 * Hardening: root {@link ErrorBoundary} + window unhandled error handlers so a
 * render/boot throw does not leave a blank `#app` white screen.
 */

import { ErrorBoundary } from 'solid-js';
import { render } from 'solid-js/web';
import { App } from './app';
import { EditorApp } from './editor/EditorApp';
import { isEditorView } from './editor/editor-bridge';
import { registerAxisServiceWorker } from './pwa/register-sw';
import { errorFallback } from './ui/ErrorFallback';
import { installBootErrorHandlers, reportUiError } from './ui/boot-errors';
import './index.css';

// Catch async boot failures (plugin restore, dynamic imports, etc.)
installBootErrorHandlers();

// Production PWA only (skipped in Vite DEV). Idempotent — safe if called once.
void registerAxisServiceWorker();

const root = document.getElementById('app');
if (root) {
  const isEditor = isEditorView();
  const fallback = errorFallback({
    variant: 'page',
    source: isEditor ? 'editor-root' : 'root',
    title: isEditor ? 'Editor failed to load' : 'AXIS failed to load',
    onError: (err) =>
      reportUiError(err, {
        source: isEditor ? 'editor' : 'boot',
        context: 'UI render error',
        status: true,
      }),
  });

  if (isEditor) {
    render(
      () => (
        <ErrorBoundary fallback={fallback}>
          <EditorApp />
        </ErrorBoundary>
      ),
      root,
    );
  } else {
    render(
      () => (
        <ErrorBoundary fallback={fallback}>
          <App />
        </ErrorBoundary>
      ),
      root,
    );
  }
} else if (typeof console !== 'undefined' && console.error) {
  console.error('[axis] #app root element missing — cannot mount');
}
