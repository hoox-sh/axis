/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [solid(), tailwindcss()],
  // Prevent Vite from wiping the terminal when the Rust compiler prints errors.
  clearScreen: false,
  build: {
    outDir: 'dist',
    // Tauri uses Chromium / WebKit — esnext is fine for the PWA path too.
    target: process.env.TAURI_ENV_PLATFORM ? 'es2021' : 'esnext',
    // Produce sourcemaps for debugging the desktop shell.
    sourcemap: !!process.env.TAURI_ENV_PLATFORM,
    rollupOptions: {
      output: {
        /**
         * Vendor / heavy-feature chunks for parallel download + better caching.
         * Feature lazy() still needed to shrink first-parse; this helps cache.
         */
        manualChunks(id) {
          if (id.includes('node_modules/lightweight-charts')) return 'lwc';
          if (
            id.includes('node_modules/@codemirror') ||
            id.includes('node_modules/crelt') ||
            id.includes('node_modules/style-mod') ||
            id.includes('node_modules/w3c-keyname')
          ) {
            return 'cm';
          }
          if (id.includes('node_modules/lucide-solid')) return 'icons';
          if (id.includes('node_modules/solid-js')) return 'solid';
          if (id.includes('pyne-builtins.json')) return 'pyne-builtins';
        },
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 3000,
    // Tauri expects a fixed port; fail if 3000 is taken.
    strictPort: true,
    // Bind IPv4 explicitly. `host: false` / "localhost" often listens only on
    // [::1], while tauri.conf.json devUrl is http://127.0.0.1:3000 — Tauri then
    // waits forever ("Waiting for your frontend dev server…").
    host: host || '127.0.0.1',
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 3001,
        }
      : undefined,
    watch: {
      // Don’t re-trigger Vite on Rust rebuilds.
      ignored: ['**/src-tauri/**'],
    },
    proxy: {
      '/run': 'http://localhost:5002',
    },
  },
});
