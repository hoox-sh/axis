// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { createLiveResumeStub } from './resume';

describe('createLiveResumeStub', () => {
  test('logs, marks degraded, and remints', async () => {
    const lines: string[] = [];
    const degraded: string[] = [];
    let remints = 0;
    const stub = createLiveResumeStub({
      output: { appendLine: (l) => lines.push(l) },
      markDegraded: (r) => degraded.push(r),
      remint: async () => {
        remints += 1;
      },
    });

    const r = await stub.resume('seq-gap', 'delta seq=5 lastSeq=2');
    expect(r).toEqual({ ok: true, reminted: true, reason: 'seq-gap' });
    expect(remints).toBe(1);
    expect(degraded).toEqual(['seq-gap']);
    expect(lines.some((l) => l.includes('live resume stub: seq-gap'))).toBe(true);
    expect(lines.some((l) => l.includes('remint ok'))).toBe(true);
  });

  test('skips remint when disabled; remint failure still ok', async () => {
    const lines: string[] = [];
    const noRemint = createLiveResumeStub({
      output: { appendLine: (l) => lines.push(l) },
      remintOnResume: false,
      remint: async () => {
        throw new Error('should not run');
      },
    });
    const r1 = await noRemint.resume('request-reload');
    expect(r1.reminted).toBe(false);

    const failing = createLiveResumeStub({
      output: {
        appendLine: () => {
          throw new Error('log boom');
        },
      },
      markDegraded: () => {
        throw new Error('degrade boom');
      },
      remint: async () => {
        throw new Error(`pn_${'ab'.repeat(24)} leaked`);
      },
    });
    const r2 = await failing.resume('unsafe-delta');
    expect(r2.ok).toBe(true);
    expect(r2.reminted).toBe(false);
  });

  test('dedupes overlapping resume calls', async () => {
    let remints = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stub = createLiveResumeStub({
      remint: async () => {
        remints += 1;
        await gate;
      },
    });

    const p1 = stub.resume('seq-gap');
    expect(stub.isResuming()).toBe(true);
    const p2 = stub.resume('request-reload');
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(remints).toBe(1);
    expect(a.reminted).toBe(true);
    expect(b.reminted).toBe(true);
    expect(stub.isResuming()).toBe(false);
  });
});
