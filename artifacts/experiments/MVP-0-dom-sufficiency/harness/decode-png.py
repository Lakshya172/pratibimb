"""
MVP-0 — decode one captured PNG to raw RGBA with Pillow.

  python decode-png.py <in.png> <out.rgba>

Same decoder every prior harness uses: QG-03b measured browser PNG decode against Pillow's on
real captures and found them bitwise identical, so the choice is not load-bearing. Refuses
rather than guessing if the buffer is not w*h*4.
"""
import sys

from PIL import Image


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: decode-png.py <in.png> <out.rgba>\n")
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    img = Image.open(src)
    img.load()
    rgba = img.convert("RGBA").tobytes()
    expected = img.size[0] * img.size[1] * 4
    if len(rgba) != expected:
        sys.stderr.write(f"decoded {len(rgba)} bytes, expected {expected}\n")
        sys.exit(3)
    open(dst, "wb").write(rgba)
    print(f"decoded {src} -> {dst} ({img.size[0]}x{img.size[1]}, Pillow {Image.__version__})")


if __name__ == "__main__":
    main()
