"""Reframe (V): the preview fills the whole player, draws every frame the video shows on a busy
machine, and the navigator minimap outlines the crop in two tones so it shows on light and dark video."""

import io
import re
from collections.abc import Generator
from contextlib import contextmanager

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step
from PIL import Image
from playwright.sync_api import ConsoleMessage
from test_crop_easing import when_i_save_the_markers
from test_feature_flags import when_i_open_the_feature_flags_popup
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

# A busy machine: Chrome runs the page's main thread this many times slower. A frame the video shows
# only between two refreshes the page gets to run is gone before anything can draw it, and how many
# that is depends on how loaded the host is at the moment: reframe drew 48 to 60 of 60 per 2 s with
# the UI tests running in parallel. So reframe is compared with a plain loop that notes each frame it
# can see on every refresh, running alongside reframe in the same window, so both meet the same load
# (measured one after the other, the loads differed by up to 14 points). Reframe's share of the
# frames the video showed (decoded minus dropped) must come within MAX_SHARE_BELOW_PLAIN_LOOP of the
# plain loop's: 1 to 4 points below it in practice. A loop that falls far behind fails it (20% drawn
# in one bug). Throttled headless Chrome does not reproduce requestVideoFrameCallback's skipped
# frames, so this does not catch that.
BUSY_CPU_SLOWDOWN = 10
BUSY_SETTLE_SECONDS = 2.1
BUSY_MEASURED_SECONDS = 3.3
MAX_SHARE_BELOW_PLAIN_LOOP = 0.05
FRAME_LOOP_STATS = re.compile(
    r"\[yt_clipper frame loop\].*\breframe\b.*? (\d+) new frames, video showed (\d+)"
)

# The dev site's test video, whose frame counter makes every frame's pixels differ.
VIDEO_FPS = 30
PAUSED_SEEK_SECONDS = 4
PREVIEW_CANVASES = ("#ytc-reframe-canvas", "#ytc-zoom-canvas")


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


def test_reframe_and_the_modal_preview_draw_each_frame_a_paused_seek_shows(
    reframed: MarkupPage,
) -> None:
    # While paused the previews draw only when a seek or frame step shows a new frame.
    when_i_open_the_modal_crop_preview(reframed)
    when_i_pause_on(reframed, PAUSED_SEEK_SECONDS, "before")
    when_i_pause_on(reframed, PAUSED_SEEK_SECONDS + 1 / VIDEO_FPS, "stepped")
    when_i_pause_on(reframed, PAUSED_SEEK_SECONDS, "back")
    then_each_preview_drew_the_new_frame_and_then_the_first_again(reframed)


@pytest.mark.local_build
@pytest.mark.alone
def test_reframe_draws_as_many_frames_as_a_plain_loop_sees_on_a_busy_machine(
    markup: MarkupPage,
) -> None:
    given_a_dynamic_crop(markup)
    given_the_frame_loop_stats_are_on(markup)
    given_reframe_is_on(markup)
    plain_loop, reframe = when_reframe_and_a_plain_page_loop_count_frames_on_a_busy_machine(markup)
    then_reframe_drew_about_as_many_frames_as_the_plain_loop(markup, plain_loop, reframe)


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
def when_i_open_the_modal_crop_preview(markup: MarkupPage) -> None:
    markup.press("Control+Alt+KeyX")
    markup.page.wait_for_selector("#ytc-zoom-canvas", state="visible")


@step
def when_i_pause_on(markup: MarkupPage, seconds: float, name: str) -> None:
    """Seek while paused, and keep the pixels each preview canvas draws for the frame under `name`."""
    markup.pause()
    markup.seek(seconds, presented=True)
    markup.next_frames(3)
    markup.page.evaluate(
        """([selectors, name]) => {
          window.__ytcPreviewPixels ??= {};
          window.__ytcPreviewPixels[name] = selectors.map((selector) => {
            const canvas = document.querySelector(selector);
            return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          });
        }""",
        [list(PREVIEW_CANVASES), name],
    )


def changed_share(markup: MarkupPage, first: str, second: str) -> list[float]:
    """For each preview canvas, the share of its color values that differ by more than color rounding
    between two kept draws: about 0 for the same frame drawn twice."""
    return markup.page.evaluate(
        """([first, second]) => window.__ytcPreviewPixels[first].map((a, i) => {
          const b = window.__ytcPreviewPixels[second][i];
          if (a.length !== b.length) return 1;
          let changed = 0;
          for (let k = 0; k < a.length; k++) if (Math.abs(a[k] - b[k]) > 2) changed++;
          return changed / a.length;
        })""",
        [first, second],
    )


@step
def given_the_frame_loop_stats_are_on(markup: MarkupPage) -> None:
    # Through the feature flags popup, which local builds have.
    when_i_open_the_feature_flags_popup(markup)
    markup.page.check("#ytc-feature-flags-popover label:has-text('videoFrameLoopStats') input")
    markup.page.keyboard.press("Escape")


@contextmanager
def playing_on_a_busy_machine(markup: MarkupPage) -> Generator[None]:
    """Play through the crop pan, throttle the CPU once playback has settled (so nothing measured is
    about starting to play), wait BUSY_SETTLE_SECONDS, and yield while it plays throttled."""
    markup.seek(3.2, presented=True)
    markup.play()
    assert markup.eventually("() => document.querySelector('video').currentTime > 3.5")
    cdp = markup.page.context.new_cdp_session(markup.page)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": BUSY_CPU_SLOWDOWN})
    try:
        markup.page.wait_for_timeout(BUSY_SETTLE_SECONDS * 1000)
        yield
        markup.pause()
    finally:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})


# A page loop that notes the frame the video holds on every refresh, until it is stopped: the frames
# a plain page loop sees, measured in the same window as reframe so both share one machine load.
START_PLAIN_LOOP = """() => {
  const video = document.querySelector('video');
  const shown = () => {
    const q = video.getVideoPlaybackQuality();
    return q.totalVideoFrames - q.droppedVideoFrames;
  };
  const seen = new Set();
  const shownAtStart = shown();
  let running = true;
  const tick = () => {
    try {
      const frame = new VideoFrame(video);
      seen.add(frame.timestamp);
      frame.close();
    } catch {}
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__ytcStopPlainLoop = () => {
    running = false;
    return [seen.size, shown() - shownAtStart];
  };
}"""


@step
def when_reframe_and_a_plain_page_loop_count_frames_on_a_busy_machine(
    markup: MarkupPage,
) -> tuple[tuple[int, int], tuple[int, int]]:
    """Returns (frames seen, frames shown) for a plain page loop, and (new frames drawn, frames
    shown) for reframe, over the stats windows logged while throttled (the first one, which began
    before throttling, left out)."""
    windows: list[tuple[int, int]] = []
    measuring = False

    def on_console(message: ConsoleMessage) -> None:
        match = FRAME_LOOP_STATS.search(message.text)
        if match and measuring:
            windows.append((int(match[1]), int(match[2])))

    markup.page.on("console", on_console)
    try:
        with playing_on_a_busy_machine(markup):
            measuring = True
            markup.page.evaluate(START_PLAIN_LOOP)
            markup.page.wait_for_timeout(BUSY_MEASURED_SECONDS * 1000)
            plain = markup.page.evaluate("() => window.__ytcStopPlainLoop()")
    finally:
        markup.page.remove_listener("console", on_console)
    markup.report(
        f"plain loop (seen, shown): {plain}, reframe stats windows (drawn, shown): {windows}"
    )
    assert windows, "no frame loop stats were logged while throttled"
    return (plain[0], plain[1]), (sum(w[0] for w in windows), sum(w[1] for w in windows))


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_the_saved_middle_point_is(markup: MarkupPage, hold: bool, crop: str) -> None:
    point = when_i_save_the_markers(markup)["markerPairs"][0]["cropMap"][1]
    markup.report(f"saved middle crop point {point}")
    assert point.get("hold", False) == hold
    assert point["crop"] == crop


@step
def then_each_preview_drew_the_new_frame_and_then_the_first_again(markup: MarkupPage) -> None:
    stepped = changed_share(markup, "before", "stepped")
    back = changed_share(markup, "before", "back")
    markup.report(f"changed by the step {stepped}, after stepping back {back}")
    for canvas, step_change, back_change in zip(PREVIEW_CANVASES, stepped, back, strict=True):
        # The frame counter alone changes far more than this.
        assert step_change > 0.001, f"{canvas} still shows the frame before the step"
        assert back_change < 0.0001, f"{canvas} does not show the first frame after stepping back"


@step
def then_reframe_drew_about_as_many_frames_as_the_plain_loop(
    markup: MarkupPage, plain_loop: tuple[int, int], reframe: tuple[int, int]
) -> None:
    (seen, plain_shown), (drawn, reframe_shown) = plain_loop, reframe
    assert plain_shown > 0, "the video showed no frames to the plain loop"
    assert reframe_shown > 0, "the video showed no frames to reframe"
    plain_share, reframe_share = seen / plain_shown, drawn / reframe_shown
    markup.report(
        f"plain loop saw {plain_share:.0%} of the frames shown, reframe drew {reframe_share:.0%}"
    )
    assert reframe_share >= plain_share - MAX_SHARE_BELOW_PLAIN_LOOP, (
        f"reframe drew {drawn} of {reframe_shown} frames, a plain loop saw {seen} of {plain_shown}"
    )


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
