/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { HPO_PLUGIN_ID } from '../src/plugins/hpo';
import { detectScriptKind } from '../src/indicators/script-meta';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
});

describe('HPO plugin', () => {
  it('registers as a built-in component', () => {
    ensureBuiltins();
    const p = registry.getComponent(HPO_PLUGIN_ID);
    expect(p?.kind).toBe('component');
    expect(p?.builtIn).toBe(true);
    expect(p?.slots).toContain('results-tab');
  });

  it('strategy gate matches detectScriptKind', () => {
    expect(detectScriptKind('//@version=6\nstrategy("s")\nplot(close)')).toBe('strategy');
    expect(detectScriptKind('//@version=6\nindicator("i")\nplot(close)')).toBe('indicator');
  });
});
