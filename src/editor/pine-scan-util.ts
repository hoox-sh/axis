/**
 * Shared char helpers for Pine source scanners (pre-eval, call-site parser,
 * declaration collector). Copy-pasted scripts often carry typographic quotes
 * ("curly" U+2018/U+2019/U+201C/U+201D); treating them as string delimiters
 * keeps their contents from leaking into code scans.
 */
export type QuoteChar = '"' | "'" | '\u2018' | '\u2019' | '\u201c' | '\u201d';

export function isQuoteChar(c: string): boolean {
  return c === '"' || c === "'" || c === '\u2018' || c === '\u2019' || c === '\u201c' || c === '\u201d';
}
