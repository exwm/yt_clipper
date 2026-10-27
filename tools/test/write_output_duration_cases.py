"""Writes src/clipper/tests/fixtures/output_duration_cases.json, which the markup's getOutputDuration is
checked against: marker pairs placed on frame starts, mid-frame, late in their frames and saved to 6
decimals, with constant and ramped speed maps, each with the output duration the clipper renders for
it. A sweep of end frames at the NTSC rates includes output times that fall exactly between two
frames. Rows with a grid origin or video part start are checked by the clipper only (the markup's grid
starts at 0)."""

import importlib.util
import json
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cases", ROOT / "src/clipper/tests/test_output_duration_cases.py")
assert spec
assert spec.loader
cases_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases_module)

RATES = ["24", "30000/1001", "30", "60"]
FIRST, LAST = 30, 90
SPEEDS = {
    "constant 1": [(0, 1), (1, 1)],
    "constant 0.5": [(0, 0.5), (1, 0.5)],
    "ramp 1 to 0.5": [(0, 1), (1, 0.5)],
    "ramp 0.25 to 1 through 0.6": [(0, 0.25), (0.4, 0.6), (1, 1)],
}


def speedMap(start: float, end: float, points: list[tuple[float, float]]) -> list[dict]:
    return [{"x": start if f == 0 else end if f == 1 else round(start + f * (end - start), 6), "y": y} for f, y in points]


def case(rate: str, kind: str, points: list[dict], origin: float = 0, partStart: float = 0) -> dict:
    duration = cases_module.clipperOutputDuration(points, rate, origin, partStart)
    return {"rate": rate, "kind": kind, "origin": origin, "partStart": partStart, "speedMap": points, "outputDuration": duration}


cases = []
for rate in RATES:
    r = Fraction(rate)
    placements = {
        "on frame starts": (float(FIRST / r), float(LAST / r)),
        "mid-frame": (float((FIRST + 0.5) / r), float((LAST + 0.5) / r)),
        "late in their frames": (float((FIRST + 0.9) / r), float((LAST + 0.9) / r)),
        "saved to 6 decimals": (round(float(FIRST / r), 6), round(float(LAST / r), 6)),
    }
    for placement, (start, end) in placements.items():
        for speeds, points in SPEEDS.items():
            cases.append(case(rate, f"{placement}, {speeds}", speedMap(start, end, points)))
    start, end = float(FIRST / r), float(LAST / r)
    for speeds, points in SPEEDS.items():
        cases.append(case(rate, f"from a 21 ms start offset, {speeds}", speedMap(start + 0.021, end + 0.021, points), origin=0.021))
        cases.append(case(rate, f"in a part starting at 10.01 s, {speeds}", speedMap(start + 10.01, end + 10.01, points), partStart=10.01))
    # A speed point inside the last frame, after its start.
    inside = float((LAST + 0.3) / r)
    cases.append(case(rate, "a speed point inside the last frame", [{"x": start, "y": 1}, {"x": round(inside, 6), "y": 0.5}, {"x": float((LAST + 0.6) / r), "y": 0.5}]))

# NTSC rates, ends sweeping 31 to 120 frames past the start: some last frames' output times fall
# exactly between two frames.
for rate in ["24000/1001", "30000/1001", "60000/1001"]:
    r = Fraction(rate)
    for last in range(31, 121):
        for speeds, points in SPEEDS.items():
            if speeds.startswith("constant"):
                continue
            cases.append(case(rate, f"sweep to frame {last}, {speeds}", speedMap(float(10 / r), round(float(last / r), 6), points)))

text = "[\n" + ",\n".join("  " + json.dumps(c) for c in cases) + "\n]\n"
cases_module.TABLE.write_bytes(text.encode())
print(f"{len(cases)} cases -> {cases_module.TABLE}")
