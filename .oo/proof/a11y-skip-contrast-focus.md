# A11y: skip-link, 4.5:1 faint/accent, focus rings

Engineering draft. No commit. Panel fills untouched (theme revert stands).

## Contrast (WCAG relative luminance)

First-paint CSS tokens (`src/index.css`):

| Token | Hex | Surface | Ratio | Old |
| --- | --- | --- | --- | --- |
| dark `--color-text-faint` | `#737b8a` | `#07080c` | **4.70** | `#6b7382` 4.19 |
| dark `--color-text-faint` | `#737b8a` | `#0c0e14` | **4.53** | 4.04 |
| light `--color-text-faint` | `#636b7a` | `#f3f4f8` | **4.88** | `#6b7382` 4.34 |
| light `--color-text-faint` | `#636b7a` | `#eaebf1` | **4.51** | 4.01 |
| light `--color-accent` | `#4a59c4` | `#f3f4f8` | **5.43** | `#5a6ad4` 4.30 |
| light `--color-accent` | `#4a59c4` | `#eaebf1` | **5.02** | 3.97 |
| dark `--color-accent` | `#8b9cff` | `#07080c` | **7.91** | (unchanged) |

`buildChromeCssVars` floors faint, dim, and accent-as-text at `TEXT_CONTRAST_MIN = 4.5` against both `--color-bg-base` and `--color-bg-panel`.

## Skip-link / main

- `index.html`: skip-link `href="#axis-main"` before `#app`; existing noscript kept (SEO card).
- `src/app.tsx`: workspace is `<main id="axis-main" tabindex="-1">`.
- `src/editor/EditorApp.tsx`: editor pane is `<main id="axis-main">`.
- Solid still mounts into `#app`.

## Focus

`:focus-visible { outline: none }` without a ring now has a 2px outline or inset accent box-shadow. Shell-owned inner `--bare` controls still suppress native outline because the shell `:focus-within` ring owns it. `prefers-reduced-motion` unchanged.

## Verify

```text
bun test --isolate tests/a11y-chrome.test.ts tests/theme-manager.test.ts
# 53 pass / 0 fail
```
