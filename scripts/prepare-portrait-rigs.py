"""Prepare calibrated square portraits and feathered facial animation patches.

Usage: python3 scripts/prepare-portrait-rigs.py [source-image-directory]
The default source directory is the repository's images/ folder.
"""

import pathlib
import sys

from PIL import Image, ImageOps


# Source crop is (left, top, side) in source-image pixels. Facial coordinates
# below are measured after each crop is resized to 600 × 600.
SOURCES = {
    "baby": ("baby.jpeg", (0, 40, 399)),
    "ada": ("ada.jpeg", (0, 40, 452)),
    "chidi": ("julietibrahim-1575449123359.jpg", (0, 0, 1080)),
    "zainab": ("zainab.jpg", (724, 1500, 2200)),
    "tunde": ("tunde.jpg", (33, 60, 800)),
    "amara": ("chinedu.jpeg", (32, 0, 300)),
}

# Mouth rectangle and (center x, center y, radius x, radius y) for each eye.
RIGS = {
    "baby": ((216, 323, 110, 56), ((215, 242, 35, 22), (330, 246, 35, 22))),
    "ada": ((288, 386, 92, 58), ((284, 330, 31, 15), (376, 328, 29, 15))),
    "chidi": ((228, 296, 111, 58), ((210, 233, 34, 18), (317, 231, 34, 18))),
    "zainab": ((226, 300, 150, 62), ((252, 185, 35, 20), (353, 185, 35, 20))),
    "tunde": ((247, 340, 122, 58), ((263, 275, 34, 20), (371, 276, 34, 20))),
    "amara": ((281, 225, 98, 55), ((294, 170, 26, 16), (356, 170, 26, 16))),
}
MOUTH_LINES = {"baby": 350, "ada": 418, "chidi": 326, "zainab": 332, "tunde": 369, "amara": 253}


def feather(x, y, width, height):
    radius = ((2 * (x + .5) / width - 1) ** 2 +
              (2 * (y + .5) / height - 1) ** 2) ** .5
    return round(255 * max(0, min(1, (1 - radius) / .25)))


def prepare(name, source_dir, output_dir):
    filename, (left, top, side) = SOURCES[name]
    original = ImageOps.exif_transpose(Image.open(source_dir / filename)).convert("RGB")
    if left < 0 or top < 0 or left + side > original.width or top + side > original.height:
        raise ValueError(f"{filename} is too small for the configured portrait crop")
    source = original.crop((left, top, left + side, top + side)).resize(
        (600, 600), Image.Resampling.LANCZOS
    )
    source.save(output_dir / f"{name}.jpg", quality=92, optimize=True)
    (left, top, width, height), eyes = RIGS[name]
    mouth = source.crop((left, top, left + width, top + height)).convert("RGBA")
    mouth.putalpha(Image.new("L", mouth.size))
    for y in range(height):
        for x in range(width):
            mouth.putpixel((x, y), (*mouth.getpixel((x, y))[:3], feather(x, y, width, height)))
    mouth.save(output_dir / f"{name}-mouth.png")

    # Separate the person's original upper/lower lips around their calibrated
    # seam. Speech energy blends this opened pose with the resting photograph.
    opened = Image.new("RGBA", (width,height))
    seam = MOUTH_LINES[name] - top
    for y in range(height):
        for x in range(width):
            taper = max(0,1-((x-width/2)/(width*.34))**2)**.65
            gap = 17*taper
            if seam-gap/2 <= y <= seam+gap/2 and gap > .5:
                depth = 1-abs(y-seam)/(gap/2)
                opened.putpixel((x,y),(round(63-18*depth),round(31-12*depth),round(35-10*depth),feather(x,y,width,height)))
                continue
            elif y < seam:
                sy = y*seam/max(1,seam-gap/2)
            else:
                sy = seam+(y-seam-gap/2)*(height-seam)/max(1,height-seam-gap/2)
            sy = max(0,min(height-1,sy))
            a,b = int(sy), min(height-1,int(sy)+1)
            fraction = sy-a
            above,below = mouth.getpixel((x,a)),mouth.getpixel((x,b))
            rgb = tuple(round(above[i]*(1-fraction)+below[i]*fraction) for i in range(3))
            opened.putpixel((x,y),(*rgb,feather(x,y,width,height)))
    opened.save(output_dir / f"{name}-mouth-open.png")

    # Compress each actual eye into a narrow lash line. The adjacent eyelid
    # texture expands to cover the iris; an oval feather keeps the edges soft.
    closed = Image.new("RGBA", source.size)
    for cx, cy, rx, ry in eyes:
        for y in range(cy - ry, cy + ry):
            for x in range(cx - rx, cx + rx):
                taper = max(0, 1 - ((x - cx) / rx) ** 2) ** .5
                upper = cy-ry*1.18*taper
                lower = cy+ry*1.1*taper
                closed_line = cy+ry*.32*taper
                top_edge, bottom_edge = cy-ry,cy+ry
                if y <= closed_line:
                    sy = top_edge+(y-top_edge)*(upper-top_edge)/max(1,closed_line-top_edge)
                else:
                    sy = lower+(y-closed_line)*(bottom_edge-lower)/max(1,bottom_edge-closed_line)
                sy = max(0, min(599, sy))
                y0, y1 = int(sy), min(599, int(sy) + 1)
                fraction = sy - y0
                a, b = source.getpixel((x, y0)), source.getpixel((x, y1))
                rgb = tuple(round(a[i] * (1 - fraction) + b[i] * fraction) for i in range(3))
                # The upper eyelid's lash line settles against the lower lid.
                lash = max(0,1-abs(y-closed_line)/1.4)*taper*.48
                rgb = tuple(round(channel*(1-lash)) for channel in rgb)
                alpha = feather(x - cx + rx, y - cy + ry, rx * 2, ry * 2)
                closed.putpixel((x, y), (*rgb, alpha))
    closed.save(output_dir / f"{name}-blink.png")


if __name__ == "__main__":
    destination = pathlib.Path(__file__).resolve().parents[1] / "frontend/assets/images/portraits"
    destination.mkdir(parents=True, exist_ok=True)
    source_dir = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[1] / "images"
    for voice_id in RIGS:
        prepare(voice_id, source_dir, destination)
