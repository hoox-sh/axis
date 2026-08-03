/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { manualTokenCreateUrl } from '../src/storage/git-oauth';

describe('git-oauth client helpers', () => {
  it('manualTokenCreateUrl points at forge token pages', () => {
    expect(manualTokenCreateUrl('github')).toContain('github.com/settings/tokens');
    expect(manualTokenCreateUrl('github')).toContain('repo');
    expect(manualTokenCreateUrl('gitlab')).toContain('gitlab.com');
    expect(manualTokenCreateUrl('gitlab')).toContain('personal_access_tokens');
  });
});
