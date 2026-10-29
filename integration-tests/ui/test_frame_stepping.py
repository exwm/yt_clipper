"""Frame stepping: on a site that reports no frame rate, Shift+Mousewheel steps one frame of the
video, at the rate measured from played frames. The dev site's test video is 30 fps."""

import json
import math

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.paths import REPO
from harness.steps import step

VIDEO_FPS = 30


# Starts on a frame boundary, where a step by one frame duration can show the same frame again.
def test_shift_mousewheel_steps_one_frame_at_a_time_at_the_measured_frame_rate(
    markup: MarkupPage,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks a site that reports no frame rate; YouTube's stats report one")
    given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    when_i_pause_on_a_frame(markup, 90)
    forward = when_i_shift_scroll(markup, "up", times=40)
    backward = when_i_shift_scroll(markup, "down", times=10)
    then_the_frames_shown_are(markup, forward, frames_stepped_to(markup, 90, 40))
    then_the_frames_shown_are(markup, backward, frames_stepped_to(markup, forward[-1], -10))


# Before a rate is measured steps are 1/60 s; at the end Chrome snaps the time to the duration, past
# the last frame, and steps back must still leave the last frame.
def test_shift_mousewheel_steps_back_from_the_end_of_the_video(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the 60 fps default of a site that reports no frame rate")
    duration = markup.page.evaluate("() => document.querySelector('video').duration")
    markup.seek(duration - 0.12, presented=True)
    forward = when_i_shift_scroll(markup, "up", times=8)
    backward = when_i_shift_scroll(markup, "down", times=3)
    then_the_last_frame_was_reached_and_left(
        markup, forward, backward, math.ceil(duration * VIDEO_FPS) - 1
    )


# On YouTube the measured rate refines the stats rate, whatever the video's rate.
@pytest.mark.platform
def test_the_measured_frame_rate_flashes_once_the_video_plays(markup: MarkupPage) -> None:
    skip_with_measurement_off(markup)
    rate = f"{VIDEO_FPS} fps." if markup.host == DEV_SITE_HOST else ""
    with markup.untraced():
        given_the_video_is_playing(markup)
        then_a_flash_says(markup, f"Measured the frame rate: {rate}")


def test_the_command_palette_turns_frame_rate_measurement_off(markup: MarkupPage) -> None:
    skip_with_measurement_off(markup)
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the 60 fps default of a site that reports no frame rate")
    when_i_run_the_palette_command(markup, "frame rate measurement")
    then_a_flash_says(markup, "Frame rate measurement off. Using 60 fps.")


def test_the_measure_button_beside_the_frame_rate_turns_measurement_off_and_on(
    markup: MarkupPage,
) -> None:
    skip_with_measurement_off(markup)
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the 60 fps default of a site that reports no frame rate")
    given_the_global_settings_editor_is_open(markup)
    then_the_frame_rate_reads(markup, "60 fps (assumed)", measuring=True)
    when_i_click_the_measure_button(markup)
    then_a_flash_says(markup, "Frame rate measurement off. Using 60 fps.")
    then_the_frame_rate_reads(markup, "60 fps (assumed)", measuring=False)
    when_i_click_the_measure_button(markup)
    then_the_frame_rate_reads(markup, "60 fps (assumed)", measuring=True)


def skip_with_measurement_off(markup: MarkupPage) -> None:
    if markup.assumed_frame_rate:
        pytest.skip("starts with frame rate measurement on; this run turns it off")


@step
def given_the_global_settings_editor_is_open(markup: MarkupPage) -> None:
    markup.press("KeyW")
    markup.page.wait_for_selector("#global-frame-rate")


@step
def when_i_click_the_measure_button(markup: MarkupPage) -> None:
    markup.page.click("#global-frame-rate-toggle")
    markup.next_frames()


@step
def then_the_frame_rate_reads(markup: MarkupPage, text: str, measuring: bool) -> None:
    markup.shot("frame-rate")
    assert markup.page.inner_text("#global-frame-rate") == text
    classes = markup.page.get_attribute("#global-frame-rate-toggle", "class") or ""
    assert ("active" in classes.split()) == measuring


# The previews apply a pair's own settings on all its frames, its end marker's frame included, and
# drop them outside, also after stepping off a boundary frame and back.
@pytest.mark.parametrize("measured", [True, False], ids=["measured rate", "assumed 60 fps"])
# Markers at frame starts, as placed now, or late in their frames, as older files and drags store them.
@pytest.mark.parametrize("into_frame", [0, 0.7], ids=["frame starts", "mid-frame markers"])
def test_previews_follow_the_pairs_frames_across_steps_off_its_first_and_last_frames(
    markup: MarkupPage, measured: bool, into_frame: float, request: pytest.FixtureRequest
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test video frame times")
    # --assumed-frame-rate keeps the rate assumed in the measured variant too.
    if into_frame and (not measured or markup.assumed_frame_rate):
        # A half-frame grid can't tell whether a mid-frame marker is in the frame on screen or the next,
        # and the playhead here is before the start marker's time, which 5.48 also read as outside.
        reason = "a mid-frame marker's frame is unknown until the rate is measured"
        request.applymarker(pytest.mark.xfail(strict=True, reason=reason))
    if measured:
        given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    markup.load_saved_marker_pairs(
        [
            {
                "start": (90 + into_frame) / VIDEO_FPS,
                "end": (180 + into_frame) / VIDEO_FPS,
                "speed": 0.5,
                "crop": "0:0:iw:ih",
                "overrides": {"gamma": 2},
            }
        ]
    )
    markup.press("KeyC")
    markup.press("Alt+KeyC")
    for inside, outside, direction in [(90, 89, "down"), (180, 181, "up")]:
        markup.seek((inside + 0.5) / VIDEO_FPS, presented=True)
        then_the_previews_are(markup, inside, applied=True)
        when_i_step_to_the_next_frame(markup, direction)
        then_the_previews_are(markup, outside, applied=False)
        when_i_step_to_the_next_frame(markup, "up" if direction == "down" else "down")
        then_the_previews_are(markup, inside, applied=True)


@step
def when_i_step_to_the_next_frame(markup: MarkupPage, direction: str) -> None:
    """Shift+scroll until the video shows another frame: at the assumed 60 fps a step on a 30 fps
    video can move half a frame."""
    start = math.floor(markup.current_time() * VIDEO_FPS)
    for _ in range(3):
        when_i_shift_scroll(markup, direction, times=1)
        if math.floor(markup.current_time() * VIDEO_FPS) != start:
            return


@step
def then_the_previews_are(markup: MarkupPage, frame: int, applied: bool) -> None:
    markup.next_frames(3)
    state = markup.page.evaluate(
        "() => { const v = document.querySelector('video');"
        " return { time: v.currentTime, filter: v.style.filter, rate: v.playbackRate }; }"
    )
    markup.report(f"frame {frame}: {state}")
    assert math.floor(state["time"] * VIDEO_FPS) == frame
    assert ("gamma-filter" in state["filter"]) == applied
    assert state["rate"] == (0.5 if applied else 1)


def frames_per_step(markup: MarkupPage) -> float:
    """A step moves one frame at the measured rate, and 1/60 s at the assumed 60 fps (half a frame of
    the 30 fps test video), as 5.48 stepped on sites that report no rate."""
    return VIDEO_FPS / 60 if markup.assumed_frame_rate else 1


def frames_stepped_to(markup: MarkupPage, start: int, steps: int) -> list[int]:
    """The frame shown after each of `steps` steps (negative: back) from frame `start`."""
    direction = 1 if steps > 0 else -1
    per_step = frames_per_step(markup)
    # Forward from a frame's start, a half-frame step stays in it first. Back from where forward steps
    # left the playhead (the first half of its frame), the first one leaves it.
    rounding = math.floor if steps > 0 else math.ceil
    return [start + direction * rounding(k * per_step) for k in range(1, abs(steps) + 1)]


# A pair's loop plays through its end marker's frame and seeks back before the frame after it shows,
# also on a 24 fps video, whose frames a 60 fps grid doesn't split evenly.
@pytest.mark.parametrize(
    "fps",
    [pytest.param(24, marks=pytest.mark.video_style("testsrc24")), 30],
    ids=["24 fps", "30 fps"],
)
@pytest.mark.parametrize("measured", [True, False], ids=["measured rate", "assumed 60 fps"])
# A mid-frame end marker, as 5.48 placed them and drags still do. At an assumed rate its frame is
# unknown, so the loop may show the frame after it on some cycles, no more than 5.48 (3 of 19 at 24 fps).
@pytest.mark.parametrize(
    ("end_into_frame", "most_cycles_past_end_assumed"),
    [(0, 0), (0.5, 0.25)],
    ids=["frame start end", "mid-frame end"],
)
def test_a_pairs_loop_never_shows_the_frame_after_its_end_marker(
    markup: MarkupPage,
    request: pytest.FixtureRequest,
    measured: bool,
    fps: int,
    end_into_frame: float,
    most_cycles_past_end_assumed: float,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test videos")
    is_measured = measured and not markup.assumed_frame_rate
    most_cycles_past_end = 0 if is_measured else most_cycles_past_end_assumed
    if end_into_frame and fps == 30 and not is_measured:
        request.applymarker(
            pytest.mark.xfail(
                strict=True,
                reason="at the assumed 60 fps the frame after a mid-frame end shows each cycle, as in 5.48",
            )
        )
    if measured:
        markup.measure_frame_rate()
    end = (66 + end_into_frame) / fps
    markup.load_saved_marker_pairs([{"start": 60 / fps, "end": end, "crop": "0:0:iw:ih"}])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    shown = when_the_loop_plays(markup, fps, seconds=4)
    markup.report(f"frames shown {shown}")
    assert shown
    assert min(shown) >= 60
    assert max(shown) <= 67
    assert 66 in shown
    cycles = sum(1 for frame, next_frame in zip(shown, shown[1:]) if next_frame < frame)
    assert shown.count(67) <= most_cycles_past_end * cycles


# The loop turns back while its end frame shows, and should hold it the whole refreshes a frame lasts
# on this display, which every frame holds at least: 2 at 60 Hz for 24 or 30 fps. Headless Chrome
# sometimes runs at about 57 Hz, where a 30 fps frame may hold 1.
@pytest.mark.parametrize(
    "fps",
    [pytest.param(24, marks=pytest.mark.video_style("testsrc24")), 30],
    ids=["24 fps", "30 fps"],
)
def test_a_pairs_loop_shows_its_end_frame_for_about_its_full_time(
    markup: MarkupPage, fps: int, browser_name: str
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test videos")
    if browser_name == "firefox":
        pytest.skip(
            "Firefox reads no frame times from VideoFrame, so the loop turns back at once, as 5.48"
        )
    if markup.assumed_frame_rate:
        pytest.skip("checks the measured rate")
    markup.measure_frame_rate()
    markup.load_saved_marker_pairs([{"start": 60 / fps, "end": 66 / fps, "crop": "0:0:iw:ih"}])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    held, refresh_ms = when_the_loop_plays_by_refresh(markup, fps, seconds=4)
    runs = held_runs(held)
    end_frame = [refreshes for frame, refreshes, after in runs if frame == 66 and after < 66]
    played = [
        refreshes for frame, refreshes, after in runs if 60 < frame < 66 and after == frame + 1
    ]
    whole_refreshes = math.floor(1000 / fps / refresh_ms + 0.02)
    markup.report(f"refresh {refresh_ms:.2f} ms, whole refreshes a frame {whole_refreshes}")
    markup.report(f"end frame refreshes per turn {end_frame}")
    markup.report(f"played frame refreshes {played}")
    if whole_refreshes < 2:
        pytest.skip(f"the display ran at {1000 / refresh_ms:.0f} Hz, under 2 refreshes a frame")
    assert len(end_frame) >= 10
    assert min(end_frame) >= whole_refreshes


def display_rate_case(
    hz: int, fps: int, end_frame_refreshes: int, *marks: pytest.MarkDecorator
) -> "pytest.ParameterSet":
    style = [pytest.mark.video_style("testsrc24")] if fps == 24 else []
    return pytest.param(
        hz,
        fps,
        end_frame_refreshes,
        marks=[pytest.mark.display_rate(hz), *style, *marks],
        id=f"{hz} Hz {fps} fps",
    )


# Under 2 refreshes a frame, but not exactly 1, the loop seeks back as the end frame shows, and on some
# cycles the seek takes longer than the rest of that frame. The gate never holds there: it is the same
# with the gate off.
SEEK_OUTLASTS_END_FRAME = pytest.mark.xfail(
    strict=True,
    reason="the loop turns back as the end frame shows, and on some cycles the next frame shows first",
)
# Display Hz, video fps, and the refreshes the end frame should hold at least: the whole refreshes a
# frame lasts when 2 or more, else 1. Chromium's cadence gives every frame at least these
# (display-cadences.json).
DISPLAY_RATE_CASES = [
    display_rate_case(30, 24, 1, SEEK_OUTLASTS_END_FRAME),
    display_rate_case(30, 30, 1),
    display_rate_case(50, 24, 2),
    display_rate_case(50, 30, 1, SEEK_OUTLASTS_END_FRAME),
    display_rate_case(120, 24, 5),
    display_rate_case(120, 30, 4),
    display_rate_case(144, 24, 6),
    display_rate_case(144, 30, 4),
]


# The end frame gate on displays other than 60 Hz, simulated in chromium-headless-shell: the loop
# holds its end frame the refreshes a frame holds there, and never shows the frame after it.
@pytest.mark.parametrize(("hz", "fps", "end_frame_refreshes"), DISPLAY_RATE_CASES)
def test_a_pairs_loop_holds_its_end_frame_and_never_the_next_on_other_display_rates(
    markup: MarkupPage, hz: int, fps: int, end_frame_refreshes: int
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test videos")
    if markup.assumed_frame_rate:
        pytest.skip("checks the measured rate")
    markup.measure_frame_rate()
    markup.load_saved_marker_pairs([{"start": 60 / fps, "end": 66 / fps, "crop": "0:0:iw:ih"}])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    held, refresh_ms = when_the_loop_plays_by_refresh(markup, fps, seconds=4)
    end_frame = [
        refreshes for frame, refreshes, after in held_runs(held) if frame == 66 and after < 66
    ]
    markup.report(f"refresh {refresh_ms:.2f} ms, end frame refreshes per turn {end_frame}")
    markup.report(f"refreshes past the end {held.count(67)}")
    assert refresh_ms == pytest.approx(1000 / hz, abs=0.2)
    assert max(1, math.floor(1000 / fps / refresh_ms + 0.02)) == end_frame_refreshes
    assert min(held) >= 60
    assert 67 not in held
    assert len(end_frame) >= 10
    assert min(end_frame) >= end_frame_refreshes


@pytest.mark.parametrize(
    ("hz", "fps", "end_frame_refreshes"),
    [pytest.param(*case.values, id=case.id) for case in DISPLAY_RATE_CASES],
)
def test_the_end_frame_refreshes_expected_are_the_fewest_in_chromiums_cadence(
    hz: int, fps: int, end_frame_refreshes: int
) -> None:
    cadences = json.loads((REPO / "src/markup/util/display-cadences.json").read_text())
    [held] = [
        cadence["afterReset"] + cadence["playing"]
        for cadence in cadences
        if cadence["hz"] == hz and cadence["fps"] == fps
    ]
    assert min(held) == end_frame_refreshes


@step
def when_the_loop_plays_by_refresh(
    markup: MarkupPage, fps: int, seconds: float
) -> tuple[list[int], float]:
    """The frame the video holds at each refresh while it plays (a VideoFrame read per animation
    frame), from the first time it shows the pair's first frame, and the median refresh (ms)."""
    markup.seek(60.5 / fps, presented=True)
    with markup.untraced():
        rows = markup.page.evaluate(
            """async (seconds) => {
                const v = document.querySelector('video');
                const rows = [];
                let on = true;
                const onRefresh = (now) => {
                    const frame = new VideoFrame(v);
                    rows.push([now, frame.timestamp / 1e6]);
                    frame.close();
                    if (on) requestAnimationFrame(onRefresh);
                };
                await v.play();
                requestAnimationFrame(onRefresh);
                await new Promise((done) => setTimeout(done, seconds * 1000));
                on = false;
                v.pause();
                return rows;
            }""",
            seconds,
        )
    gaps = sorted(b[0] - a[0] for a, b in zip(rows, rows[1:]))
    return [math.floor(time * fps + 0.02) for _, time in rows], gaps[len(gaps) // 2]


def held_runs(held: list[int]) -> list[tuple[int, int, int]]:
    """Each run of one frame held: the frame, its refreshes, and the frame held after it."""
    runs, run = [], 1
    for frame, after in zip(held, held[1:]):
        if after == frame:
            run += 1
            continue
        runs.append((frame, run, after))
        run = 1
    return runs


@step
def when_the_loop_plays(markup: MarkupPage, fps: int, seconds: float) -> list[int]:
    """The frames shown while the video plays, from the first time it shows the pair's first frame."""
    markup.seek(60.5 / fps, presented=True)
    times = markup.page.evaluate(
        """async (seconds) => {
            const v = document.querySelector('video');
            const times = [];
            const onFrame = (_now, meta) => { times.push(meta.mediaTime); v.requestVideoFrameCallback(onFrame); };
            v.requestVideoFrameCallback(onFrame);
            await v.play();
            await new Promise((done) => setTimeout(done, seconds * 1000));
            v.pause();
            return times;
        }""",
        seconds,
    )
    return [math.floor(time * fps + 0.02) for time in times]


@step
def when_i_run_the_palette_command(markup: MarkupPage, search: str) -> None:
    markup.page.click("#shortcutsTableToggleButton")
    markup.page.keyboard.type(search)
    markup.press("Enter")


@step
def then_a_flash_says(markup: MarkupPage, message: str) -> None:
    markup.page.get_by_text(message).first.wait_for(timeout=5000)
    markup.shot("flash")


@step
def given_the_video_is_playing(markup: MarkupPage) -> None:
    markup.seek(2, presented=True)
    markup.play()


# Waits for the measurement itself: a fixed stretch of playback can hold too few frames in a row,
# after Chrome's periodic dropped frames or a late start of the markup.
@step
def given_the_video_has_played_until_its_frame_rate_is_measured(markup: MarkupPage) -> None:
    markup.seek(2, presented=True)
    if markup.assumed_frame_rate:
        return
    with markup.untraced():
        markup.play()
        markup.page.get_by_text(f"Measured the frame rate: {VIDEO_FPS} fps.").first.wait_for(
            timeout=5000
        )
        markup.pause()


@step
def when_i_pause_on_a_frame(markup: MarkupPage, frame: int) -> None:
    markup.seek(frame / VIDEO_FPS, presented=True)


@step
def when_i_shift_scroll(markup: MarkupPage, direction: str, times: int) -> list[int]:
    """The frame each step shows. The test video's frame n starts at exactly n / 30 s, so a seek
    shows frame floor(playhead * 30); a playhead on a boundary can show either neighbor, which is
    what the floor of a target like 91 / 30 = 3.0333... (frame 90.999...) reveals. (Headless Chrome
    presents a paused video's frame only when the page next renders, so frame callbacks lag.)"""
    markup.page.mouse.move(*markup.center_of("video"))
    frames = []
    for _ in range(times):
        markup.page.keyboard.down("Shift")
        markup.page.mouse.wheel(0, -100 if direction == "up" else 100)
        markup.page.keyboard.up("Shift")
        markup.next_frames(2)
        frames.append(math.floor(markup.current_time() * VIDEO_FPS))
    return frames


@step
def then_the_frames_shown_are(markup: MarkupPage, shown: list[int], expected: list[int]) -> None:
    markup.report(f"frames shown {shown}")
    assert shown == expected


@step
def then_the_last_frame_was_reached_and_left(
    markup: MarkupPage, forward: list[int], backward: list[int], last_frame: int
) -> None:
    markup.report(f"forward {forward}, backward {backward}")
    # At the end the time is the duration, which reads as the frame after the last.
    assert min(forward[-1], last_frame) == last_frame
    assert backward[-1] < last_frame
