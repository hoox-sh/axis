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
 * Static-host security + cache headers (Pages `_headers`, nginx, PWA servers).
 *
 * `connect-src` is an explicit host list — never scheme-wide `https:` / `wss:`.
 * Keep every copy in lockstep: `public/_headers`, both nginx configs, Tauri
 * `app.security.csp`, and this module. Tests grep-pin the tokens.
 *
 * Cloudflare Insights (`static.cloudflareinsights.com/beacon.min.js`) is
 * injected at the edge on `axis.hoox.sh` when Web Analytics is on, not on
 * `*.pages.dev`. `script-src` and `connect-src` allow that host so the
 * beacon does not throw a CSP error on the custom domain. pages.dev does
 * not inject it, so the extra host is unused there.
 *
 * @module hp/security-headers
 */

/** Hashed Vite bundles under `/assets/*` (content hash in the filename). */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** HTML / unhashed shell — always revalidate. */
export const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/** 180 days; no `preload` (not discussed). */
export const HSTS_VALUE = 'max-age=15552000; includeSubDomains';

/** Feature policy: camera / mic / location / payment / usb off. */
export const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/**
 * Documented Cloudflare Page Shield nonce copied onto CF-injected inline
 * scripts. Constant, so it is not a security boundary — keep until JSD is off.
 */
export const PAGES_SCRIPT_NONCE = 'VwY65J9HsSZUqkEll3A';

/**
 * `connect-src` hosts AXIS actually talks to from the page.
 *
 * Custom alert webhooks and user-typed engine URLs outside this list are
 * blocked by CSP (secrets stay in-origin; Worker / PYNE remain the proxy).
 */
export const CSP_CONNECT_SRC_HOSTS = [
  "'self'",
  'blob:',
  'http://127.0.0.1:*',
  'http://localhost:*',
  'ws://127.0.0.1:*',
  'ws://localhost:*',
  'https://axis.hoox.sh',
  'https://worker.axis.hoox.sh',
  'wss://worker.axis.hoox.sh',
  'https://pynescript.online',
  'wss://pynescript.online',
  'https://pynescript-axis.pages.dev',
  'https://*.pynescript-axis.pages.dev',
  'https://axis.pages.dev',
  'https://*.axis.pages.dev',
  'https://pyne-worker.cryptolinx.workers.dev',
  'wss://pyne-worker.cryptolinx.workers.dev',
  'https://pyne-agent-worker.cryptolinx.workers.dev',
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://fapi.binance.com',
  'https://dapi.binance.com',
  'wss://stream.binance.com',
  'wss://stream.binance.com:9443',
  'wss://data-stream.binance.vision',
  'wss://fstream.binance.com',
  'wss://dstream.binance.com',
  'https://api.mexc.com',
  'wss://wbs.mexc.com',
  'wss://wbs-api.mexc.com',
  'https://www.okx.com',
  'wss://ws.okx.com:8443',
  'https://api.bybit.com',
  'wss://stream.bybit.com',
  'https://api.exchange.coinbase.com',
  'wss://advanced-trade-ws.coinbase.com',
  'wss://ws-feed.exchange.coinbase.com',
  'https://api.kraken.com',
  'wss://ws.kraken.com',
  'https://api.llama.fi',
  'https://api.geckoterminal.com',
  'https://api.coingecko.com',
  'https://api.github.com',
  'https://gitlab.com',
  'https://static.cloudflareinsights.com',
  'https://cloudflareinsights.com',
] as const;

/** Space-joined `connect-src` source list. */
export const CSP_CONNECT_SRC = CSP_CONNECT_SRC_HOSTS.join(' ');

const CSP_SCRIPT_SRC_CORE =
  "'self' 'wasm-unsafe-eval' https://pyne-agent-worker.cryptolinx.workers.dev https://static.cloudflareinsights.com";

function buildCsp(scriptSrc: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${CSP_CONNECT_SRC}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}

/** nginx / Bun / Python CSP (no static nonce). */
export const CSP_VALUE = buildCsp(CSP_SCRIPT_SRC_CORE);

/** Cloudflare Pages CSP — nonce is a CF JavaScript Detections interop hook. */
export const PAGES_CSP_VALUE = buildCsp(
  `'self' 'nonce-${PAGES_SCRIPT_NONCE}' 'wasm-unsafe-eval' https://pyne-agent-worker.cryptolinx.workers.dev https://static.cloudflareinsights.com`,
);

/** True when a CSP `connect-src` list has no scheme-wide `https:` / `wss:`. */
export function connectSrcIsAllowlisted(csp: string): boolean {
  const match = /connect-src\s+('self'\s+[^;]*)/i.exec(csp);
  const list = match?.[1];
  if (!list) return false;
  const tokens = list.trim().split(/\s+/);
  for (const token of tokens) {
    if (token === 'https:' || token === 'wss:' || token === 'http:' || token === 'ws:') {
      return false;
    }
  }
  return tokens.includes("'self'") && tokens.includes('https://worker.axis.hoox.sh');
}
