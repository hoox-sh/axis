/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Void-theme-adjacent palette for the AXIS CLI (indigo accent).
 */

import ansis from "ansis";

export const theme = {
  heading: (s: string) => ansis.hex("#A78BFA").bold(s),
  bold: (s: string) => ansis.bold(s),
  dim: (s: string) => ansis.hex("#71717a")(s),
  success: (s: string) => ansis.hex("#34d399")(s),
  warn: (s: string) => ansis.hex("#fbbf24")(s),
  error: (s: string) => ansis.hex("#fb7185")(s),
  info: (s: string) => ansis.hex("#38bdf8")(s),
  accent: (s: string) => ansis.hex("#818cf8")(s),
  label: (s: string) => ansis.hex("#a1a1aa")(s),
};

export const icons = {
  ok: "✓",
  fail: "✗",
  warn: "!",
  info: "·",
  arrow: "→",
};
