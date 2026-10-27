"""Writes src/clipper/tests/fixtures/output_duration_cases.json, which the markup's getOutputDuration is
checked against: marker pairs placed on frame starts, mid-frame and saved to 6 decimals, with constant
and ramped speed maps, each with the output duration the clipper renders for it."""

import importlib.util
import json
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "src/clipper/tests"
spec = importlib.util.spec_from_file_location("cases", TESTS / "test_output_duration_cases.py")
assert spec and spec.loader
cases_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases_module)

RATES = ["24", "30000/1001", "30", "60"]
FIRST, LAST = 30, 90
SPEEDS = {
    "constant 1": [(0, 1)],
    "constant 0.5": [(0, 0.5)],
    "ramp 1 to 0.5": [(0, 1), (1, 0.5)],
    "ramp 0.25 to 1 through 0.6": [(0, 0.25), (0.4, 0.6), (1, 1)],
}

cases = []
for rate in RATES:
    r = Fraction(rate)
    placements = {
        "on frame starts": (float(FIRST / r), float(LAST / r)),
        "mid-frame": (float((FIRST + 0.5) / r), float((LAST + 0.5) / r)),
        "saved to 6 decimals": (round(float(FIRST / r), 6), round(float(LAST / r), 6)),
    }
    for placement, (start, end) in placements.items():
        for speeds, points in SPEEDS.items():
            if len(points) == 1:
                points = [(0, points[0][1]), (1, points[0][1])]
            speedMap = [{"x": round(start + f * (end - start), 6) if 0 < f < 1 else (start if f == 0 else end), "y": y}
                        for f, y in points]  # fmt: skip
            duration = cases_module.clipperOutputDuration(speedMap, rate)
            cases.append({"rate": rate, "kind": f"{placement}, {speeds}", "speedMap": speedMap, "outputDuration": duration})

text = "[\n" + ",\n".join("  " + json.dumps(case) for case in cases) + "\n]\n"
cases_module.TABLE.write_bytes(text.encode())
print(f"{len(cases)} cases -> {cases_module.TABLE}")
