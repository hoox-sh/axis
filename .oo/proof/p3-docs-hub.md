# P3: Docs hub 2.28.0 + PYNE version + glossary — proof

Date: 2026-11-09
Seat: oo-spec-1 (draft)

```text
from: oo-spec-1
to: oo-chief
objective: Hub versions, PYNE vendor truth, first-run copy, glossary, Chart type & scale docs. UI gear rename left to Engineering.
artifacts:
  - docs/index.mdx
  - docs/enduser/getting-started/quick-start.mdx
  - docs/enduser/getting-started/installation.mdx
  - docs/enduser/getting-started/compose-recipes.mdx
  - docs/enduser/index.mdx
  - docs/enduser/reference/glossary.mdx
  - docs/enduser/reference/faq.mdx
  - docs/enduser/guides/manager-and-settings.mdx
  - docs/ui/charting.mdx
  - docs/ui/ui-shell.mdx
  - docs/llm.txt
  - CHANGELOG.md [Unreleased]
  - .openorchestrate/proof/p3-docs-hub.md
decisions:
  - Cite AXIS 2.28.0 from VERSION / package.json (not invented).
  - Cite PYNE 0.6.29 from vendor/pynescript-0.6.29-py3-none-any.whl + src/engines/catalog.ts (not marketing 0.6.29-vs-PyPI 0.6.33 as ship).
  - First-run is boot candles + Add to chart / Run. Topbar Load remains a refetch, not the first-run step.
  - Docs-only: did not rename src/ UI "Chart settings" (domain + checklist [4]).
open questions:
  - Published hoox.sh/axis/docs is copied in sibling hoox-landing-page (content/axis-docs/index.mdx still 2.24.5; AXIS_WHATS_NEW tags 2.24.5). Do not rewrite marketing value-prop; Chief ships the copy.
  - In-app gear / context menu / palette still say "Chart settings" (src/chart/context-menu.ts, ChartScaleControls.tsx, ChartSettingsPanel.tsx, command-registry.ts).
next gate: Chief approves draft. Checker greps. Engineering rename Chart type & scale if wanted.
```

## Sources

| Claim | Source |
| --- | --- |
| AXIS 2.28.0 | `VERSION`, `package.json` `version`, `public/version.json` |
| PYNE wheel 0.6.29 | `vendor/pynescript-0.6.29-py3-none-any.whl`, `public/vendor/…`, `src/engines/catalog.ts:881` |
| First-run Run / Add to chart | `src/ui/RunSplitButton.tsx`, `src/ui/FirstRunHint.tsx`, P2 card proof |
| Chart panel scope | `src/ui/ChartSettingsPanel.tsx` (type, interval, log/auto, labels) |
| App Settings discovery | `docs/enduser/guides/manager-and-settings.mdx` Studio → Settings / ⌘K |

## Verify

```text
# 2026-11-09, repo /mnt/data/home/jango/Git/hoox-open-trading-stack/axis
cat VERSION                                          # 2.28.0
python3 -c 'import json; print(json.load(open("package.json"))["version"])'  # 2.28.0
ls vendor/pynescript-*.whl                           # pynescript-0.6.29-py3-none-any.whl
rg -n '2\.24\.5' docs --glob '*.mdx'                 # (empty)
rg -n 'Click \*\*Load\*\*|Click Load' docs --glob '*.mdx'  # (empty)
rg -n '2\.28\.0|0\.6\.29' docs/index.mdx             # hub claims
```

MDX leftover **2.24.5**: none.

MDX leftover **Click Load** as first-run: none.

CHANGELOG leftover 2.24.5: historical `[2.24.5]` section and git-history lines only.

Sibling `hoox-landing-page` still serves 2.24.5 on the published hub (out of this repo's docs tree).

## Checklist

```text
[1] the artifact exists at the stated path — pass
[2] the change was verified with a command, screenshot, or before/after numbers — pass (rg + VERSION + wheel ls)
[3] every claim has a source — pass
[4] nothing outside docs was touched — pass (docs/ + CHANGELOG Unreleased + this proof + board card)
```
