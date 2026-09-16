/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  openScriptSourceInEditor,
  subscribeOpenScriptSource,
} from '../src/editor/open-script-source';
import { setEditorOpen, store } from '../src/store';

describe('openScriptSourceInEditor', () => {
  it('delivers immediately when a subscriber is already mounted', () => {
    const seen: string[] = [];
    const unsub = subscribeOpenScriptSource((d) => seen.push(`${d.name}:${d.code}`));
    try {
      openScriptSourceInEditor('plot(close)', 'RSI');
      expect(seen).toEqual(['RSI:plot(close)']);
      expect(store.editor.open).toBe(true);
      expect(store.editor.mode).toBe('docked');
    } finally {
      unsub();
    }
  });

  it('queues until TabbedEditor subscribes (lazy editor)', async () => {
    const seen: string[] = [];
    openScriptSourceInEditor('indicator("X")\nplot(close)', 'MACD');
    expect(seen).toEqual([]);
    const unsub = subscribeOpenScriptSource((d) => seen.push(d.name));
    try {
      await Promise.resolve();
      expect(seen).toEqual(['MACD']);
    } finally {
      unsub();
    }
  });

  it('rejects empty source', () => {
    openScriptSourceInEditor('   ', 'Empty');
    expect(store.status).toBe('error');
  });

  it('reopens a popout editor as docked', () => {
    setEditorOpen(false);
    const unsub = subscribeOpenScriptSource(() => {});
    try {
      openScriptSourceInEditor('plot(1)', 'SMA');
      expect(store.editor.open).toBe(true);
      expect(store.editor.mode).toBe('docked');
    } finally {
      unsub();
    }
  });
});
