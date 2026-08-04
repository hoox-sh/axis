/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * copyToClipboard — secure-context API + execCommand fallback.
 */

import './setup';
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { copyToClipboard } from '../src/ui/clipboard';

describe('copyToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalExec = document.execCommand;

  beforeEach(() => {
    // Reset DOM body
    document.body.innerHTML = '';
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    document.execCommand = originalExec;
  });

  it('returns false for empty text', async () => {
    expect(await copyToClipboard('')).toBe(false);
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = mock(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    // isSecureContext may be true in happy-dom
    const ok = await copyToClipboard('hello line');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello line');
  });

  it('falls back to execCommand when clipboard API throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mock(async () => {
          throw new Error('NotAllowedError');
        }),
      },
      configurable: true,
      writable: true,
    });
    document.execCommand = mock(() => true) as typeof document.execCommand;
    const ok = await copyToClipboard('fallback text');
    expect(ok).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back when clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    document.execCommand = mock(() => true) as typeof document.execCommand;
    const ok = await copyToClipboard('no api');
    expect(ok).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
