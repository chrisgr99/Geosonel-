#!/usr/bin/env python3
"""Generate a 1000x1000 medium-grey PNG using only the Python standard library.

Writes to the same folder this script lives in, as test_gray_1000.png.

Run with:
    python3 make_test_png.py
"""

import os
import struct
import zlib


def make_solid_png(path: str, width: int, height: int,
                   r: int, g: int, b: int) -> None:
    # Build the raw pixel data: each row is prefixed with a filter byte (0 = None),
    # followed by width * 3 bytes of RGB.
    row = bytes([0]) + bytes([r, g, b]) * width
    raw = row * height
    compressed = zlib.compress(raw, level=9)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data))
                + kind
                + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    signature = b"\x89PNG\r\n\x1a\n"
    # IHDR: width, height, bit depth 8, colour type 2 (RGB), no compression/filter/interlace.
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", compressed)
    iend = chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(signature + ihdr + idat + iend)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "test_gray_1000.png")
    make_solid_png(out, width=1000, height=1000, r=128, g=128, b=128)
    print(f"Wrote {out}")
