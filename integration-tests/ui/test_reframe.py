"""Reframe (V): the preview fills the whole player, keeps up with playback on a busy machine, and the
navigator minimap outlines the crop in two tones so it shows on light and dark video."""

import io

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step
from PIL import Image
from test_crop_easing import when_i_save_the_markers
from test_hold_crop_points import CROP_A, CROP_B, pair

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

# A busy machine: Chrome runs the page's main thread this many times slower. How many frames that
# skips depends on how fast the host is at the moment, so reframe is compared with the same playback
# without it. Over these seconds of the 30 fps test video, reframe skipped 3 to 14 frames more while
# it laid out the hidden crop overlay every frame, and 0 to 3 more since.
BUSY_CPU_SLOWDOWN = 10
BUSY_PLAYBACK_SECONDS = 5
MAX_EXTRA_SKIPPED_FRAMES = 4


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


def test_ctrl_alt_a_on_a_crop_point_toggles_hold_while_reframed(markup: MarkupPage) -> None:
    # Reframed with the crop chart closed: the crop is dynamic, so the shortcut still works.
    given_a_dynamic_crop_reframed(markup)
    when_i_press_ctrl_alt_a_at(markup, 6)
    then_the_saved_middle_point_is(markup, hold=True, crop=CROP_A)
    when_i_press_ctrl_alt_a_at(markup, 6)
    then_the_saved_middle_point_is(markup, hold=False, crop=CROP_B)


def test_reframe_keeps_up_with_playback_on_a_busy_machine(markup: MarkupPage) -> None:
    given_a_dynamic_crop(markup)
    skipped_without_reframe = when_it_plays_on_a_busy_machine(markup)
    given_reframe_is_on(markup)
    skipped_with_reframe = when_it_plays_on_a_busy_machine(markup)
    then_reframe_skips_about_as_few_frames(markup, skipped_without_reframe, skipped_with_reframe)


# ─── given ──────────────────────────────────────────────────────────────────


@step
def given_a_dynamic_crop(markup: MarkupPage) -> None:
    markup.load_saved_marker_pairs([pair((CROP_A, False), (CROP_B, False), (CROP_A, False))])
    markup.open_marker_pair(0)


@step
def given_a_dynamic_crop_reframed(markup: MarkupPage) -> None:
    given_a_dynamic_crop(markup)
    given_reframe_is_on(markup)


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


# ─── when ───────────────────────────────────────────────────────────────────


@step
def when_i_press_ctrl_alt_a_at(markup: MarkupPage, seconds: float) -> None:
    markup.seek(seconds, presented=True)
    markup.press("Control+Alt+KeyA")


@step
def when_it_plays_on_a_busy_machine(markup: MarkupPage) -> int:
    """Play through the crop pan with the CPU throttled and count the presented frames that no frame
    callback ran for: reframe draws in one, so it never drew those."""
    markup.seek(3.2, presented=True)
    markup.play()
    # Throttle once playback has settled, so the count is not about starting to play.
    assert markup.eventually("() => document.querySelector('video').currentTime > 3.5")
    cdp = markup.page.context.new_cdp_session(markup.page)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": BUSY_CPU_SLOWDOWN})
    try:
        presented = markup.page.evaluate(
            """(seconds) => new Promise((resolve) => {
              const video = document.querySelector('video');
              const frames = [];
              let end = 0;
              const onFrame = (now, metadata) => {
                end ||= now + seconds * 1000;
                frames.push(metadata.presentedFrames);
                if (now < end) video.requestVideoFrameCallback(onFrame);
                else resolve(frames);
              };
              video.requestVideoFrameCallback(onFrame);
            })""",
            BUSY_PLAYBACK_SECONDS,
        )
        markup.pause()
    finally:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    skipped = sum(max(0, b - a - 1) for a, b in zip(presented, presented[1:], strict=False))
    markup.report(f"{presented[-1] - presented[0]} frames presented, {skipped} skipped")
    return skipped


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_the_saved_middle_point_is(markup: MarkupPage, hold: bool, crop: str) -> None:
    point = when_i_save_the_markers(markup)["markerPairs"][0]["cropMap"][1]
    markup.report(f"saved middle crop point {point}")
    assert point.get("hold", False) == hold
    assert point["crop"] == crop


@step
def then_reframe_skips_about_as_few_frames(markup: MarkupPage, without: int, with_reframe: int) -> None:
    markup.report(f"skipped frames: {without} without reframe, {with_reframe} with it")
    assert with_reframe - without <= MAX_EXTRA_SKIPPED_FRAMES


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
