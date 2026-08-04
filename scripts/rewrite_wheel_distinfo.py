#!/usr/bin/env python3
# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only
"""
Rewrite a wheel's .dist-info directory (and METADATA Name) so they match the
distribution segment of the wheel *filename*.

micropip rejects installs when the archive is served under a stable browser name
such as ``pynescript-0.3.0-py3-none-any.whl`` but the build used a different
PyPI name (``hoox-pyne`` / ``pyne`` → ``hoox_pyne-0.3.0.dist-info``):

  UnsupportedWheel: .dist-info directory 'hoox_pyne-…' does not start with 'pynescript'

Import package layout (``pynescript/``) is left unchanged.

Usage:
  rewrite_wheel_distinfo.py path/to/pynescript-0.3.0-py3-none-any.whl
  rewrite_wheel_distinfo.py in.whl out.whl
"""

from __future__ import annotations

import re
import sys
import zipfile
from io import BytesIO
from pathlib import Path
from typing import NamedTuple


WHEEL_NAME_RE = re.compile(
    r"^(?P<name>[\w\d.]+)-(?P<ver>\d[\w\d.]*)-"
    r"(?P<py>[\w.]+)-(?P<abi>[\w.]+)-(?P<plat>[\w.]+)\.whl$"
)


class Entry(NamedTuple):
    info: zipfile.ZipInfo
    name: str
    data: bytes


def want_dist_info(wheel_filename: str) -> tuple[str, str]:
    """Return (distribution_name, dist_info_dirname) from a wheel basename."""
    m = WHEEL_NAME_RE.match(wheel_filename)
    if not m:
        raise SystemExit(f"cannot parse wheel filename: {wheel_filename}")
    dist_name = m.group("name")
    ver = m.group("ver")
    # Filename segment is what micropip startswith-checks (e.g. "pynescript")
    return dist_name, f"{dist_name}-{ver}.dist-info"


def rewrite_wheel(src: Path, dest: Path | None = None) -> Path:
    dest = dest or src
    dist_name, want_di = want_dist_info(dest.name)

    with zipfile.ZipFile(src, "r") as zin:
        names = zin.namelist()
        dist_infos = sorted({n.split("/")[0] for n in names if ".dist-info/" in n})
        if not dist_infos:
            raise SystemExit(f"no .dist-info directory in {src}")
        old_di = dist_infos[0]

        if old_di == want_di or old_di.startswith(f"{dist_name}-"):
            if src.resolve() != dest.resolve():
                dest.write_bytes(src.read_bytes())
            print(f"ok: {dest.name} dist-info={old_di}")
            return dest

        print(f"rewrite: {old_di} → {want_di} ({src.name} → {dest.name})")
        entries: list[Entry] = []
        for info in zin.infolist():
            raw = zin.read(info.filename)
            new_name = info.filename
            if new_name == old_di or new_name.startswith(old_di + "/"):
                new_name = want_di + new_name[len(old_di) :]
            if new_name.endswith("/METADATA"):
                text = raw.decode("utf-8")
                text = re.sub(
                    r"(?m)^Name:\s*.*$",
                    f"Name: {dist_name}",
                    text,
                    count=1,
                )
                raw = text.encode("utf-8")
            if new_name.endswith("/RECORD"):
                text = raw.decode("utf-8").replace(old_di + "/", want_di + "/")
                raw = text.encode("utf-8")
            entries.append(Entry(info, new_name, raw))

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for ent in entries:
            zi = zipfile.ZipInfo(filename=ent.name, date_time=ent.info.date_time)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = ent.info.external_attr
            zout.writestr(zi, ent.data)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(buf.getvalue())
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")
    return dest


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    src = Path(argv[1])
    dest = Path(argv[2]) if len(argv) == 3 else src
    if not src.is_file():
        print(f"error: not a file: {src}", file=sys.stderr)
        return 1
    rewrite_wheel(src, dest)
    with zipfile.ZipFile(dest, "r") as z:
        di = sorted({n.split("/")[0] for n in z.namelist() if ".dist-info/" in n})
        meta_name = next(n for n in z.namelist() if n.endswith("METADATA"))
        name_line = next(
            line
            for line in z.read(meta_name).decode("utf-8").splitlines()
            if line.startswith("Name:")
        )
    print(f"verify: dist-info={di} {name_line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
