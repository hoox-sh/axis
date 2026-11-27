# Data Manager summary gutter

## Root cause

The studio Data summary is pinned above the tabs, as a direct child of `.ax-page-stack`, outside `.ax-page-canvas`. Header, tabs, and canvas all inset with `--ax-canvas-pad` (`clamp(1.5rem, 3vw, 3.25rem)`). The summary section had no horizontal padding, so its title, lead, stat cards, and New job control sat on the rail edge.

The float Data Source Manager uses `.ax-dsm-summary` inside the panel shell. That rule was not changed.

## Before (user screenshot)

File: session asset `image-f0af16ce-eebb-4d01-b050-c1a4e4d267f4.png` (1901×532). Main column starts at x=172.

| Element                           | Left edge                                  |
| --------------------------------- | ------------------------------------------ |
| Page purpose text (header gutter) | x=216                                      |
| Summary lead ("Live counters…")   | x=174                                      |
| Stat-card border                  | x=172 to x≈1893 (right edge of the window) |
| Dataset inventory / filter        | x=216                                      |

Summary was about 42px left of the page gutter and flush on the right. 42px matches `--ax-canvas-pad` at this width (3vw, clamped).

## After (computed style)

Headless Chromium loaded `src/ui/studio/studio.css` with a bare section (old structure), `.ax-page-band` (new), `.ax-tabs`, and `.ax-page-canvas`.

| Viewport            | Bare section | Band            | Tabs            | Canvas          |
| ------------------- | ------------ | --------------- | --------------- | --------------- |
| 1440px              | 0 / 0        | 43.2px / 43.2px | 43.2px / 43.2px | 43.2px / 43.2px |
| 800px (under 52rem) | 0 / 0        | 20px / 20px     | 20px / 20px     | 20px / 20px     |

Content left of the summary inside the band matched the tabs and the canvas (43px at 1440, 20px at 800). 800px is the narrow override (`1.25rem`), not a one-off.

## Test

`bun test --isolate tests/dsm-summary-margin.test.ts` — 3 pass, 0 fail, 18 expect() calls, exit 0.

Pins: summary `testId="axis-data-summary"` is inside `.ax-page-band` and not inside `.ax-page-canvas`; `.ax-page-band` padding is `var(--ax-canvas-pad)` on both sides; the `max-width: 52rem` block that pads `.ax-page-canvas` also pads `.ax-page-band` to `1.25rem`; `.ax-dsm-summary` and `DataSourceManagerPanel.tsx` are unchanged.
