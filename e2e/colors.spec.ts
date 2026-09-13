/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor color tools — one working color, formats stay in sync with the picker.
 *
 * Standalone (not in smoke.spec) so Vite source modules whose path contains
 * "run" are not swallowed by the smoke route mock.
 */
import { test, expect } from '@playwright/test';

test('Color tools uses one working color (formats match the picker) @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('axis-topbar')).toBeVisible({ timeout: 30_000 });
  const editorBtn = page.getByTestId('axis-btn-editor');
  await expect(editorBtn).toBeVisible();
  if ((await editorBtn.getAttribute('aria-pressed')) !== 'true') {
    await editorBtn.click();
  }
  await expect(page.getByTestId('axis-editor')).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByTestId('axis-editor-colors-toggle');
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.click();
  const panel = page.getByTestId('axis-editor-colors');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('axis-editor-color-chips')).toBeVisible();
  const input = page.getByTestId('axis-editor-color-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(/^#[0-9A-Fa-f]{6}$/);
  const formats = page.getByTestId('axis-editor-color-converter');
  await expect(formats).toBeVisible();
  await expect(formats).not.toContainText('Unrecognized');
  const hex = (await input.inputValue()).toUpperCase();
  await expect(formats.locator('code').first()).toContainText(hex);
  const chips = page.getByTestId('axis-editor-color-chips').locator('button');
  if ((await chips.count()) > 1) {
    await chips.nth(1).click();
    await expect(input).not.toHaveValue(new RegExp(`^${hex}$`, 'i'));
    const next = (await input.inputValue()).toUpperCase();
    await expect(formats.locator('code').first()).toContainText(next);
  }
  await expect(page.getByTestId('axis-editor-color-apply')).toBeEnabled();
  await expect(page.getByTestId('axis-editor-color-preview')).not.toHaveText(/^\s*$/);
});
