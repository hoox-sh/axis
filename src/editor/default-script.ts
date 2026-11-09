// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-open editor buffer. Oscillators use overlay=false so RSI is not
 * painted on the price pane at 0–100.
 *
 * @module editor/default-script
 */

/** Pine v6 RSI — the buffer a first visit sees in the editor. */
export const DEFAULT_EDITOR_SCRIPT = `//@version=6
indicator("RSI", overlay = false)
len = input.int(14, "Length", minval = 1)
rsi = ta.rsi(close, len)
plot(rsi, "RSI", color = color.purple)
hline(70, "Overbought", color = color.red)
hline(30, "Oversold", color = color.green)
`;
