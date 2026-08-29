/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Per-panel header icon invariants — the same glyph must appear next to the
 * hamburger menu in {@link FloatableShell} as on the Topbar toggle button.
 *
 * The mapping is centralized in {@link PANEL_ICON} (PanelId → IconName) and
 * rendered via `Icons[PANEL_ICON[panelId]]`. FloatableShell renders the icon
 * inside a `<span data-testid="axis-panel-header-icon-{panelId}">`.
 *
 * Companion coverage lives in `tests/icons-map.test.ts` (PANEL_ICON covers
 * every PanelId + each entry resolves to ICON_MAP). This file locks in the
 * runtime + rendering surface so a refactor that drops either side is caught.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ICON_MAP, PANEL_ICON } from '../src/ui/icon-map';
import { PANEL_IDS } from '../src/ui/panels/panel-manager';

const ROOT = resolve(__dirname, '..');
const floatableShellSrc = readFileSync(
  resolve(ROOT, 'src/ui/panels/FloatableShell.tsx'),
  'utf8',
);
const iconsModuleSrc = readFileSync(resolve(ROOT, 'src/ui/icons.tsx'), 'utf8');

describe('panel header icon — mapping completeness', () => {
  it('PANEL_ICON has exactly 12 entries, one per PanelId', () => {
    expect(PANEL_IDS.length).toBe(12);
    expect(Object.keys(PANEL_ICON).length).toBe(PANEL_IDS.length);
  });

  it('every PANEL_ID has an icon mapped in PANEL_ICON', () => {
    for (const id of PANEL_IDS) {
      expect(PANEL_ICON[id]).toBeTruthy();
    }
  });

  it('for every PanelId, Icons[PANEL_ICON[panelId]] is wired to a real Solid component', () => {
    // Avoid importing `Icons` from `ui/icons.tsx` at runtime — that module
    // transitively pulls in lucide-solid, which is heavy and not strictly
    // necessary for this assertion. We instead verify the source of truth:
    // every ICON_MAP key used by PANEL_ICON is also defined on the runtime
    // `Icons` export in `icons.tsx`. This catches drift between the data
    // layer (icon-map.ts) and the component layer (icons.tsx).
    for (const id of PANEL_IDS) {
      const key = PANEL_ICON[id];
      // ICON_MAP must contain the key
      expect((ICON_MAP as Record<string, string>)[key]).toBeTruthy();
      // And icons.tsx must export a `withDefaults`ed component for it
      const exportPattern = new RegExp(`\\b${key}\\s*:\\s*withDefaults\\(`);
      expect(iconsModuleSrc).toMatch(exportPattern);
    }
  });

  it('PANEL_ICON values are valid IconName keys', () => {
    const iconNames = new Set(Object.keys(ICON_MAP));
    for (const id of PANEL_IDS) {
      expect(iconNames.has(PANEL_ICON[id])).toBe(true);
    }
  });
});

describe('panel header icon — FloatableShell render wiring', () => {
  it('FloatableShell reads PANEL_ICON[props.id] to resolve the per-panel icon', () => {
    // The PanelHeaderIcon accessor should resolve via PANEL_ICON[id].
    expect(floatableShellSrc).toMatch(/PANEL_ICON\[props\.id\]/);
  });

  it('FloatableShell emits a data-testid of the form axis-panel-header-icon-{panelId}', () => {
    expect(floatableShellSrc).toContain('data-testid={`axis-panel-header-icon-${props.id}`}');
  });

  it('FloatableShell wraps the icon in a Show keyed on the resolved component', () => {
    // <Show when={PanelHeaderIcon()} keyed> — only render when mapping resolves.
    expect(floatableShellSrc).toMatch(/<Show when=\{PanelHeaderIcon\(\)\}\s+keyed>/);
  });

  it('FloatableShell imports PANEL_ICON alongside Icons (single source of truth)', () => {
    expect(floatableShellSrc).toMatch(
      /import\s*\{[^}]*PANEL_ICON[^}]*\}\s*from\s*['"]\.\.\/icons['"]/,
    );
  });
});
