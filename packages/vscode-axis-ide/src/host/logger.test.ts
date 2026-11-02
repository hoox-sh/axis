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

import { afterEach, describe, expect, test } from 'bun:test';
import {
  isDebugProtocol,
  logDebug,
  logError,
  logInfo,
  logProtocolReject,
  logWarn,
  resetLoggerForTests,
  setDebugProtocol,
  setLogSink,
} from './logger';

afterEach(() => {
  resetLoggerForTests();
});

describe('host logger', () => {
  test('routes levels through injectable sink', () => {
    const lines: string[] = [];
    setLogSink((level, message) => {
      lines.push(`${level}:${message}`);
    });
    logInfo('i');
    logWarn('w');
    logError('e');
    expect(lines).toEqual(['info:i', 'warn:w', 'error:e']);
  });

  test('debug lines only when axis.debug.protocol gate is on', () => {
    const lines: string[] = [];
    setLogSink((_level, message) => {
      lines.push(message);
    });
    logDebug('hidden');
    expect(lines).toEqual([]);
    setDebugProtocol(true);
    expect(isDebugProtocol()).toBe(true);
    logDebug('shown');
    expect(lines).toEqual(['shown']);
  });

  test('logProtocolReject uses debug sink when gated, else warn', () => {
    const lines: Array<{ level: string; message: string }> = [];
    setLogSink((level, message) => {
      lines.push({ level, message });
    });
    logProtocolReject({ code: 'UNKNOWN_TYPE', message: 'nope' }, 'chart.x');
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.message).toContain('UNKNOWN_TYPE');
    expect(lines[0]?.message).toContain('chart.x');

    lines.length = 0;
    setDebugProtocol(true);
    logProtocolReject({ code: 'BAD_VERSION', message: 'v' });
    expect(lines[0]?.level).toBe('debug');
    expect(lines[0]?.message).toContain('BAD_VERSION');
  });

  test('default sink restores after null without console noise', () => {
    const logs: string[] = [];
    const warns: string[] = [];
    const errors: string[] = [];
    const logSpy = (...args: unknown[]) => {
      logs.push(String(args[0]));
    };
    const warnSpy = (...args: unknown[]) => {
      warns.push(String(args[0]));
    };
    const errorSpy = (...args: unknown[]) => {
      errors.push(String(args[0]));
    };
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = logSpy as typeof console.log;
    console.warn = warnSpy as typeof console.warn;
    console.error = errorSpy as typeof console.error;
    try {
      setLogSink(null);
      expect(() => logInfo('restore')).not.toThrow();
      expect(() => logWarn('restore')).not.toThrow();
      expect(() => logError('restore')).not.toThrow();
      setDebugProtocol(true);
      expect(() => logDebug('restore-debug')).not.toThrow();
      expect(logs.some((l) => l.includes('[axis] restore'))).toBe(true);
      expect(warns.some((l) => l.includes('[axis] restore'))).toBe(true);
      expect(errors.some((l) => l.includes('[axis] restore'))).toBe(true);
      expect(logs.some((l) => l.includes('restore-debug'))).toBe(true);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  });
});
