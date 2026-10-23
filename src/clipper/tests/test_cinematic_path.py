import json
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

    path = cinematic_path.bakeCinematicPath(case["cropMap"], case["margins"], *case["cropRes"])
    assert path is not None
    for sample in case["samples"]:
        x, y, w, h = cinematic_path.evalCropPathAtTime(path, sample["t"])
        assert (x, y, w, h) == pytest.approx(
            (sample["x"], sample["y"], sample["w"], sample["h"]),
            abs=TOLERANCE_PX,
        ), f"at {sample['t']} s"


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
