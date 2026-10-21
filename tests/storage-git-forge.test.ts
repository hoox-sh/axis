// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The git storage backend, split into a provider half and a shared half.
 *
 * GitHub and GitLab were two near-identical files — twelve of their functions
 * had the same body — and the dispatch picked between them with nine
 * ternaries. The provider-specific parts now live behind a `GitForge`, and the
 * shared operations live in one place.
 */

import { describe, expect, it } from 'bun:test';
import { githubForge } from '../src/storage/git-github';
import { gitlabForge } from '../src/storage/git-gitlab';
import type { GitForge } from '../src/storage/git-forge';

const forges: Array<[string, GitForge]> = [
  ['GitHub', githubForge],
  ['GitLab', gitlabForge],
];

describe('git forges', () => {
  it('both providers implement the same contract', () => {
    for (const [, forge] of forges) {
      expect(typeof forge.label).toBe('string');
      expect(forge.label.length).toBeGreaterThan(0);
      for (const method of [
        'getFile',
        'getFileAtRef',
        'listFileCommits',
        'fileToken',
        'putFile',
        'deleteFile',
        'readIndex',
        'writeIndex',
        'isIndexConflict',
        'status',
      ] as const) {
        expect(typeof forge[method]).toBe('function');
      }
    }
  });

  it('derives the update token from the existing file', () => {
    const file = { content: 'x', sha: 'abc123' };
    for (const [, forge] of forges) {
      // The token shape differs per provider (a sha vs a boolean) but a
      // missing file must always mean "create it".
      expect(forge.fileToken(null)).toBeFalsy();
      expect(forge.fileToken(file)).toBeTruthy();
    }
  });

  it('retries an index conflict per provider policy', () => {
    // GitHub answers 409; GitLab may answer 400/409/422.
    expect(githubForge.isIndexConflict(409)).toBe(true);
    expect(githubForge.isIndexConflict(400)).toBe(false);
    expect(gitlabForge.isIndexConflict(409)).toBe(true);
    expect(gitlabForge.isIndexConflict(422)).toBe(true);
    expect(gitlabForge.isIndexConflict(500)).toBe(false);
    expect(gitlabForge.isIndexConflict(undefined)).toBe(false);
  });
});
