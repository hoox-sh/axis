#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · AXIS · hoox-sh
# SPDX-License-Identifier: AGPL-3.0-only
"""Email signatures, v4.

One person record and one product table. The script writes a preview page
whose signature tables are the paste payload: every property the mail client
must keep is an inline style on the table. There is no stylesheet, class,
image, or script inside a signature.

  python3 brand/email-signatures/v4/generate.py

Change PERSON, then rerun. Open brand/email-signatures/v4/index.html.
"""

from __future__ import annotations

import html
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "index.html"

# Edit this, then rerun the script.
PERSON = "YOUR NAME"

FONT = (
    "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace"
)

# Accents are text on the #0A0A0A mark tile, so each one clears 4.5:1.
HOOX = "#F97316"
PYNE = "#7C8AE6"
AXIS = "#8B9CFF"
TILE = "#0A0A0A"
INK_LIGHT = "#0A0A0A"
PAPER = "#FAFAFA"
VOID = "#050505"
MUTED_LIGHT = "#4B5160"
MUTED_DARK = "#C5C8D0"
LINE_LIGHT = "#E4E4E7"
LINE_DARK = "#2C2C30"


@dataclass(frozen=True)
class Theme:
    slug: str
    paper: str
    ink: str
    muted: str
    line: str


@dataclass(frozen=True)
class Product:
    slug: str
    name: str
    mark: str
    accent: str
    radius: str
    tagline: str
    short: str
    role: str
    links: tuple[tuple[str, str], ...]


LIGHT = Theme("light", PAPER, INK_LIGHT, MUTED_LIGHT, LINE_LIGHT)
DARK = Theme("dark", VOID, PAPER, MUTED_DARK, LINE_DARK)
THEMES = (LIGHT, DARK)

PRODUCTS = (
    Product(
        "hoox",
        "HOOX",
        "H",
        HOOX,
        "6px",
        "OWN YOUR STACK.",
        "OWN YOUR STACK.",
        "Trading systems",
        (
            ("hoox.sh", "https://hoox.sh"),
            ("docs", "https://hoox.sh/docs"),
            ("github", "https://github.com/hoox-sh/hoox"),
        ),
    ),
    Product(
        "pyne",
        "PYNE",
        "P",
        PYNE,
        "6px",
        "PINE RUNTIME.",
        "PINE RUNTIME.",
        "Pine Script™ tooling",
        (
            ("hoox.sh/pyne", "https://hoox.sh/pyne"),
            ("docs", "https://hoox.sh/pyne/docs"),
            ("github", "https://github.com/hoox-sh/pyne"),
        ),
    ),
    Product(
        "axis",
        "AXIS",
        "A",
        AXIS,
        "50%",
        "OWN THE AXES. SWAP THE ENGINE.",
        "OWN THE AXES.",
        "Charting",
        (
            ("hoox.sh/axis", "https://hoox.sh/axis"),
            ("docs", "https://hoox.sh/axis/docs"),
            ("github", "https://github.com/hoox-sh/axis"),
        ),
    ),
)


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def css(props: dict[str, str]) -> str:
    return ";".join(f"{key}:{value}" for key, value in props.items())


def font_css(**extra: str) -> str:
    props = {
        "font-family": FONT,
        "font-weight": "500",
        "font-style": "normal",
    }
    props.update(extra)
    return css(props)


def table_open(attrs: str) -> str:
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" {attrs}>'
    )


def gap(height: int, span: int = 1) -> str:
    colspan = f' colspan="{span}"' if span > 1 else ""
    return (
        '<tr><td{span} height="{h}" style="height:{h}px;font-size:0;line-height:0;">&nbsp;</td></tr>'
    ).format(span=colspan, h=height)


def mark_table(letter: str, accent: str, radius: str) -> str:
    # Content box is 36px on both axes. The 1px border sits outside that, and the
    # slot below is wide enough that the border is not squeezed into an oval.
    style = font_css(
        **{
            "width": "36px",
            "height": "36px",
            "background": TILE,
            "border": f"1px solid {accent}",
            "border-radius": radius,
            "font-size": "15px",
            "line-height": "36px",
            "color": accent,
            "text-align": "center",
        }
    )
    cell = (
        f'<td align="center" valign="middle" style="{style}">{esc(letter)}</td>'
    )
    return (
        table_open(
            'width="38" style="width:38px;border-collapse:separate;border-spacing:0;"'
        )
        + f"<tr>{cell}</tr></table>"
    )


def link(label: str, href: str, color: str) -> str:
    style = font_css(
        **{
            "font-size": "12px",
            "line-height": "16px",
            "color": color,
            "text-decoration": "underline",
        }
    )
    return f'<a href="{esc(href)}" style="{style}">{esc(label)}</a>'


def link_row(product: Product, theme: Theme) -> str:
    parts: list[str] = []
    dot = (
        f'<span style="{font_css(**{"font-size": "12px", "line-height": "16px", "color": theme.muted})}">'
        "&nbsp;·&nbsp;</span>"
    )
    for index, (label, href) in enumerate(product.links):
        if index:
            parts.append(dot)
        parts.append(link(label, href, theme.ink))
    return "".join(parts)


def text_cell(text: str, style: str, span: int = 1) -> str:
    colspan = f' colspan="{span}"' if span > 1 else ""
    return f'<tr><td{colspan} style="{style}">{esc(text)}</td></tr>'


def product_signature(product: Product, theme: Theme) -> str:
    sid = f"sig-{product.slug}-{theme.slug}"
    shell = css(
        {
            "width": "520px",
            "max-width": "100%",
            "border-collapse": "collapse",
            "background": theme.paper,
            "border": f"1px solid {theme.line}",
            "border-left": f"3px solid {product.accent}",
        }
    )
    name = font_css(
        **{
            "font-size": "16px",
            "line-height": "20px",
            "letter-spacing": "0.04em",
            "color": theme.ink,
        }
    )
    kicker = font_css(
        **{
            "font-size": "11px",
            "line-height": "20px",
            "letter-spacing": "0.16em",
            "color": theme.muted,
            "text-align": "right",
        }
    )
    role = font_css(
        **{
            "font-size": "12px",
            "line-height": "16px",
            "color": theme.muted,
        }
    )
    tagline = font_css(
        **{
            "font-size": "11px",
            "line-height": "16px",
            "letter-spacing": "0.12em",
            "color": theme.ink,
        }
    )
    body = "".join(
        [
            "<tr>",
            f'<td style="{name}">{esc(PERSON)}</td>',
            f'<td align="right" style="{kicker}">{esc(product.name)}</td>',
            "</tr>",
            gap(4, 2),
            text_cell(product.role, role, 2),
            gap(8, 2),
            text_cell(product.tagline, tagline, 2),
            gap(8, 2),
            f'<tr><td colspan="2" style="{font_css(**{"font-size": "12px", "line-height": "16px"})}">'
            f"{link_row(product, theme)}</td></tr>",
        ]
    )
    inner = (
        table_open('width="100%" style="width:100%;border-collapse:collapse;"')
        + body
        + "</table>"
    )
    pad = css({"padding": "16px 18px 16px 16px"})
    row = (
        "<tr>"
        f'<td width="38" valign="middle" style="width:38px;vertical-align:middle;">'
        f"{mark_table(product.mark, product.accent, product.radius)}</td>"
        '<td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>'
        f'<td valign="middle" style="vertical-align:middle;">{inner}</td>'
        "</tr>"
    )
    return (
        f"<!-- SIG:{sid} -->\n"
        + table_open(
            f'id="{sid}" data-signature="1" width="520" style="{shell}"'
        )
        + f'<tr><td style="{pad}">'
        + table_open('width="100%" style="width:100%;border-collapse:collapse;"')
        + row
        + "</table></td></tr></table>\n"
        + f"<!-- /SIG:{sid} -->"
    )


def group_signature(theme: Theme) -> str:
    sid = f"sig-group-{theme.slug}"
    shell = css(
        {
            "width": "520px",
            "max-width": "100%",
            "border-collapse": "collapse",
            "background": theme.paper,
            "border": f"1px solid {theme.line}",
            "border-left": f"3px solid {HOOX}",
        }
    )
    name = font_css(
        **{
            "font-size": "16px",
            "line-height": "20px",
            "letter-spacing": "0.04em",
            "color": theme.ink,
        }
    )
    role = font_css(
        **{
            "font-size": "12px",
            "line-height": "16px",
            "color": theme.muted,
        }
    )
    rows: list[str] = []
    for index, product in enumerate(PRODUCTS):
        top = "0" if index == 0 else "1px"
        pad = css(
            {
                "padding": "9px 0",
                "border-top": f"{top} solid {theme.line}",
                "vertical-align": "middle",
            }
        )
        label = font_css(
            **{
                "padding": "9px 12px 9px 0",
                "border-top": f"{top} solid {theme.line}",
                "font-size": "11px",
                "line-height": "16px",
                "letter-spacing": "0.14em",
                "color": theme.ink,
                "vertical-align": "middle",
            }
        )
        short = font_css(
            **{
                "padding": "9px 12px 9px 0",
                "border-top": f"{top} solid {theme.line}",
                "font-size": "11px",
                "line-height": "16px",
                "letter-spacing": "0.08em",
                "color": theme.muted,
                "vertical-align": "middle",
            }
        )
        link_style = font_css(
            **{
                "padding": "9px 0",
                "border-top": f"{top} solid {theme.line}",
                "font-size": "12px",
                "line-height": "16px",
                "text-align": "right",
                "vertical-align": "middle",
            }
        )
        swatch = css(
            {
                "width": "8px",
                "height": "8px",
                "background": product.accent,
                "font-size": "0",
                "line-height": "0",
            }
        )
        home_label, home_href = product.links[0]
        rows.append(
            "<tr>"
            f'<td width="18" style="{pad}">'
            + table_open('width="8" style="width:8px;border-collapse:collapse;"')
            + f'<tr><td width="8" height="8" style="{swatch}">&nbsp;</td></tr></table>'
            + "</td>"
            f'<td width="72" style="{label}">{esc(product.name)}</td>'
            f'<td style="{short}">{esc(product.short)}</td>'
            f'<td align="right" style="{link_style}">{link(home_label, home_href, theme.ink)}</td>'
            "</tr>"
        )
    header = (
        table_open('width="100%" style="width:100%;border-collapse:collapse;"')
        + "<tr>"
        f'<td width="38" valign="middle" style="width:38px;vertical-align:middle;">'
        f"{mark_table('H', HOOX, '6px')}</td>"
        '<td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>'
        "<td valign=\"middle\">"
        + table_open('width="100%" style="width:100%;border-collapse:collapse;"')
        + f'<tr><td style="{name}">{esc(PERSON)}</td></tr>'
        + gap(4)
        + text_cell("Founder", role)
        + "</table></td></tr></table>"
    )
    catalog = (
        table_open('width="100%" style="width:100%;border-collapse:collapse;"')
        + "".join(rows)
        + "</table>"
    )
    pad = css({"padding": "16px 18px 8px 16px"})
    return (
        f"<!-- SIG:{sid} -->\n"
        + table_open(f'id="{sid}" data-signature="1" width="520" style="{shell}"')
        + f'<tr><td style="{pad}">{header}</td></tr>'
        + '<tr><td style="padding:4px 18px 10px 16px;">'
        + catalog
        + "</td></tr></table>\n"
        + f"<!-- /SIG:{sid} -->"
    )


def well(title: str, theme: Theme, signature: str, sid: str) -> str:
    return (
        f'<section class="well {theme.slug}">'
        f'<p class="label">{esc(title)}</p>'
        '<p class="ghost">Thanks for the note.</p>'
        f"{signature}"
        f'<button type="button" data-copy="{sid}">Copy table</button>'
        "</section>"
    )


def page() -> str:
    cards: list[str] = []
    cards.append("<h2>Group</h2>")
    cards.append('<div class="grid">')
    for theme in THEMES:
        sid = f"sig-group-{theme.slug}"
        cards.append(well(f"GROUP · {theme.slug.upper()}", theme, group_signature(theme), sid))
    cards.append("</div>")
    for product in PRODUCTS:
        cards.append(f"<h2>{esc(product.name)}</h2>")
        cards.append('<div class="grid">')
        for theme in THEMES:
            sid = f"sig-{product.slug}-{theme.slug}"
            cards.append(
                well(
                    f"{product.name} · {theme.slug.upper()}",
                    theme,
                    product_signature(product, theme),
                    sid,
                )
            )
        cards.append("</div>")
    body = "\n".join(cards)
    return f"""<!doctype html>
<!-- Copyright (c) 2026 HOOX · AXIS · hoox-sh | SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Generated by brand/email-signatures/v4/generate.py. Edit that script and rerun. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email signatures v4</title>
<style>
  @font-face {{
    font-family: "IBM Plex Mono";
    src: url("../../fonts/ibm-plex-mono-v20-latin-500.ttf") format("truetype");
    font-weight: 500;
    font-style: normal;
  }}
  body {{
    margin: 0;
    background: #111113;
    color: #FAFAFA;
    font-family: {FONT};
    font-weight: 500;
  }}
  .wrap {{ max-width: 1120px; margin: 0 auto; padding: 40px 24px 80px; }}
  h1 {{ margin: 0; font-size: 13px; letter-spacing: 0.18em; font-weight: 500; }}
  h2 {{ margin: 36px 0 14px; font-size: 11px; letter-spacing: 0.16em; font-weight: 500; color: #B4B8C2; }}
  .lead {{ margin: 14px 0 0; max-width: 68ch; color: #C5C8D0; font-size: 13px; line-height: 1.6; }}
  .grid {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; }}
  .well {{ min-width: 0; padding: 18px 18px 14px; overflow-x: auto; }}
  .well.light {{ background: #E8E8EA; }}
  .well.dark {{ background: #161618; }}
  .label {{ margin: 0 0 14px; font-size: 10px; letter-spacing: 0.16em; color: #8B909A; }}
  .well.light .label {{ color: #5C6370; }}
  .ghost {{ margin: 0 0 14px; font-size: 12px; line-height: 1.5; color: #8B909A; }}
  .well.light .ghost {{ color: #6A7080; }}
  button {{
    display: inline-block;
    margin-top: 12px;
    padding: 6px 10px;
    border: 1px solid #C4C4C8;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 11px;
    letter-spacing: 0.12em;
    cursor: pointer;
  }}
  .well.dark button {{ border-color: #3A3A40; color: #FAFAFA; }}
  .well.light button {{ color: #0A0A0A; }}
  button:focus-visible {{ outline: 2px solid #8B9CFF; outline-offset: 2px; }}
  @media (max-width: 860px) {{
    .grid {{ grid-template-columns: minmax(0, 1fr); }}
    .wrap {{ padding: 28px 16px 64px; }}
  }}
</style>
</head>
<body>
<div class="wrap">
  <h1>EMAIL SIGNATURES · V4</h1>
  <p class="lead">Copy the table, then paste it into the signature editor. Color, type, and spacing sit on the table, so the paste matches this page. The mark is a letter on a dark tile: nothing to host, and no stylesheet to lose. The name lives in <code>generate.py</code>.</p>
  {body}
</div>
<script>
  function copyTable(id, button) {{
    var table = document.getElementById(id);
    if (!table) return;
    var range = document.createRange();
    range.selectNode(table);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    var ok = document.execCommand("copy");
    selection.removeAllRanges();
    button.textContent = ok ? "COPIED" : "COPY FAILED";
    window.setTimeout(function () {{ button.textContent = "COPY TABLE"; }}, 1400);
  }}
  document.querySelectorAll("[data-copy]").forEach(function (button) {{
    button.textContent = "COPY TABLE";
    button.addEventListener("click", function () {{
      copyTable(button.getAttribute("data-copy"), button);
    }});
  }});
</script>
</body>
</html>
"""


def signatures_of(document: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    cursor = 0
    while True:
        start = document.find("<!-- SIG:", cursor)
        if start < 0:
            break
        sid_end = document.find(" -->", start)
        sid = document[start + len("<!-- SIG:") : sid_end]
        end = document.find(f"<!-- /SIG:{sid} -->", sid_end)
        if end < 0:
            raise SystemExit(f"unclosed signature {sid}")
        found.append((sid, document[sid_end + 4 : end]))
        cursor = end + 1
    return found


def validate(document: str) -> None:
    blocks = signatures_of(document)
    expected = [f"sig-group-{theme.slug}" for theme in THEMES]
    expected += [
        f"sig-{product.slug}-{theme.slug}"
        for product in PRODUCTS
        for theme in THEMES
    ]
    got = [sid for sid, _ in blocks]
    if got != expected:
        raise SystemExit(f"signature set mismatch:\n  {got}\n  {expected}")
    banned = ("<style", "class=", "onerror", "unsubscribe", ".svg", "animation", "<div", "<img", "opacity:")
    for sid, block in blocks:
        lowered = block.lower()
        for token in banned:
            if token in lowered:
                raise SystemExit(f"{sid} contains {token}")
        if "font-family:" not in lowered:
            raise SystemExit(f"{sid} is missing an inline font")
        if PERSON not in block:
            raise SystemExit(f"{sid} is missing the person name")
        if "https://" not in block:
            raise SystemExit(f"{sid} is missing a link")
    if "JettBrains" in document:
        raise SystemExit("misspelled font name")


def main() -> None:
    document = page()
    validate(document)
    OUT.write_text(document, encoding="utf-8")
    print(f"wrote {OUT.relative_to(HERE.parents[2])}")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
