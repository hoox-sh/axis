# Status bar v2 — Chief state (2026-11-09)

## Done so far (keep)
- Hover/pin cards removed; click/keyboard Popover only (`fc98e001`, Checker Done).
- CSS metric glyphs + reduced-motion.
- Settings: `telemetry.hud.compact`, `telemetry.hud.diagnostics`.
- Related Done: P1 Last/Live truth; earlier scanline click card.

## User correction (Image #1) — implemented
Collapsed (`compact` true, default) = **classic full scanline**:
Live · Last · Diagnostics · Compose · Server · status message · bars/dataset/scripts/panes
— not Live+Last only.

## Opened / expanded — implemented
Measured metrics: run latency samples / lastRunMs, tick→paint p50/p95/worst,
network path, eng/src/str/sto plane states (`paint-latency` + store telemetry).

## Decision locked
Collapsed = classic scanline (Image #1) + needed polish.
Expanded = latency / network / app performance instruments.

## Engineering proof
`.openorchestrate/proof/statusbar-v2.md` + classic/expanded screenshots.
