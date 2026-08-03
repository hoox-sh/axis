/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Connection HUD pure model: local vs worker endpoints, exec mode, transport path.
 * Invariant: `deriveHud` labels match endpoint classification for status UI.
 */

import { describe, expect, it } from 'bun:test';
import {
  deriveHud,
  isLocalEndpoint,
  isWorkerEndpoint,
  normalizeExecMode,
  transportToPath,
} from '../src/ui/hud-model';

describe('hud-model helpers', () => {
  it('detects local endpoints', () => {
    expect(isLocalEndpoint('http://127.0.0.1:5002')).toBe(true);
    expect(isLocalEndpoint('http://localhost:5002')).toBe(true);
    expect(isLocalEndpoint('http://162.254.38.194:5002')).toBe(false);
  });

  it('detects worker endpoints', () => {
    expect(isWorkerEndpoint('https://pyne-worker.example.workers.dev')).toBe(true);
    expect(isWorkerEndpoint('http://162.254.38.194:5002')).toBe(false);
  });

  it('normalizes mode', () => {
    expect(normalizeExecMode('compile')).toBe('compile');
    expect(normalizeExecMode('nope')).toBe('interpret');
  });

  it('maps transport to PATH', () => {
    expect(transportToPath('ws')).toBe('WS');
    expect(transportToPath('rest')).toBe('REST');
    expect(transportToPath('local')).toBe('—');
  });
});

describe('deriveHud', () => {
  it('maps pyodide → ENG local, RUN browser, no PATH', () => {
    const h = deriveHud({
      engineId: 'pyodide',
      endpoint: 'http://162.254.38.194:5002',
      modeRaw: 'interpret',
    });
    expect(h.eng).toBe('local');
    expect(h.run).toBe('browser');
    expect(h.mode).toBe('interpret');
    expect(h.showPath).toBe(false);
    expect(h.product.toLowerCase()).toContain('pyodide');
  });

  it('maps server + loopback → ENG local, RUN server, PATH WS', () => {
    const h = deriveHud({
      engineId: 'server',
      endpoint: 'http://127.0.0.1:5002',
      modeRaw: 'compile',
      preferWs: true,
      engineTransport: 'ws',
    });
    expect(h.eng).toBe('local');
    expect(h.run).toBe('server');
    expect(h.mode).toBe('compile');
    expect(h.showPath).toBe(true);
    expect(h.path).toBe('WS');
  });

  it('maps server + VPS IP → ENG remote, RUN server', () => {
    const h = deriveHud({
      engineId: 'server',
      endpoint: 'http://162.254.38.194:5002',
      modeRaw: 'auto',
      preferWs: false,
    });
    expect(h.eng).toBe('remote');
    expect(h.run).toBe('server');
    expect(h.path).toBe('REST');
  });

  it('maps workers.dev endpoint → RUN worker, ENG remote', () => {
    const h = deriveHud({
      engineId: 'server',
      endpoint: 'https://pyne-worker.cryptolinx.workers.dev',
      modeRaw: 'auto',
      engineTransport: 'rest',
    });
    expect(h.eng).toBe('remote');
    expect(h.run).toBe('worker');
    expect(h.showPath).toBe(true);
    expect(h.path).toBe('REST');
  });

  it('flags pyodide loading from telemetry detail', () => {
    const h = deriveHud({
      engineId: 'pyodide',
      endpoint: '',
      engineState: 'connecting',
      detail: 'cold load ~20–30s',
    });
    expect(h.loading).toBe(true);
  });
});
