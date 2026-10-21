/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  hpGpuMode,
  hpSabMode,
  isHpDisabled,
  isHpEnabled,
  resetHpFlags,
  setHpDisabled,
  setHpEnabled,
  setHpGpuMode,
  setHpSabMode,
} from '../../src/hp/feature-flag';

afterEach(() => {
  resetHpFlags();
});

describe('HP feature flags', () => {
  test('default is off; enable is opt-in; kill switch wins', () => {
    expect(isHpEnabled()).toBe(false);
    expect(isHpDisabled()).toBe(false);
    setHpEnabled(true);
    expect(isHpEnabled()).toBe(true);
    setHpDisabled(true);
    expect(isHpEnabled()).toBe(false);
    expect(isHpDisabled()).toBe(true);
  });

  test('gpu and sab modes validate', () => {
    expect(hpGpuMode()).toBe('auto');
    expect(hpSabMode()).toBe('auto');
    setHpGpuMode('webgl2');
    setHpSabMode('off');
    expect(hpGpuMode()).toBe('webgl2');
    expect(hpSabMode()).toBe('off');
    setHpGpuMode('auto');
    setHpSabMode('auto');
    expect(hpGpuMode()).toBe('auto');
    expect(hpSabMode()).toBe('auto');
  });
});
