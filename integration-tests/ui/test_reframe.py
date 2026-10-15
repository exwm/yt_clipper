"""Reframe (V): the preview fills the whole player, and the navigator minimap outlines the crop in
two tones so it shows on light and dark video."""

import io

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step
from PIL import Image

# How far in from each canvas edge to sample, and the lightness below which a pixel counts as the
# black border a too-small reframe leaves.
EDGE_INSET_PX = 3
BORDER_LIGHTNESS = 20

# The default crop resolution width (a userscript setting, the same on every platform), which crop
# values are expressed in.
CROP_RES_WIDTH = 1920
# How far either side of the computed crop edge to look for its outline, in minimap canvas pixels.
EDGE_SLACK_PX = 4
# How much darker the outer (black) line must read than the inner (white) one.
OUTLINE_CONTRAST = 100


@pytest.fixture
def reframed(markup: MarkupPage) -> MarkupPage:
    given_a_marker_pair_with_a_narrowed_crop(markup)
    given_reframe_is_on(markup)
    return markup


@pytest.mark.platform
def test_reframe_preview_fills_the_player(reframed: MarkupPage) -> None:
    then_the_reframe_canvas_covers_the_player(reframed)
    then_the_reframed_crop_fills_the_canvas_along_its_fitted_axis(reframed)


@pytest.mark.platform
def test_minimap_outlines_the_crop_in_two_tones(reframed: MarkupPage) -> None:
    given_the_minimap_is_shown(reframed)
    then_the_minimap_crop_outline_is_dark_outside_and_light_inside(reframed)


# ─── given ──────────────────────────────────────────────────────────────────


@step
def given_a_marker_pair_with_a_narrowed_crop(markup: MarkupPage) -> None:
    markup.add_marker_pair(3, 6)
    markup.open_marker_pair(0)
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] - 4, video["y"] + video["height"] / 2
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x - 20, y)
    markup.page.mouse.move(x, y, steps=3)
    markup.page.mouse.down()
    markup.page.mouse.move(x - 400, y, steps=8)
    markup.page.mouse.up()
    markup.page.keyboard.up("Control")


@step
def given_reframe_is_on(markup: MarkupPage) -> None:
    markup.press("KeyV")
    markup.page.wait_for_selector("#ytc-reframe-canvas", state="visible")
    markup.next_frames()  # the canvas sizes itself on its next frame
    markup.shot("reframed")


@step
def given_the_minimap_is_shown(markup: MarkupPage) -> None:
    if not markup.page.locator(".ytc-zoom-minimap").count():
        markup.press("Shift+KeyV")
    markup.page.wait_for_selector(".ytc-zoom-minimap canvas", state="visible")
    markup.next_frames(3)  # the minimap draws the frame and crop outline on its next frames
    markup.shot("minimap")


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_the_reframe_canvas_covers_the_player(markup: MarkupPage) -> None:
    canvas = markup.box_of("#ytc-reframe-canvas")
    player = markup.box_of(markup.host.player)
    markup.report(f"canvas {canvas}, player {player}")
    for key in ("x", "y", "width", "height"):
        assert canvas[key] == pytest.approx(player[key], abs=2), key


@step
def then_the_reframed_crop_fills_the_canvas_along_its_fitted_axis(markup: MarkupPage) -> None:
    # The crop is scaled to fit the canvas, so it reaches both edges of one axis: top and bottom
    # for a crop taller than the canvas's aspect, left and right for a wider one. A crop drawn
    # smaller than that leaves a black border there; the test video itself has no black.
    canvas = markup.page.locator("#ytc-reframe-canvas").screenshot()
    image = Image.open(io.BytesIO(canvas)).convert("RGB")
    width, height = image.size
    _, _, crop_w, crop_h = markup.page.locator("#crop-input").input_value().split(":")
    crop_aspect = float(crop_w) / float(crop_h)
    inset = EDGE_INSET_PX
    if crop_aspect < width / height:
        edges = {"top": (width // 2, inset), "bottom": (width // 2, height - 1 - inset)}
    else:
        edges = {"left": (inset, height // 2), "right": (width - 1 - inset, height // 2)}
    lightness = {name: round(lightness_at(image, xy)) for name, xy in edges.items()}
    markup.report(f"crop aspect {crop_aspect:.2f}, lightness at the fitted edges: {lightness}")
    assert all(value > BORDER_LIGHTNESS for value in lightness.values()), lightness


@step
def then_the_minimap_crop_outline_is_dark_outside_and_light_inside(markup: MarkupPage) -> None:
    # Around the crop's right edge on the minimap's middle row: a near-white line just inside the
    # crop and a near-black line just outside it, whatever the video shows there.
    crop_x, _, crop_w, _ = markup.page.locator("#crop-input").input_value().split(":")
    edge_fraction = (float(crop_x) + float(crop_w)) / CROP_RES_WIDTH
    edge_x, row = markup.page.evaluate(
        """(edgeFraction) => {
          const canvas = document.querySelector('.ytc-zoom-minimap canvas');
          const y = Math.floor(canvas.height / 2);
          const pixels = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data;
          const lightness = [];
          for (let i = 0; i < pixels.length; i += 4) lightness.push((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
          return [Math.round(edgeFraction * canvas.width), lightness];
        }""",
        edge_fraction,
    )
    near_edge = row[edge_x - EDGE_SLACK_PX : edge_x + EDGE_SLACK_PX + 1]
    markup.report(f"lightness around the crop edge at x={edge_x}: {[round(v) for v in near_edge]}")
    # The lines sit on half pixels, so each blends across two: look for a bright pixel with a much
    # darker one just right of it rather than for pure white and black.
    white_then_black = [
        i
        for i in range(len(near_edge) - 2)
        if near_edge[i] > 200 and min(near_edge[i + 1 : i + 3]) < near_edge[i] - OUTLINE_CONTRAST
    ]
    assert white_then_black, "expected a white line inside the crop edge and a black one outside"


def lightness_at(image: Image.Image, xy: tuple[int, int]) -> float:
    pixel = image.getpixel(xy)
    assert isinstance(pixel, tuple)
    return sum(pixel) / len(pixel)
