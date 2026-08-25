#!/usr/bin/env python3
"""Draw the source icon: three lanes, one of them branching.

Kept in the repository because an icon nobody can redraw is an icon nobody can
change. It writes source.png, from which the Tauri CLI derives every size:

    cargo tauri icon src-tauri/icons/source.png
"""

import struct
import zlib

SIZE = 256
RADIUS = 52
BACKGROUND = (0x1b, 0x1d, 0x22)
STROKE = 24.0

LANES = [
    ((0x5c, 0x9d, 0xff), [(70, 206), (70, 50)]),
    ((0x4f, 0xc0, 0x8d), [(128, 206), (128, 138)]),
    ((0xe8, 0x84, 0x6c), [(186, 206), (186, 120)]),
]

# the elbow of the branching lane, as a quadratic bezier
BRANCH = ((0x4f, 0xc0, 0x8d), (128, 138), (128, 92), (186, 92))


def bezier(start, control, end, steps=18):
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u * u * start[0] + 2 * u * t * control[0] + t * t * end[0]
        y = u * u * start[1] + 2 * u * t * control[1] + t * t * end[1]
        points.append((x, y))
    return points


def segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if length == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5


def rounded_square_coverage(x, y):
    """One minus the signed distance of a rounded square, clamped to a pixel."""
    half = SIZE / 2
    dx = abs(x + 0.5 - half) - (half - RADIUS)
    dy = abs(y + 0.5 - half) - (half - RADIUS)
    outside = ((max(dx, 0.0)) ** 2 + (max(dy, 0.0)) ** 2) ** 0.5
    distance = outside + min(max(dx, dy), 0.0) - RADIUS
    return max(0.0, min(1.0, 0.5 - distance))


def stroke_coverage(pixels, polyline, colour):
    half = STROKE / 2
    left = min(point[0] for point in polyline) - STROKE
    right = max(point[0] for point in polyline) + STROKE
    top = min(point[1] for point in polyline) - STROKE
    bottom = max(point[1] for point in polyline) + STROKE
    for y in range(max(0, int(top)), min(SIZE, int(bottom) + 1)):
        for x in range(max(0, int(left)), min(SIZE, int(right) + 1)):
            px, py = x + 0.5, y + 0.5
            distance = min(
                segment_distance(px, py, a[0], a[1], b[0], b[1])
                for a, b in zip(polyline, polyline[1:])
            )
            alpha = max(0.0, min(1.0, half + 0.5 - distance))
            if alpha <= 0:
                continue
            index = (y * SIZE + x) * 4
            for channel in range(3):
                under = pixels[index + channel]
                pixels[index + channel] = int(round(under * (1 - alpha) + colour[channel] * alpha))


def main():
    pixels = bytearray(SIZE * SIZE * 4)
    for y in range(SIZE):
        for x in range(SIZE):
            alpha = rounded_square_coverage(x, y)
            index = (y * SIZE + x) * 4
            pixels[index] = BACKGROUND[0]
            pixels[index + 1] = BACKGROUND[1]
            pixels[index + 2] = BACKGROUND[2]
            pixels[index + 3] = int(round(alpha * 255))

    for colour, polyline in LANES:
        stroke_coverage(pixels, polyline, colour)
    colour, start, control, end = BRANCH
    stroke_coverage(pixels, bezier(start, control, end), colour)

    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)
        raw.extend(pixels[y * SIZE * 4:(y + 1) * SIZE * 4])

    def chunk(kind, payload):
        head = struct.pack(">I", len(payload)) + kind
        return head + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open("source.png", "wb") as handle:
        handle.write(png)
    print("source.png written, %d bytes" % len(png))


if __name__ == "__main__":
    main()
