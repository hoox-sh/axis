/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ensureApplyPane,
  releaseIndicatorPane,
  reserveIndicatorPane,
} from '../src/indicators/apply-pane';
import { setStore, store } from '../src/store';

describe('in-flight indicator panes', () => {
  beforeEach(() => {
    releaseIndicatorPane('ind_rsi');
    setStore('scripts', []);
    setStore('panes', [
      { id: 'price', type: 'price', height: 400, order: 0, visible: true },
      { id: 'ind_rsi', type: 'indicator', height: 140, order: 1, visible: true, label: 'RSI' },
    ]);
  });

  it('does not destroy a pane whose script has not been stored yet', () => {
    const destroyed: string[] = [];
    const panes = new Map<string, { id: string; type: string }>([
      ['price', { id: 'price', type: 'price' }],
      ['ind_rsi', { id: 'ind_rsi', type: 'indicator' }],
    ]);
    reserveIndicatorPane('ind_rsi');
    const manager = {
      getPane: (id: string) => panes.get(id),
      createPane: (id: string, type: string) => {
        panes.set(id, { id, type });
      },
      getAllPanes: () => [...panes.values()],
      destroyPane: (id: string) => {
        destroyed.push(id);
        panes.delete(id);
      },
      syncTimeScales: () => {},
      setVisible: () => {},
      setLabel: () => {},
      removeOverlaysForOwner: () => {},
    };
    ensureApplyPane({
      overlay: false,
      existing: undefined,
      indicatorId: 'vol',
      scriptName: 'Volume',
      manager: manager as never,
      storePanes: store.panes,
      storeScripts: store.scripts,
    });
    expect(destroyed).not.toContain('ind_rsi');
    expect(panes.has('ind_rsi')).toBe(true);
    releaseIndicatorPane('ind_rsi');
  });
});
