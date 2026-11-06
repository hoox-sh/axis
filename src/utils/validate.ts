/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Runtime validators for data that crosses a trust boundary.
 *
 * TypeScript types vanish at runtime, so `(await res.json()) as Foo` is a
 * promise the network is free to break. Every helper here takes `unknown` and
 * returns a *checked* value, so callers never read a field off `null`, a
 * string, or an array.
 *
 * ## Contract
 * - Validators never throw. They return `false`/`null`/`{}` and let the caller
 *   choose between "degrade" and "fail loudly".
 * - {@link readJsonRecord} is the defensive default for endpoints whose body
 *   the caller only probes field-by-field: a non-object body becomes `{}`, so
 *   the existing optional reads behave exactly as they do for an empty reply.
 * - {@link readJsonUnknown} preserves the raw JSON value (including `null`)
 *   for callers that need to distinguish "no body" from "empty object".
 *
 * @module utils/validate
 */

/**
 * Narrow an `unknown` to a plain object.
 *
 * Arrays and `null` are rejected: callers almost always want a JSON object,
 * and `Array.isArray` is checked explicitly where a list is expected.
 *
 * @param value Any runtime value.
 * @returns `true` when `value` is a non-null, non-array object.
 *
 * @example
 * const body = await res.json();
 * if (!isRecord(body)) return null;
 * const ticket = body['ticket'];
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a response body as JSON and coerce it to an object.
 *
 * A body that is not valid JSON, is `null`, or is an array yields `{}`. That
 * matches the previous `as Record<string, unknown>` casts followed by optional
 * field reads, but without the `TypeError` those casts allowed.
 *
 * @param res Response whose body is expected to be a JSON object.
 * @returns The parsed object, or `{}` when the body is absent or not an object.
 * @throws Never — parse failures are folded into the empty-object result.
 */
export async function readJsonRecord(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await res.json();
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read a response body as JSON without assuming its shape.
 *
 * @param res Response whose body may be any JSON value.
 * @returns The parsed value, or `null` when the body is missing or not JSON.
 * @throws Never.
 */
export async function readJsonUnknown(res: Response): Promise<unknown> {
  try {
    const parsed: unknown = await res.json();
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Coerce an unknown value to a finite number.
 *
 * Numbers pass through when finite; non-empty strings are parsed with
 * `Number()`. Everything else (booleans, objects, empty/whitespace strings,
 * `NaN`, `Infinity`) yields `null`. This is the permissive variant used by
 * engine-result normalisation — stricter parsers that also reject `"na"`
 * live next to their consumers.
 *
 * @param value Any runtime value.
 * @returns The finite number, or `null` when the value is not numeric.
 */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Read a numeric field from a record.
 *
 * @param record Source object (usually a validated JSON body).
 * @param key Field name to read.
 * @returns The finite number, or `null` when the field is missing or not finite.
 */
export function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read a string field from a record.
 *
 * @param record Source object.
 * @param key Field name to read.
 * @returns The string, or `null` when the field is missing or not a string.
 */
export function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}
