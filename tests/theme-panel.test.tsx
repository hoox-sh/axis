/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ThemePanel mount: preset pressed state, override count, labeled color and
 * switch tokens, and the reset control. Uses the mini DOM — no testing-library.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { installMiniDom, type MiniElement } from './helpers/mini-dom';

installMiniDom();

// Client solid so createUniqueId / For work. The preloaded web runtime stays
// on the server build; this alias only affects modules imported below.
const solid = await import('solid-js/dist/dev.js');
mock.module('solid-js', () => solid);

const { render } = await import('solid-js/web');
const { ThemePanel } = await import('../src/ui/ThemePanel');
const { resetChartTheme, setChartThemeToken } = await import('../src/store');

function text(el: MiniElement | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <ThemePanel />, host);
  return {
    host: host as MiniElement,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

describe('ThemePanel', () => {
  beforeEach(() => {
    resetChartTheme();
  });

  it('marks the active preset pressed and hides the override count', () => {
    const view = mount();
    const pressed = view.host.querySelectorAll('button[aria-pressed="true"]');
    expect(pressed.length).toBe(1);
    expect(text(pressed[0] ?? null)).toBe('AXIS Void');
    expect(text(view.host.querySelector('[data-testid="axis-theme-active-preset"]'))).toBe(
      'AXIS Void',
    );
    expect(view.host.querySelector('[data-testid="axis-theme-override-count"]')).toBeNull();
    expect(view.host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Chart theme presets',
    );
    view.dispose();
  });

  it('shows the override count after a token edit', () => {
    setChartThemeToken('chart.bg_color', '#112233');
    const view = mount();
    const count = view.host.querySelector('[data-testid="axis-theme-override-count"]');
    expect(count).not.toBeNull();
    expect(text(count)).toMatch(/^\d+ overrides?$/);
    expect(text(view.host.querySelector('[data-testid="axis-theme-active-preset"]'))).toBe(
      'Custom',
    );
    const pressed = view.host.querySelectorAll('button[aria-pressed="true"]');
    expect(pressed.some((b) => text(b) === 'Custom')).toBe(true);
    view.dispose();
  });

  it('labels a color token and a switch, and exposes reset', () => {
    const view = mount();
    const color = view.host.querySelector('[data-testid="axis-theme-token-chart-bg_color"]');
    if (!color) throw new Error('missing background color token');
    const colorLabel = color.querySelector('label');
    const colorInput = color.querySelector('input[type="text"]');
    expect(text(colorLabel)).toBe('Background');
    expect(colorLabel?.getAttribute('for')).toBeTruthy();
    expect(colorInput?.id).toBe(colorLabel?.getAttribute('for'));
    expect(color.querySelector('input[type="color"]')?.getAttribute('aria-label')).toBe(
      'Color picker',
    );

    const toggle = view.host.querySelector('[data-testid="axis-theme-token-bar-body_fill"]');
    if (!toggle) throw new Error('missing body fill switch');
    expect(text(toggle.querySelector('label'))).toContain('Body fill');
    expect(toggle.querySelector('input[type="checkbox"]')).not.toBeNull();

    expect(view.host.querySelector('[data-testid="axis-theme-reset"]')).not.toBeNull();
    view.dispose();
  });
});
