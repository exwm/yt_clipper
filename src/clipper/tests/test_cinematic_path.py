import json
import math
from pathlib import Path

import numpy as np
import pytest

PARITY = json.loads((Path(__file__).parent / "fixtures" / "cinematic_path_parity.json").read_text(encoding="utf-8"))
# The markup's cinematicMarginsFromPercent reads the same table.
MARGIN_PERCENT = json.loads(
    (Path(__file__).parent / "fixtures" / "cinematic_margin_percent.json").read_text(encoding="utf-8")
)
# The markup and the clipper run the same iterations, so they agree to the table's own rounding.
TOLERANCE_PX = 0.01


@pytest.mark.parametrize(("fps", "cropX"), [(None, 0), (30, 1200)], ids=["raw cut time", "cut on the frame boundary"])
def test_cinematic_cut_shows_on_the_frame_its_point_falls_in(fps: float | None, cropX: float) -> None:
    from clipper import cinematic_path

    # At 30 fps the cut point at 1.0167 s falls in the frame at 1.0, as the other easings cut.
    cropMap = [
        {"x": 0, "crop": "0:0:640:360"},
        {"x": 1.0167, "crop": "1200:0:640:360", "easeIn": "instant"},
        {"x": 2, "crop": "1200:0:640:360"},
    ]
    margins = {"pos": cinematic_path.DEFAULT_MARGIN, "zoom": cinematic_path.DEFAULT_ZOOM_MARGIN}
    path = cinematic_path.bakeCinematicPath(cropMap, margins, 1920, 1080, fps=fps)
    assert path is not None
    assert cinematic_path.evalCropPathAtTime(path, 1.0)[0] == pytest.approx(cropX, abs=0.5)


@pytest.mark.parametrize(
    ("pairStart", "videoPartStart"),
    [(0, 0), (10.52, 0), (10.52, 0.02)],
    ids=["pair start on a frame", "pair start between frames", "video part start"],
)
def test_cinematic_cut_snaps_on_the_video_frame_grid(pairStart: float, videoPartStart: float) -> None:
    from clipper import cinematic_path

    # The clip keeps the input video's frame phase, as in test_ffmpeg_filter's instant cut test.
    fps = 30
    pointTime = 1.0033
    cropMap = [
        {"x": pairStart, "crop": "0:0:640:360"},
        {"x": pairStart + pointTime, "crop": "1200:0:640:360", "easeIn": "instant"},
        {"x": pairStart + 2, "crop": "1200:0:640:360"},
    ]
    margins = {"pos": cinematic_path.DEFAULT_MARGIN, "zoom": cinematic_path.DEFAULT_ZOOM_MARGIN}
    path = cinematic_path.bakeCinematicPath(cropMap, margins, 1920, 1080, fps=fps, videoPartStart=videoPartStart)
    assert path is not None
    clipStart = pairStart - videoPartStart
    pointFrameTime = math.floor((clipStart + pointTime) * fps) / fps - clipStart
    assert cinematic_path.evalCropPathAtTime(path, pointFrameTime - 1 / fps)[0] == pytest.approx(0, abs=0.5)
    assert cinematic_path.evalCropPathAtTime(path, pointFrameTime)[0] == pytest.approx(1200, abs=0.5)


@pytest.mark.parametrize(("fps", "time"), [(None, 2), (30, 1.99)], ids=["raw cut time", "cut on the frame boundary"])
def test_cinematic_cut_on_the_last_point_still_shows(fps: float | None, time: float) -> None:
    from clipper import cinematic_path

    # The markup's cinematic-path.test.ts checks the same case.
    cropMap = [
        {"x": 0, "crop": "100:0:400:300"},
        {"x": 1, "crop": "100:0:400:300"},
        {"x": 2, "crop": "1200:0:400:300", "easeIn": "instant"},
    ]
    margins = {"pos": 0.1, "zoom": 0.0}
    path = cinematic_path.bakeCinematicPath(cropMap, margins, 1920, 1080, fps=fps)
    assert path is not None
    assert cinematic_path.evalCropPathAtTime(path, time)[0] == pytest.approx(1200, abs=0.5)
    # The render covers each frame with a segment: the path must reach the last point's time.
    assert path["segments"][-1]["endT"] == pytest.approx(2)


@pytest.mark.parametrize(
    "xs",
    [
        pytest.param((0, 0, 960, 960), id="hold then pan to the frame edge"),
        pytest.param((400, 400, 900, 900), id="hold then a quick move"),
        pytest.param((0, 0, 1500, 1500), id="hand-edited crop past the frame edge"),
        pytest.param((-50, -50, 400, 400), id="hand-edited crop before the frame edge"),
    ],
)
def test_cinematic_path_stays_in_the_margin_and_the_frame_between_samples(xs: tuple[int, ...]) -> None:
    from clipper import cinematic_path

    times = (0, 1, 1.1, 2)
    cropMap = [{"x": t, "crop": f"{x}:0:960:540"} for t, x in zip(times, xs, strict=True)]
    margin = 0.05
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": margin, "zoom": 0.0}, 1920, 1080)
    assert path is not None
    # The margin is a share of the crop's shorter side.
    marginPx = margin * min(960, 540)
    low, high = max(min(xs) - marginPx, 0), min(max(xs) + marginPx, 1920 - 960)
    path_xs = [cinematic_path.evalCropPathAtTime(path, i / 1000)[0] for i in range(2001)]
    tolerance = cinematic_path.SEGMENT_FIT_TOLERANCE_PX
    assert min(path_xs) >= low - tolerance
    assert max(path_xs) <= high + tolerance


def test_cinematic_zoom_keeps_the_crop_edges_in_the_frame_between_samples() -> None:
    from clipper import cinematic_path

    # Quick zooms at the bottom right corner: x and w each fit within tolerance, x + w did not.
    # The markup's cinematic-path.test.ts checks the same case.
    cropMap = [
        {"x": 0.172, "crop": "960:540:960:540"},
        {"x": 0.343, "crop": "0:0:1920:1080"},
        {"x": 0.493, "crop": "480:270:1440:810"},
        {"x": 0.841, "crop": "480:270:1440:810"},
        {"x": 0.881, "crop": "1440:810:480:270"},
        {"x": 1.128, "crop": "0:0:1920:1080"},
    ]
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 0.3, "zoom": 0.0}, 1920, 1080)
    assert path is not None
    crops = [cinematic_path.evalCropPathAtTime(path, i / 1000) for i in range(1001)]
    tolerance = cinematic_path.SEGMENT_FIT_TOLERANCE_PX
    assert max(x + w for x, _, w, _ in crops) <= 1920 + tolerance
    assert max(y + h for _, y, _, h in crops) <= 1080 + tolerance


def test_cinematic_full_height_crop_keeps_its_aspect_ratio() -> None:
    from clipper import cinematic_path

    # A 9:16 short from a 16:9 video with a quick punch-in: the width could widen by the zoom margin
    # while the height stopped at the frame. The markup's cinematic-path.test.ts checks the same case.
    cropMap = [
        {"x": 0, "crop": "656:0:607:1080"},
        {"x": 1.2, "crop": "656:0:607:1080"},
        {"x": 1.4, "crop": "807:270:304:540"},
        {"x": 1.8, "crop": "656:0:607:1080"},
        {"x": 3, "crop": "656:0:607:1080"},
    ]
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 0.07, "zoom": 0.08}, 1920, 1080)
    assert path is not None
    for i in range(301):
        _, _, w, h = cinematic_path.evalCropPathAtTime(path, i / 100)
        assert w / h == pytest.approx(607 / 1080, rel=0.01), f"at {i / 100} s"


@pytest.mark.parametrize(
    ("zoom", "points"),
    [
        pytest.param(1.0, [(0, "110:0:1158:651"), (1.43, "920:288:207:116"), (1.51, "270:451:966:543")], id="quick zoom"),
        pytest.param(1.0, [(0, "0:500:1920:80"), (1.43, "720:530:480:20"), (1.51, "0:500:1920:80")], id="wide strip"),
        # The render zooms against the widest crop of the whole path, before the cut too.
        pytest.param(
            0.5,
            [
                (0, "0:0:1920:1080"),
                (1, "0:0:1920:1080"),
                (1.3, "1571:75:283:159", "instant"),
                (1.8, "715:934:197:111"),
                (1.9, "842:701:600:338"),
            ],
            id="quick zoom after a cut from a wide crop",
        ),
    ],
)
def test_cinematic_overshoot_stays_a_crop_the_render_shows(zoom: float, points: list[tuple]) -> None:
    from clipper import cinematic_path

    # The crop overshot to 1 px wide or 2 px tall, and ffmpeg's zoompan zooms in at most 10x. The
    # markup's cinematic-path.test.ts checks the same cases.
    cropMap = [{"x": t, "crop": crop, **({"easeIn": ease[0]} if ease else {})} for t, crop, *ease in points]
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": cinematic_path.DEFAULT_MARGIN, "zoom": zoom}, 1920, 1080)
    assert path is not None
    end = round(points[-1][0] * 1000)
    sizes = [cinematic_path.evalCropPathAtTime(path, i / 1000)[2:] for i in range(end + 1)]
    tolerance = cinematic_path.SEGMENT_FIT_TOLERANCE_PX
    assert min(w for w, _ in sizes) >= max(w for w, _ in sizes) / cinematic_path.ZOOMPAN_MAX_ZOOM - tolerance
    assert min(h for _, h in sizes) >= cinematic_path.MIN_CROP_HEIGHT - tolerance

@pytest.mark.parametrize(("width", "height"), [(300, 600), (600, 300)], ids=["tall crop", "wide crop"])
def test_cinematic_position_margin_is_a_share_of_the_crop_shorter_side(width: int, height: int) -> None:
    from clipper import cinematic_path

    # Points that jitter 120 px in x and y: a 10% margin of the 300 px shorter side lets the crop drift
    # 30 px either way, in both directions; a share of the longer side would allow 60. The markup's
    # cinematic-path.test.ts checks the same cases.
    xs = (800, 920, 800, 920, 800, 920, 800)
    ys = (200, 320, 200, 320, 200, 320, 200)
    cropMap = [{"x": i / 2, "crop": f"{x}:{y}:{width}:{height}"} for i, (x, y) in enumerate(zip(xs, ys, strict=True))]
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 0.1, "zoom": 0.0}, 1920, 1080)
    assert path is not None
    tolerance = cinematic_path.SEGMENT_FIT_TOLERANCE_PX
    times = [p["x"] for p in cropMap]
    crops = [cinematic_path.evalCropPathAtTime(path, i / 100) for i in range(301)]
    for axis, points in ((0, xs), (1, ys)):
        drift = max(abs(c[axis] - np.interp(i / 100, times, points)) for i, c in enumerate(crops))
        # Uses the whole margin to smooth the jitter, and no more.
        assert 30 - 1 <= drift <= 30 + tolerance, f"axis {axis}: {drift:.1f} px"


def test_cinematic_path_keeps_a_last_crop_of_another_aspect_ratio_in_the_frame() -> None:
    from clipper import cinematic_path

    # Only a hand-edited file has it: the height keeps the first crop's ratio, the end y the last's.
    # The markup's cinematic-path.test.ts checks the same case.
    cropMap = [{"x": 0, "crop": "0:0:iw:1105"}, {"x": 2, "crop": "1035.36:1373:2210:17"}]
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": cinematic_path.DEFAULT_MARGIN, "zoom": 0.08}, 1920, 1080)
    assert path is not None
    crops = [cinematic_path.evalCropPathAtTime(path, i / 500) for i in range(1001)]
    assert max(y + h for _, y, _, h in crops) <= 1080 + cinematic_path.SEGMENT_FIT_TOLERANCE_PX


def test_solve_pulls_the_path_toward_the_target_inside_the_box() -> None:
    from clipper import cinematic_path

    # A slow swing inside a box wide enough to flatten it: the pull keeps the path closer to the
    # target, still within the box, and a very strong pull reproduces it. The markup's
    # cinematic-path.test.ts checks the same case.
    target = 40 * np.sin(np.arange(40) * 2 * np.pi / 20)
    lower, upper = target - 50, target + 50
    distance = {}
    for fidelity in (0.0, 0.2, 1e6):
        path = cinematic_path.solveL1Path(target.copy(), lower, upper, cinematic_path.WEIGHTS, fidelity)
        assert np.all(path >= lower - 1e-9)
        assert np.all(path <= upper + 1e-9)
        distance[fidelity] = float(np.abs(path - target).mean())
    assert distance[0.2] < distance[0.0] - 5
    assert distance[1e6] == pytest.approx(0, abs=0.01)


@pytest.mark.parametrize(("low", "high", "step"), [(400, 900, 0.6180339887), (390, 775, 0.4142135624)])
def test_cinematic_zoom_converges_within_the_solver_iteration_limit(
    monkeypatch: pytest.MonkeyPatch, low: int, high: int, step: float
) -> None:
    from clipper import cinematic_path

    # A crop that zooms in and out on every point, at a 50% zoom margin. Without the pull on its size, the
    # width solve stopped at MAX_ITERS up to 114 px from its optimum, so the zoom stalled mid-ease. The
    # widths follow a quasi-random sequence rather than an RNG, so the case is the same everywhere.
    cropMap = []
    for i in range(10):
        w = round(low + (high - low) * ((i * step) % 1))
        h = round(w * 9 / 16)
        cropMap.append({"x": round(5 * i / 9, 3), "crop": f"{(1920 - w) // 2}:{(1080 - h) // 2}:{w}:{h}"})

    def widths() -> list[float]:
        path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 0.2, "zoom": 0.5}, 1920, 1080, fps=30)
        assert path is not None
        return [cinematic_path.evalCropPathAtTime(path, i / 20)[2] for i in range(101)]

    capped = widths()
    monkeypatch.setattr(cinematic_path, "MAX_ITERS", 200000)
    converged = widths()
    assert max(abs(a - b) for a, b in zip(capped, converged, strict=True)) < 12


@pytest.mark.parametrize(("value", "rounded"), [(0.49999999999999994, 0), (0.5, 1), (2.5, 3), (-2.5, -2), (-0.6, -1)])
def test_crop_values_round_like_the_markup(value: float, rounded: int) -> None:
    from clipper import cinematic_path

    # JavaScript's Math.round, which the markup's solver uses: halves round up.
    assert cinematic_path._roundHalfUp(value) == rounded


@pytest.mark.parametrize("case", PARITY, ids=[case["name"] for case in PARITY])
def test_cinematic_path_matches_the_markup(case: dict) -> None:
    from clipper import cinematic_path

    # A case without holds reads its hold flags as they are.
    cropMap = cinematic_path.cinematicCropMap(case["cropMap"], case.get("holds", "exact"))
    path = cinematic_path.bakeCinematicPath(cropMap, case["margins"], *case["cropRes"], fps=case.get("fps"))
    assert path is not None
    for sample in case["samples"]:
        x, y, w, h = cinematic_path.evalCropPathAtTime(path, sample["t"])
        assert (x, y, w, h) == pytest.approx(
            (sample["x"], sample["y"], sample["w"], sample["h"]),
            abs=TOLERANCE_PX,
        ), f"at {sample['t']} s"


@pytest.mark.parametrize(
    ("cut_crop", "held_until"),
    # At 30 fps the cut lands half a frame before the frame it falls in: 4.4833 s.
    [("1200:300:640:360", (135 - 0.5) / 30 - 0.005), (None, 3.07)],
    ids=["a hold point before a cut holds until the cut", "a hold point as the last point"],
)
def test_cinematic_path_holds_still_at_hold_points(cut_crop: str | None, held_until: float) -> None:
    from clipper import cinematic_path

    cropMap = [
        {"x": 0, "y": 0, "crop": "100:300:640:360"},
        {"x": 2.03, "y": 0, "crop": "600:300:640:360"},
        {"x": 3.07, "y": 0, "crop": "600:300:640:360", "hold": True},
    ]
    if cut_crop:
        cropMap += [
            {"x": 4.5, "y": 0, "crop": cut_crop, "easeIn": "instant"},
            {"x": 6, "y": 0, "crop": "1300:300:640:360"},
        ]
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 0.12, "zoom": 0.08}, 1920, 1080, fps=30)
    assert path is not None
    for step in range(round((held_until - 2.03) / 0.005) + 1):
        crop = cinematic_path.evalCropPathAtTime(path, min(2.03 + step * 0.005, held_until))
        assert crop[:3] == pytest.approx((600, 300, 640), abs=0.5)


@pytest.mark.parametrize(
    ("point", "after", "holds"),
    [
        ({"crop": "600:300:640:360"}, {"crop": "1200:300:640:360"}, "exact"),
        ({"crop": "600.0:300:640:360", "hold": True}, {"crop": "1200:300:640:360"}, "exact"),
        ({"crop": "600.0:300:640:360", "hold": True}, {"crop": "1200:300:640:360"}, "firm"),
        ({"crop": "600:300:640:360", "hold": True}, {"crop": "1200:300:640:360"}, "loose"),
    ],
    ids=[
        "without the hold flag",
        "with the same crop written differently, as the markup releases it on load",
        "with the same crop written differently under Firm",
        "with Loose holds",
    ],
)
def test_cinematic_path_moves_through_a_point_that_is_not_held(point: dict, after: dict, holds: str) -> None:
    from clipper import cinematic_path

    cropMap = [
        {"x": 0, "y": 0, "crop": "100:300:640:360"},
        {"x": 2.03, "y": 0, "crop": "600:300:640:360"},
        {"x": 3.07, "y": 0, **point},
        {"x": 5.07, "y": 0, **after},
        {"x": 6.5, "y": 0, "crop": "1300:300:640:360"},
    ]
    path = cinematic_path.bakeCinematicPath(
        cinematic_path.cinematicCropMap(cropMap, holds), {"pos": 0.12, "zoom": 0.08}, 1920, 1080, fps=30
    )
    assert path is not None
    xs = [cinematic_path.evalCropPathAtTime(path, 2.03 + step * 0.01)[0] for step in range(105)]
    assert max(xs) - min(xs) > 5


@pytest.mark.parametrize("crop", ["620:300:640:360", "600.0:300:640:360"], ids=["a different crop", "same crop written differently"])
def test_cinematic_path_ignores_a_hold_flag_the_markup_releases_also_before_a_cut(crop: str) -> None:
    from clipper import cinematic_path

    flagged = [
        {"x": 0, "y": 0, "crop": "100:300:640:360"},
        {"x": 2.03, "y": 0, "crop": "600:300:640:360"},
        {"x": 3.07, "y": 0, "crop": crop, "hold": True},
        {"x": 4.5, "y": 0, "crop": "1200:300:640:360", "easeIn": "instant"},
        {"x": 6, "y": 0, "crop": "1300:300:640:360"},
    ]
    plain = [{key: value for key, value in point.items() if key != "hold"} for point in flagged]
    flaggedPath, plainPath = (
        cinematic_path.bakeCinematicPath(m, {"pos": 0.12, "zoom": 0.08}, 1920, 1080, fps=30) for m in (flagged, plain)
    )
    assert flaggedPath is not None
    assert plainPath is not None
    for step in range(121):
        t = step / 20
        assert cinematic_path.evalCropPathAtTime(flaggedPath, t) == cinematic_path.evalCropPathAtTime(plainPath, t)


def _xRange(cropMap: list, holds: str, margin: float, start: float, end: float) -> float:
    from clipper import cinematic_path

    path = cinematic_path.bakeCinematicPath(
        cinematic_path.cinematicCropMap(cropMap, holds), {"pos": margin, "zoom": margin}, 1920, 1080, fps=30
    )
    assert path is not None
    steps = round((end - start) / 0.01)
    xs = [cinematic_path.evalCropPathAtTime(path, start + step * 0.01)[0] for step in range(steps + 1)]
    return max(xs) - min(xs)


@pytest.mark.parametrize(
    ("margin", "start", "end"),
    [(0.03, 2, 3.6), (0.12, 2, 3.6), (0.2, 2, 3.6), (0.12, 2.03, 3.07)],
    ids=["tight margin", "default margin", "strong margin", "hold edges between grid samples"],
)
def test_cinematic_path_firm_holds_still_past_its_settle_within_the_margin(margin: float, start: float, end: float) -> None:
    cropMap = [
        {"x": 0, "y": 0, "crop": "100:300:640:360"},
        {"x": start, "y": 0, "crop": "740:300:640:360"},
        {"x": end, "y": 0, "crop": "740:300:640:360", "hold": True},
        {"x": end + 1.6, "y": 0, "crop": "1200:300:640:360"},
    ]
    # Hold edges between grid samples once let the crop arrive late and leave early.
    assert _xRange(cropMap, "firm", margin, start + 0.3, end - 0.3) < 0.5
    firm = _xRange(cropMap, "firm", margin, start, end)
    assert firm <= 2 * margin * 360
    assert firm < _xRange(cropMap, "loose", margin, start, end)
    assert _xRange(cropMap, "exact", margin, start, end) < 0.5


def _points(*specs: tuple) -> list[dict]:
    """Crop points from (time, left[, hold]) of a 640x360 crop."""
    return [
        {"x": spec[0], "y": 0, "crop": f"{spec[1]}:300:640:360", **({"hold": True} if spec[2:] == (True,) else {})}
        for spec in specs
    ]


# A pan of 640 px in 0.8 s into a hold to 3.6 s, as one hold point or split by a second one.
PAN_INTO_HOLD = _points((0, 100), (0.8, 740), (3.6, 740, True), (4.4, 1200))
PAN_INTO_HOLD_SPLIT = _points((0, 100), (0.8, 740), (0.9, 740, True), (3.6, 740, True), (4.4, 1200))
# An 800 px pan in 1 s, a still point with its crop 0.05 s later, and a hold to 3 s.
STILL_POINT_BEFORE_HOLD = _points((0, 100), (1, 900), (1.05, 900), (3, 900, True))

# Two holds with a quick 80 px move between them: a crop still at both ends must start and stop hard.
CROWDED_HOLDS = [
    {"x": 0, "y": 0, "crop": "400:300:640:360"},
    {"x": 1, "y": 0, "crop": "400:300:640:360"},
    {"x": 2, "y": 0, "crop": "400:300:640:360", "hold": True},
    {"x": 2.2, "y": 0, "crop": "480:300:640:360"},
    {"x": 3.2, "y": 0, "crop": "480:300:640:360", "hold": True},
    {"x": 4.5, "y": 0, "crop": "480:300:640:360"},
]


def test_cinematic_path_firm_borrows_time_from_crowded_holds_and_jolts_far_less_than_exact() -> None:
    from clipper import cinematic_path

    def largestSpeedChange(holds: str) -> float:
        path = cinematic_path.bakeCinematicPath(
            cinematic_path.cinematicCropMap(CROWDED_HOLDS, holds), {"pos": 0.12, "zoom": 0.08}, 1920, 1080, fps=30
        )
        assert path is not None
        xs = [cinematic_path.evalCropPathAtTime(path, frame / 30)[0] for frame in range(45, 116)]
        return max(abs(c - 2 * b + a) for a, b, c in zip(xs, xs[1:], xs[2:], strict=False))

    assert largestSpeedChange("firm") < largestSpeedChange("exact") / 3
    assert _xRange(CROWDED_HOLDS, "firm", 0.12, 1.1, 1.5) < 0.5
    assert _xRange(CROWDED_HOLDS, "firm", 0.12, 2.6, 3) < 0.5


@pytest.mark.parametrize(
    ("cropMap", "expected"),
    [
        # Per hold: start, end, crop widths per second into and out of it, and the settle times: 0.1 s
        # next to a move, none next to a still section, and half of the time the quick move between two
        # holds is missing (0.5 s to start and stop at 2 crop widths/s², in a 0.2 s section).
        (
            [
                {"x": 0, "y": 0, "crop": "100:300:640:360"},
                {"x": 2, "y": 0, "crop": "740:300:640:360"},
                {"x": 3.6, "y": 0, "crop": "740:300:640:360", "hold": True},
                {"x": 5.2, "y": 0, "crop": "1200:300:640:360"},
            ],
            [(2, 3.6, 0.5, 460 / 1.6 / 640, 0.1, 0.1)],
        ),
        (
            CROWDED_HOLDS,
            [(1, 2, 0, 80 / 0.2 / 640, 0, 0.15), (2.2, 3.2, 80 / 0.2 / 640, 0, 0.15, 0)],
        ),
        # Consecutive hold points are one hold.
        (PAN_INTO_HOLD_SPLIT, [(0.8, 3.6, 640 / 0.8 / 640, 460 / 0.8 / 640, 0.1, 0.1)]),
        # The pan braked for 0.05 s at 4 crop widths/s² by the time it reaches the hold.
        (STILL_POINT_BEFORE_HOLD, [(1.05, 3, 1.25 - 4 * 0.05, 0, 0.05, 0)]),
        # A point nudged 2 px (under 1% of the width) counts as still.
        (_points((0, 100), (1, 900), (1.05, 902), (3, 902, True)), [(1.05, 3, 1.25 - 4 * 0.05, 0, 0.05, 0)]),
        # 7 px (over 1% of the width) is a move of its own, so the hold settles from it.
        (_points((0, 100), (1, 900), (1.05, 907), (3, 907, True)), [(1.05, 3, 7 / 0.05 / 640, 0, 0.1, 0)]),
        (_points((0, 740), (1, 740), (2, 740, True), (3, 1200)), [(1, 2, 0, 460 / 640, 0, 0.1)]),
        # A still point between two holds does not join them, and neither hold moves into it.
        (
            _points((0, 100), (1, 740), (2, 740, True), (2.05, 740), (3, 740, True), (4, 1200)),
            [(1, 2, 1, 0, 0.1, 0), (2.05, 3, 0, 460 / 640, 0, 0.1)],
        ),
        # An 80 px move takes 0.5 s to start and stop. It has 0.2 s between the holds, its own 0.1 s and a
        # still point's 0.1 s, so each hold lends 0.15 s; the second hold sees the pan braked for 0.1 s.
        (
            _points((0, 400), (1, 400), (2, 400, True), (2.1, 480), (2.2, 480), (3.2, 480, True), (4.5, 480)),
            [(1, 2, 0, 80 / 0.1 / 640, 0, 0.15), (2.2, 3.2, 80 / 0.1 / 640 - 4 * 0.1, 0, 0.15, 0)],
        ),
        # The move between them would borrow 0.35 s (0.79 s to start and stop, in 0.1 s), capped at 40%
        # of each 0.3 s hold.
        (
            _points((0, 400), (0.7, 400), (1, 400, True), (1.1, 600), (1.4, 600, True), (2, 600)),
            [(0.7, 1, 0, 200 / 0.1 / 640, 0, 0.12), (1.1, 1.4, 200 / 0.1 / 640, 0, 0.12, 0)],
        ),
    ],
    ids=[
        "a lone hold",
        "two crowded holds",
        "a hold split by a second hold point",
        "a hold after a still point",
        "a hold after a point nudged off its crop",
        "a hold after a point moved 7 px",
        "a hold after only still points",
        "two holds with a still point between",
        "two holds with a quick move and a still point between",
        "two short holds with a quick move between",
    ],
)
def test_cinematic_path_firm_times_the_braking_and_settle_of_holds(cropMap: list, expected: list) -> None:
    from clipper import cinematic_path

    spans = cinematic_path.firmHeldSpans(cinematic_path.cinematicCropMap(cropMap, "firm"), 1920, 1080)
    fields = [(s.start, s.end, s.speedIn, s.speedOut, s.settleIn, s.settleOut) for s in spans]
    assert fields == [pytest.approx(row) for row in expected]


def test_cinematic_path_firm_holds_a_hold_before_a_cut_up_to_the_cut_at_rest() -> None:
    from clipper import cinematic_path

    cropMap = _points((0, 100), (2, 600), (3.5, 600, True), (4.5, 1200), (6, 900))
    cropMap[3]["easeIn"] = "instant"
    run = cinematic_path.splitAtInstantCuts(cinematic_path.cinematicCropMap(cropMap, "firm"), 30)[0]
    [span] = cinematic_path.firmHeldSpans(run, 1920, 1080)
    assert (span.start, span.end, span.speedOut, span.settleOut) == (2, run[-1]["x"], 0, 0)


def _firmPath(cropMap: list, margin: float = 0.12) -> dict:
    from clipper import cinematic_path

    path = cinematic_path.bakeCinematicPath(
        cinematic_path.cinematicCropMap(cropMap, "firm"), {"pos": margin, "zoom": margin}, 1920, 1080, fps=30
    )
    assert path is not None
    return path


def test_cinematic_path_firm_holds_a_hold_split_by_a_second_hold_point_exactly_as_one() -> None:
    from clipper import cinematic_path

    split, single = _firmPath(PAN_INTO_HOLD_SPLIT, 0.03), _firmPath(PAN_INTO_HOLD, 0.03)
    for frame in range(133):
        assert cinematic_path.evalCropPathAtTime(split, frame / 30) == cinematic_path.evalCropPathAtTime(single, frame / 30)


@pytest.mark.parametrize(
    ("withPoint", "without", "margin"),
    [
        (STILL_POINT_BEFORE_HOLD, _points((0, 100), (1, 900), (3, 900, True)), 0.12),
        (_points((0, 100), (2, 100, True), (2.05, 100), (3, 900)), _points((0, 100), (2, 100, True), (3, 900)), 0.12),
        # Nudged 2 px off the hold's crop, at a margin too tight to brake within.
        (_points((0, 100), (1, 900), (1.05, 902), (3, 902, True)), _points((0, 100), (1, 902), (3, 902, True)), 0.03),
    ],
    ids=["before", "after", "nudged 2 px before"],
)
def test_cinematic_path_firm_brakes_as_smoothly_with_a_still_point_next_to_the_hold(
    withPoint: list, without: list, margin: float
) -> None:
    from clipper import cinematic_path

    def largestSpeedChange(path: dict) -> float:
        xs = [cinematic_path.evalCropPathAtTime(path, frame / 30)[0] for frame in range(90)]
        return max(abs(c - 2 * b + a) for a, b, c in zip(xs, xs[1:], xs[2:], strict=False))

    assert largestSpeedChange(_firmPath(withPoint, margin)) < 1.5 * largestSpeedChange(_firmPath(without, margin))


@pytest.mark.parametrize(
    ("speedIn", "settleIn", "time", "allowance"),
    [
        # At 2 crop widths/s the crop needs 0.4325 crop widths past the 0.0675 margin to stop at
        # 4 crop widths/s², shed over 0.5 s.
        (2, 0.1, 1, 276.8),
        (2, 0.1, 1.25, 138.4),
        (2, 0.1, 1.5, 0),
        # A slow crop only settles: 2 crop widths/s² over the 0.1 s settle.
        (0.5, 0.1, 1, 6.4),
        (0.5, 0.1, 1.05, 1.6),
        (0.5, 0.1, 1.1, 0),
        (0.5, 0, 1, 0),
    ],
)
def test_cinematic_path_firm_lets_the_crop_leave_the_held_crop_by_its_braking_and_settle(
    speedIn: float, settleIn: float, time: float, allowance: float
) -> None:
    import numpy as np

    from clipper import cinematic_path

    span = cinematic_path.FirmHeldSpan(1, 3, (100, 300, 640, 360), speedIn, 0, settleIn, 0)
    got = cinematic_path.firmHoldAllowance(span, np.array([time]), np.array([0.12 * 360]))
    assert got[0] == pytest.approx(allowance, abs=1e-6)


@pytest.mark.parametrize(("seconds", "samples"), [(40, 401), (600, 6001), (700, 6001)])
def test_cinematic_path_keeps_the_10_hz_grid_up_to_10_minutes_per_run(seconds: float, samples: int) -> None:
    from clipper import cinematic_path

    # The margins bind only at samples, so a run gets 10 Hz until the cap.
    assert cinematic_path.gridSampleCount(seconds) == samples


def test_cinematic_crop_map_converts_hold_points_for_each_option() -> None:
    from clipper import cinematic_path

    cropMap = [{"x": 0, "y": 0, "crop": "0:0:640:360"}, {"x": 1, "y": 0, "crop": "0:0:640:360", "hold": True}]
    assert [point.get("hold") for point in cinematic_path.cinematicCropMap(cropMap, "exact")] == [None, True]
    assert [point.get("firmHold") for point in cinematic_path.cinematicCropMap(cropMap, "firm")] == [None, True]
    for holds in ("firm", "loose"):
        assert not any(point.get("hold") for point in cinematic_path.cinematicCropMap(cropMap, holds))
    assert not any(point.get("firmHold") for point in cinematic_path.cinematicCropMap(cropMap, "loose"))
    assert cinematic_path.DEFAULT_CINEMATIC_HOLDS == "firm"


@pytest.mark.parametrize(
    ("cropMap", "time", "left"),
    [
        (_points((0, 100, False), (0.05, 600, False), (2, 600, True)), 0, 100),
        (_points((0, 100, False), (2, 600, False), (3.95, 600, True), (4, 900, False)), 4, 900),
        (
            _points((0, 100, False), (1, 600, False), (2.01, 600, True), (2.09, 700, False), (3, 700, True), (5, 1200, False)),
            2.0,
            600,
        ),
    ],
    ids=[
        "the run's first crop, a hold starting less than a grid step after it",
        "the run's last crop, a hold ending less than a grid step before it",
        "the end of a hold less than a grid step before the next hold",
    ],
)
def test_cinematic_path_holds_leave_crops_near_them_alone(cropMap: list[dict], time: float, left: int) -> None:
    from clipper import cinematic_path

    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 0.12, "zoom": 0.08}, 1920, 1080)
    assert path is not None
    assert cinematic_path.evalCropPathAtTime(path, time)[0] == pytest.approx(left, abs=0.5)


@pytest.mark.parametrize("case", MARGIN_PERCENT, ids=[case["name"] for case in MARGIN_PERCENT])
def test_cinematic_margins_convert_percent_settings_like_the_markup(case: dict) -> None:
    from clipper import cinematic_path

    assert cinematic_path.cinematicMargins(case["settings"]) == {"pos": case["pos"], "zoom": case["zoom"]}


def test_cinematic_margins_take_a_pair_override_over_the_global_setting() -> None:
    from clipper import cinematic_path

    # The clipper's marker pair settings are the global settings updated with the pair's overrides.
    settings = {"cropPointEasingCinematicMargin": 12, "cropPointEasingCinematicZoomMargin": 15}
    overrides = {"cropPointEasingCinematicMargin": 6}
    assert cinematic_path.cinematicMargins({**settings, **overrides}) == {"pos": 0.06, "zoom": 0.15}
