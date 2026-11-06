/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * TTY prompts. Secrets are not echoed.
 */

import { createInterface } from 'node:readline';

/**
 * Reads a secret from the terminal without echoing it.
 *
 * Returns an empty string instead of blocking when stdin or stderr is not a TTY,
 * so piped/CI runs fail fast rather than hang. Echo is disabled via raw mode where
 * available; the prompt itself goes to stderr so stdout stays clean.
 *
 * @param label - Prompt text written to stderr before reading.
 * @returns The typed value, or `""` when not attached to a TTY.
 * @throws {Error} `cancelled` when the user presses Ctrl-C.
 */
export async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return '';
  process.stderr.write(label);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const raw = typeof stdin.setRawMode === 'function';
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (ok: boolean, err?: Error) => {
      stdin.off('data', onData);
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      if (!ok) reject(err ?? new Error('cancelled'));
      else resolve(value);
    };
    const onData = (chunk: string | Buffer) => {
      const s = String(chunk);
      if (s === '\u0003') {
        done(false, new Error('cancelled'));
        return;
      }
      if (s === '\n' || s === '\r' || s === '\u0004') {
        done(true);
        return;
      }
      if (s === '\u007f' || s === '\b') {
        value = value.slice(0, -1);
        return;
      }
      if (s.length === 1 && s.charCodeAt(0) < 32) return;
      value += s;
    };
    stdin.on('data', onData);
  });
}

/**
 * Reads one visible line from the terminal.
 *
 * Returns an empty string when stdin is not a TTY, matching {@link promptSecret},
 * so callers can treat `""` as "not interactive" without a separate check.
 *
 * @param label - Prompt text; written to stderr to keep stdout parseable.
 * @returns The trimmed-by-user answer, or `""` when not attached to a TTY.
 */
export async function promptLine(label: string): Promise<string> {
  if (!process.stdin.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise((resolve) => {
      rl.question(label, (answer) => resolve(answer));
    });
  } finally {
    rl.close();
  }
}
