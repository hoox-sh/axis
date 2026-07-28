# AXIS brand graphics

Visual language matches [hoox.sh/axis](https://hoox.sh/axis): flat fields, micro-grid, mono noise, corner brackets, IBM Plex Mono. Monogram **A** on cartesian axes (no HOOX mark).

## Headlines (from landing)

| Slug | Copy (always UPPERCASE in assets) |
| ---- | --------------------------------- |
| `own-the-axes` | OWN THE AXES. SWAP THE ENGINE. |
| `price-time-engine` | PRICE. TIME. ENGINE. |
| `axis-stays-open` | AXIS STAYS OPEN. |

Sources: hero H1 `OWN THE AXES. SWAP THE ENGINE.`, eyebrow `PRICE · TIME · ENGINE`, footer SEC09 `Own the axes. Swap the engine. AXIS stays open.`

## Scripts

```bash
# Centered monogram kit (SVG)
python3 brand/generate-centered.py
python3 brand/generate-centered.py --raster   # + PNG

# Tagline banners
python3 brand/generate-taglines.py --clean
python3 brand/generate-taglines.py --raster
```

Requires `rsvg-convert` for PNG output (`librsvg2-bin` on Debian/Ubuntu).

## Colors

`dark` `#050505` · `orange` `#F97316` · `white` `#FAFAFA`
