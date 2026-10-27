"""Writes src/clipper/tests/fixtures/frame_grid_cases.json, which the markup and clipper frame grids are
both checked against: times placed on frame n in the ways they reach the core (exact, saved to 6
decimals, YouTube's millisecond frame times, mid-frame), each expected to map to frame n, and one just
past the tolerance expected on frame n - 1. The expected frame holds by construction."""

import json
import math
from fractions import Fraction
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "src/clipper/tests/fixtures/frame_grid_cases.json"
RATES = ["24000/1001", "24", "25", "30000/1001", "30", "50", "60000/1001", "60", "120"]
ORIGINS = [0, 10, 0.021]
FRAMES = [1, 91, 123, 4321, 50000]


def floor_to(t: float, digits: int) -> float:
    return math.floor(t * 10**digits) / 10**digits


def ceil_to(t: float, digits: int) -> float:
    return math.ceil(t * 10**digits) / 10**digits


cases = []
starts = []
for rate in RATES:
    r = Fraction(rate)
    duration = float(1 / r)
    for origin in ORIGINS:
        for n in FRAMES:
            start = origin + float(Fraction(n) / r)
            starts.append({"rate": rate, "origin": origin, "frame": n, "start": start})
            times = {
                "frame start": start,
                "saved to 6 decimals": round(start, 6),
                "6 decimals rounded down": floor_to(start, 6),
                "6 decimals rounded up": ceil_to(start, 6),
                "millisecond frame time": round(start, 3),
                "0.9 ms early": start - 0.0009,
                "middle of the frame": start + duration / 2,
                "1.5 ms before the next frame": start + duration - 0.0015,
            }
            for kind, t in times.items():
                cases.append({"rate": rate, "origin": origin, "time": t, "frame": n, "kind": kind})
            previous = {
                "time": start - 0.0011,
                "frame": n - 1,
                "kind": "1.1 ms early (previous frame)",
            }
            cases.append({"rate": rate, "origin": origin, **previous})


def rows(items: list[dict]) -> str:
    """One case per line, so the file reads as a table."""
    return ",\n".join("  " + json.dumps(item) for item in items)


text = f'{{\n"timeToFrame": [\n{rows(cases)}\n],\n"frameStart": [\n{rows(starts)}\n]\n}}\n'
OUT.write_bytes(text.encode())
print(f"{len(cases)} time cases, {len(starts)} frame starts -> {OUT}")
