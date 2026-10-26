import pytest

from harness.markup_page import clip_box


def box(x: float, y: float, width: float, height: float) -> dict[str, float]:
    return {"x": x, "y": y, "width": width, "height": height}


@pytest.mark.parametrize(
    ("boxes", "scroll", "expected"),
    [
        pytest.param([box(100, 50, 20, 10)], (0, 0), box(88, 38, 44, 34), id="one box, padded"),
        pytest.param(
            [box(100, 50, 20, 10), box(300, 200, 10, 10)],
            (0, 0),
            box(88, 38, 234, 184),
            id="two boxes",
        ),
        pytest.param([box(100, 50, 20, 10)], (0, 400), box(88, 438, 44, 34), id="scrolled page"),
        pytest.param([box(5, 3, 20, 10)], (0, 0), box(0, 0, 37, 25), id="near the corner, clamped"),
    ],
)
def test_clip_box(boxes: list, scroll: tuple[float, float], expected: dict[str, float]) -> None:
    assert clip_box(boxes, scroll, padding=12) == expected
