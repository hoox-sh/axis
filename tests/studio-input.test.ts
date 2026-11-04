/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Numeric stepper: one native step per click, and the component must not
 * forward the value a second time (stepUp/stepDown dispatch their own events).
 */
import { describe, expect, it } from 'bun:test';
import { stepNativeInput } from '../src/ui/studio/step-input';

function fakeInput(value: string, opts?: { throws?: boolean }) {
  let current = value;
  const calls: string[] = [];
  return {
    calls,
    get value() {
      return current;
    },
    stepUp: () => {
      calls.push('up');
      if (opts?.throws) throw new Error('invalid step');
      current = String(Number(current) + 1);
    },
    stepDown: () => {
      calls.push('down');
      if (opts?.throws) throw new Error('invalid step');
      current = String(Number(current) - 1);
    },
  };
}

describe('stepNativeInput', () => {
  it('steps up / down once and returns the new value', () => {
    const el = fakeInput('2');
    expect(stepNativeInput(el, 1)).toBe('3');
    expect(stepNativeInput(el, -1)).toBe('2');
    expect(el.calls).toEqual(['up', 'down']);
  });

  it('respects the input step', () => {
    const el = fakeInput('1.5');
    el.stepUp = () => {
      el.calls.push('up');
      // simulate step=0.5
    };
    expect(stepNativeInput(el, 1)).toBe('1.5');
    expect(el.calls).toEqual(['up']);
  });

  it('returns null when the element refuses the step', () => {
    expect(stepNativeInput(fakeInput('2', { throws: true }), 1)).toBeNull();
    expect(stepNativeInput(fakeInput('2', { throws: true }), -1)).toBeNull();
  });
});
