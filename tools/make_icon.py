#!/usr/bin/env python3
"""Generate Esploro app icons from the Phosphor binoculars SVG path."""

import os
import shutil
import struct
import zlib
import subprocess
from pathlib import Path

try:
    import cairosvg
    from PIL import Image
    import io
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip3 install cairosvg pillow --break-system-packages")
    raise

# Tairiki dark-mode tones (sourced from src/styles/tokens.css)
#   --ds-accent-subtle (dark): #1e3a5f   ← deep blue tint
#   --ds-accent (light):       #2563eb   ← blue-600 (highlight hint)
# Plus a deeper navy `#0a1929` extension to anchor the bottom of the gradient.
TAIRIKI_DEEP_NAVY = "#0a1929"
TAIRIKI_DEEP_BLUE = "#1e3a5f"
TAIRIKI_BLUE_HIGHLIGHT = "#2f6fcf"  # lifted Tairiki blue for the top-left lume
ICON_INNER_STROKE = "rgba(255,255,255,0.10)"

# Phosphor binoculars-bold path (256x256 viewBox). This is the same icon Phosphor
# returns for the search query "explore" — see https://phosphoricons.com/?q=explore
BINOCULARS_PATH = "M241,150.65s0,0,0-.05a51.33,51.33,0,0,0-2.53-5.9L196.93,50.18a12,12,0,0,0-2.5-3.65,36,36,0,0,0-50.92,0A12,12,0,0,0,140,55V76H116V55a12,12,0,0,0-3.51-8.48,36,36,0,0,0-50.92,0,12,12,0,0,0-2.5,3.65L17.53,144.7A51.33,51.33,0,0,0,15,150.6s0,0,0,.05A52,52,0,1,0,116,168V100h24v68a52,52,0,1,0,101-17.35ZM80,62.28a12,12,0,0,1,12-1.22v63.15a51.9,51.9,0,0,0-35.9-7.62ZM64,196a28,28,0,1,1,28-28A28,28,0,0,1,64,196ZM164,61.06a12.06,12.06,0,0,1,12,1.22l23.87,54.31a51.9,51.9,0,0,0-35.9,7.62ZM192,196a28,28,0,1,1,28-28A28,28,0,0,1,192,196Z"

# Render every PNG at this multiple of the target size and downsample with
# LANCZOS. cairosvg's native rasterisation is slightly soft at small sizes; the
# supersampling gives noticeably crisper edges in the 16/32 px Dock & taskbar
# slots without changing how larger sizes look.
SUPERSAMPLE = 4


def make_icon_svg(size: int) -> str:
    """Generate the full icon SVG at the given canvas size."""
    # macOS squircle: corner radius ~22.37% of size
    radius = round(size * 0.2237)
    padding = round(size * 0.04)  # 4% padding from edge

    # Binoculars: scale to ~60% of canvas, centered
    glyph_size = round(size * 0.60)
    offset = (size - glyph_size) / 2
    scale = glyph_size / 256

    inner_x = padding + 0.5
    inner_y = padding + 0.5
    inner_w = size - padding * 2 - 1
    inner_h = size - padding * 2 - 1
    inner_r = radius - 0.5

    # Highlight ellipse near the top-left to suggest a soft Tairiki-blue lume.
    lume_cx = padding + (size - padding * 2) * 0.28
    lume_cy = padding + (size - padding * 2) * 0.22
    lume_rx = (size - padding * 2) * 0.55
    lume_ry = (size - padding * 2) * 0.45

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <defs>
    <!-- Diagonal Tairiki gradient: deep blue → near-black navy -->
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="{TAIRIKI_DEEP_BLUE}"/>
      <stop offset="100%" stop-color="{TAIRIKI_DEEP_NAVY}"/>
    </linearGradient>
    <!-- Subtle Tairiki-blue lume in the upper-left for depth -->
    <radialGradient id="lume" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stop-color="{TAIRIKI_BLUE_HIGHLIGHT}" stop-opacity="0.55"/>
      <stop offset="60%"  stop-color="{TAIRIKI_BLUE_HIGHLIGHT}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="{TAIRIKI_BLUE_HIGHLIGHT}" stop-opacity="0"/>
    </radialGradient>
    <!-- Squircle clip so the lume doesn't bleed past the corners -->
    <clipPath id="squircle">
      <rect x="{padding}" y="{padding}"
            width="{size - padding * 2}" height="{size - padding * 2}"
            rx="{radius}" ry="{radius}"/>
    </clipPath>
  </defs>

  <!-- Background squircle -->
  <rect x="{padding}" y="{padding}"
        width="{size - padding * 2}" height="{size - padding * 2}"
        rx="{radius}" ry="{radius}"
        fill="url(#bg)"/>

  <!-- Tairiki-blue lume (clipped to the squircle) -->
  <g clip-path="url(#squircle)">
    <ellipse cx="{lume_cx:.3f}" cy="{lume_cy:.3f}"
             rx="{lume_rx:.3f}" ry="{lume_ry:.3f}"
             fill="url(#lume)"/>
  </g>

  <!-- Subtle inner stroke for depth -->
  <rect x="{inner_x}" y="{inner_y}"
        width="{inner_w}" height="{inner_h}"
        rx="{inner_r}" ry="{inner_r}"
        fill="none"
        stroke="{ICON_INNER_STROKE}"
        stroke-width="1"/>

  <!-- Binoculars glyph (white, centered) -->
  <g transform="translate({offset}, {offset}) scale({scale})">
    <path d="{BINOCULARS_PATH}" fill="white"/>
  </g>
</svg>"""


def svg_to_png_bytes(svg_str: str, size: int) -> bytes:
    """Rasterise SVG → PNG, supersampled and downscaled with LANCZOS for crisp edges."""
    hi_res = size * SUPERSAMPLE
    raw = cairosvg.svg2png(bytestring=svg_str.encode(), output_width=hi_res, output_height=hi_res)
    if SUPERSAMPLE == 1:
        return raw
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    img = img.resize((size, size), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def png_bytes_to_pil(data: bytes) -> "Image.Image":
    return Image.open(io.BytesIO(data))


def write_png(path: Path, size: int) -> None:
    svg = make_icon_svg(size)
    data = svg_to_png_bytes(svg, size)
    path.write_bytes(data)
    print(f"  wrote {path} ({size}x{size})")


def make_icns(icons_dir: Path) -> None:
    """Build icon.icns using iconutil from a generated iconset directory."""
    iconset_dir = icons_dir / "AppIcon.iconset"
    iconset_dir.mkdir(exist_ok=True)

    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]

    for sz, name in sizes:
        svg = make_icon_svg(sz)
        data = svg_to_png_bytes(svg, sz)
        (iconset_dir / name).write_bytes(data)

    result = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(icons_dir / "icon.icns")],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  iconutil error: {result.stderr}")
    else:
        print(f"  wrote {icons_dir / 'icon.icns'}")
    shutil.rmtree(iconset_dir)


def make_ico(path: Path) -> None:
    """Build a multi-size Windows .ico by embedding PNG data directly."""
    ico_sizes = [16, 32, 48, 256]
    png_blobs = [svg_to_png_bytes(make_icon_svg(sz), sz) for sz in ico_sizes]

    # ICO format: 6-byte header, N*16-byte directory entries, then image data
    n = len(ico_sizes)
    header = struct.pack("<HHH", 0, 1, n)   # reserved=0, type=1 (ICO), count=N

    # Compute data offset: header (6) + directory (n * 16)
    data_offset = 6 + n * 16
    directory = b""
    for sz, blob in zip(ico_sizes, png_blobs):
        # width/height are stored as 0 when the value is 256
        w = h = 0 if sz == 256 else sz
        directory += struct.pack(
            "<BBBBHHII",
            w, h,           # width, height (0 = 256)
            0,              # color count (0 = >8-bit)
            0,              # reserved
            1,              # color planes
            32,             # bits per pixel
            len(blob),      # image size in bytes
            data_offset,    # offset to image data
        )
        data_offset += len(blob)

    with open(path, "wb") as f:
        f.write(header + directory)
        for blob in png_blobs:
            f.write(blob)

    print(f"  wrote {path}")


def main():
    icons_dir = Path(__file__).parent.parent / "src-tauri" / "icons"
    icons_dir.mkdir(exist_ok=True)

    print("Generating Esploro icon assets...")

    write_png(icons_dir / "32x32.png", 32)
    write_png(icons_dir / "128x128.png", 128)
    write_png(icons_dir / "128x128@2x.png", 256)
    write_png(icons_dir / "icon.png", 1024)

    make_icns(icons_dir)
    make_ico(icons_dir / "icon.ico")

    print("Done.")


if __name__ == "__main__":
    main()
