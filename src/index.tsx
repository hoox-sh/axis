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
 * App and EditorApp are dynamic imports so the chart PWA critical path does
 * not statically pull CodeMirror / editor chrome (and vice versa).
 *
 * Global styles: `./index.css` (Tailwind + void theme tokens).
 *
 * Hardening: root {@link ErrorBoundary} + window unhandled error handlers so a
 * render/boot throw does not leave a blank `#app` white screen.
 */

import { ErrorBoundary } from 'solid-js';
import { render } from 'solid-js/web';
import { isEditorView } from './editor/editor-bridge';
import { isDevBuild, isTauriShell, registerAxisServiceWorker } from './pwa/register-sw';
import { listenForPwaInstallPrompt } from './pwa/install-prompt';
import { installCloseGuard } from './pwa/close-guard';
import {
  checkForUpdates,
  setWaitingWorkerActivate,
  startUpdatePolling,
} from './update/update-manager';
import { errorFallback } from './ui/ErrorFallback';
import { installBootErrorHandlers, reportUiError } from './ui/boot-errors';
import './index.css';

// Catch async boot failures (plugin restore, dynamic imports, etc.)
installBootErrorHandlers();

// Prompt on tab/window close while editor tabs hold unsaved edits
// (predicates registered by the editor; no-op until one reports dirty).
installCloseGuard();

// Production PWA only (skipped in Vite DEV). Idempotent — safe if called once.
// A waiting service worker stores its activation and the version poll confirms
// the deployed version number before surfacing the banner. The activation is
// retained when the poll doesn't confirm (VERSION not bumped, offline, or
// cached version.json) so the next successful poll still prompts.
void registerAxisServiceWorker({
  onUpdateAvailable: ({ activate }) => {
    setWaitingWorkerActivate(activate);
    void checkForUpdates().then((info) => {
      if (info) return;
      // Waiting worker exists but version.json matches: never sit silently.
      // Banner stays VERSION-gated on purpose — bump VERSION to prompt.
      try {
        console.info(
          '[axis] service worker update waiting; version.json unchanged — bump VERSION to surface the update banner',
        );
      } catch {
        /* logging must never break the update flow */
      }
    });
  },
});
// Poll the deployed /version.json (interval + focus/visibility/online).
// Skipped in the Tauri shell: the bundled version.json never changes there
// and desktop updates ship through the native updater, not the PWA path.
// Skipped in Vite DEV to match register-sw (avoids noise + banner in dev).
if (!isTauriShell() && !isDevBuild()) {
  startUpdatePolling();
}
// Capture beforeinstallprompt even in production without nags until the chip shows.
listenForPwaInstallPrompt();

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

  void (async () => {
    try {
      if (isEditor) {
        const { EditorApp } = await import('./editor/EditorApp');
        render(
          () => (
            <ErrorBoundary fallback={fallback}>
              <EditorApp />
            </ErrorBoundary>
          ),
          root,
        );
      } else {
        const { App } = await import('./app');
        render(
          () => (
            <ErrorBoundary fallback={fallback}>
              <App />
            </ErrorBoundary>
          ),
          root,
        );
      }
    } catch (err: unknown) {
      reportUiError(err, {
        source: isEditor ? 'editor' : 'boot',
        context: isEditor ? 'Editor shell import failed' : 'App shell import failed',
        status: true,
      });
      // Import failed before ErrorBoundary could mount — show the same page fallback.
      render(() => fallback(err, () => location.reload()), root);
    }
  })();
} else if (typeof console !== 'undefined' && console.error) {
  console.error('[axis] #app root element missing — cannot mount');
}
