# SEO: OG/Twitter, favicon.ico, sitemap; noscript blurb — proof

Date: 2026-11-09
Seat: oo-spec-1 (draft)
No commit.

```text
from: oo-spec-1
to: oo-chief
objective: Close Nov 9 crawler gaps on the AXIS PWA shell (OG/Twitter, real favicon.ico, sitemap + robots Sitemap, noscript blurb). Skip-link left to the a11y card. No SSR of #app.
artifacts:
  - index.html
  - public/favicon.ico
  - public/sitemap.xml
  - public/robots.txt
  - CHANGELOG.md [Unreleased]
  - .openorchestrate/proof/seo-og-favicon-sitemap.md
decisions:
  - og:title / twitter:title = AXIS; og/twitter description copied from the existing name=description meta.
  - og:image / twitter:image = https://axis.hoox.sh/assets/icon-512.png (file exists; twitter:card=summary because the asset is square).
  - favicon.ico is a real ICO (16/32/48) rasterized from public/favicon.svg so crawlers match the HOOX tab mark; SVG rel=icon kept for browsers.
  - sitemap lists only https://axis.hoox.sh/ — product docs are Mintlify at https://hoox.sh/axis/docs, not this Pages origin.
  - noscript blurb + docs link; no skip-link (a11y card). Empty #app SPA left alone.
  - Did not rewrite Worker CSP, docker nginx, or axis-pwa-server (outside docs).
open questions:
  - Live axis.hoox.sh still 404s /favicon.ico and /sitemap.xml until Pages deploy (Chief).
  - Live /robots.txt is Cloudflare Managed content-signals (200), not a 404. Pages public/robots.txt adds Sitemap; zone managed preamble may still prepend.
  - CORP Cross-Origin-Resource-Policy: same-origin on /* and /assets/* may block some social crawlers from fetching og:image. Title/description still work. Header change is the Tech card, not this one.
  - Local axis-pwa-server.ts remaps /favicon.ico → /favicon.svg before the file exists check; docker nginx location = /favicon.ico try_files /assets/icon-192.png. Engineering if we want those paths to serve the new ICO.
next gate: Chief approves draft. Checker greps. Pages ship is a later gate (Ask first before production).
```

## Sources

| Claim | Source |
| --- | --- |
| Existing description | `index.html` `meta name="description"` |
| OG image file | `public/assets/icon-512.png` (PNG 512×512) |
| Tab favicon is HOOX SVG | `public/favicon.svg`; `tests/document-title.test.ts` |
| Docs host | `docs/docs.json` canonical `https://hoox.sh/axis/docs`; AGENTS.md sister-projects table |
| PWA origin | `docs/worker/index.mdx` Pages project `axis` → `https://axis.hoox.sh` |
| Live 404s (2026-11-09) | `curl` sitemap.xml 404, favicon.ico 404; favicon.svg 200; icon-512.png 200; robots.txt 200 CF managed |
| Skip-link owner | board card `A11y: skip-link/SSR main…` (oo-spec-2 Working) |

## Verify (2026-11-09, repo `/mnt/data/home/jango/Git/hoox-open-trading-stack/axis`)

```text
file public/favicon.ico
# MS Windows icon resource - 3 icons, 16x16 / 32x32 / 48x48

python3 -c "import struct; d=open('public/favicon.ico','rb').read(); print(struct.unpack_from('<HHH', d), len(d))"
# (0, 1, 3) 15086

rg -n 'og:title|twitter:card|favicon.ico|noscript|canonical' index.html
python3 -c "import xml.etree.ElementTree as ET; print([e.text for e in ET.parse('public/sitemap.xml').getroot().findall('{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc')])"
# ['https://axis.hoox.sh/']

grep Sitemap public/robots.txt
# Sitemap: https://axis.hoox.sh/sitemap.xml

bun test --isolate tests/document-title.test.ts
# 4 pass / 0 fail
```

Live leftover (not fixed until Pages ship):

```text
https://axis.hoox.sh/sitemap.xml   -> 404 text/html
https://axis.hoox.sh/favicon.ico   -> 404 text/html
https://axis.hoox.sh/robots.txt    -> 200 Cloudflare Managed (no Sitemap line)
```

## Checklist

```text
[1] the artifact exists at the stated path                          pass
[2] the change was verified with a command, screenshot, or numbers  pass
[3] every claim has a source                                        pass
[4] nothing outside docs was touched                                pass
    (docs-adjacent: index.html, public/favicon.ico, public/sitemap.xml,
     public/robots.txt, CHANGELOG Unreleased, this proof, board card)
```
