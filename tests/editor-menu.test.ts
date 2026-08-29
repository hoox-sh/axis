/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor panel menu invariants after the duplicate-`New tab` cleanup.
 *
 * The {@link EditorPane} used to push a `menuExtra` with an "Open in new tab"
 * entry into the FloatableShell dock menu — on top of the generic
 * `DOCK_MENU` "New tab" entry, producing a duplicate. The fix removes the
 * `menuExtra` so the dock menu only shows the generic "New tab" entry once,
 * while the EditorOverflowMenu (right-side overflow, separate DOM region)
 * still exposes the "Open in new tab" affordance via `axis-editor-btn-new-tab-overflow`.
 *
 * These tests are static source assertions rather than DOM render checks
 * because the repo has no `@solidjs/testing-library` and the FloatableShell
 * is too store-coupled to mount cheaply in unit tests. Source-level checks
 * are sufficient to lock in the regression-prone bits.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const editorPaneSrc = readFileSync(resolve(ROOT, 'src/editor/EditorPane.tsx'), 'utf8');
const floatableShellSrc = readFileSync(
  resolve(ROOT, 'src/ui/panels/FloatableShell.tsx'),
  'utf8',
);

describe('editor panel menu — duplicate New tab removal', () => {
  it('EditorPane does NOT push a menuExtra with a "New tab" entry to FloatableShell', () => {
    // Find the FloatableShell JSX usage inside EditorPane and assert that
    // either menuExtra is omitted OR explicitly set to `undefined`. The
    // duplicate "Open in new tab" button must NOT live inside an
    // axis-editor-btn-new-tab element rendered as menuExtra.
    const floatableUsage = editorPaneSrc.match(
      /<FloatableShell[\s\S]*?<\/FloatableShell>/,
    );
    expect(floatableUsage).not.toBeNull();
    const block = floatableUsage![0];
    // `menuExtra={undefined}` is the chosen shape (per the comment in EditorPane).
    expect(block).toMatch(/menuExtra=\{undefined\}/);
    // The old `axis-editor-btn-new-tab` (menuExtra version) must be gone —
    // we only keep `axis-editor-btn-new-tab-overflow` in the overflow menu.
    expect(editorPaneSrc).not.toMatch(/data-testid="axis-editor-btn-new-tab"/);
  });

  it('EditorOverflowMenu still renders the "Open in new tab" entry with the overflow testid', () => {
    expect(editorPaneSrc).toContain('data-testid="axis-editor-btn-new-tab-overflow"');
    expect(editorPaneSrc).toContain('>Open in new tab<');
  });

  it('FloatableShell generic dock menu still contains exactly one "New tab" entry', () => {
    // The DOCK_MENU constant in FloatableShell is the single source of
    // truth for "New tab" inside the panel header dropdown.
    expect(floatableShellSrc).toMatch(/dock:\s*'window'[\s\S]{0,40}label:\s*'New tab'/);
    // Confirm the DOCK_MENU is rendered via <For each={DOCK_MENU}>
    expect(floatableShellSrc).toContain('<For each={DOCK_MENU}>');
  });

  it('FloatableShell renders the menuExtra slot only when truthy (no orphan slot)', () => {
    // <Show when={props.menuExtra}>{props.menuExtra}</Show> — required so
    // an undefined menuExtra doesn't render an empty wrapper.
    expect(floatableShellSrc).toMatch(/<Show when=\{props\.menuExtra\}>/);
  });
});
