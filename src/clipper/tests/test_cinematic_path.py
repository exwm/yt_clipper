import json
from pathlib import Path

import pytest

PARITY = json.loads((Path(__file__).parent / "fixtures" / "cinematic_path_parity.json").read_text(encoding="utf-8"))
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
    margins = {"pos": 40.0, "zoom": 0.0}
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
    margin = 40.0
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": margin, "zoom": 0.0}, 1920, 1080)
    assert path is not None
    low, high = max(min(xs) - margin, 0), min(max(xs) + margin, 1920 - 960)
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
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 300.0, "zoom": 0.0}, 1920, 1080)
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
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 40.0, "zoom": 0.08}, 1920, 1080)
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
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 40.0, "zoom": zoom}, 1920, 1080)
    assert path is not None
    end = round(points[-1][0] * 1000)
    sizes = [cinematic_path.evalCropPathAtTime(path, i / 1000)[2:] for i in range(end + 1)]
    tolerance = cinematic_path.SEGMENT_FIT_TOLERANCE_PX
    assert min(w for w, _ in sizes) >= max(w for w, _ in sizes) / cinematic_path.ZOOMPAN_MAX_ZOOM - tolerance
    assert min(h for _, h in sizes) >= cinematic_path.MIN_CROP_HEIGHT - tolerance

def test_cinematic_path_keeps_a_last_crop_of_another_aspect_ratio_in_the_frame() -> None:
    from clipper import cinematic_path

    # Only a hand-edited file has it: the height keeps the first crop's ratio, the end y the last's.
    # The markup's cinematic-path.test.ts checks the same case.
    cropMap = [{"x": 0, "crop": "0:0:iw:1105"}, {"x": 2, "crop": "1035.36:1373:2210:17"}]
    path = cinematic_path.bakeCinematicPath(cropMap, {"pos": 40.0, "zoom": 0.08}, 1920, 1080)
    assert path is not None
    crops = [cinematic_path.evalCropPathAtTime(path, i / 500) for i in range(1001)]
    assert max(y + h for _, y, _, h in crops) <= 1080 + cinematic_path.SEGMENT_FIT_TOLERANCE_PX


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
