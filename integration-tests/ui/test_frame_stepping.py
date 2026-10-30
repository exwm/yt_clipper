"""Frame stepping: on a site that reports no frame rate, Shift+Mousewheel steps one frame of the
video, at the rate measured from played frames. The dev site's test video is 30 fps."""

import json
import math
import statistics

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


# Paused from playing, Chrome can hold a frame that starts after the playhead (10.7667 held at
# 10.7293): a step moves from the frame shown.
@pytest.mark.parametrize("direction", ["up", "down"], ids=["forward", "back"])
def test_shift_mousewheel_right_after_pausing_steps_from_the_frame_shown(
    markup: MarkupPage, direction: str
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test video frame times")
    given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    steps = 1 if direction == "up" else -1
    for trial in range(3):
        held = when_i_play_and_pause(markup, play_ms=300 + 70 * trial)
        stepped = when_i_shift_scroll(markup, direction, times=1)
        then_the_frames_shown_are(markup, stepped, frames_stepped_to(markup, held, steps))


@step
def when_i_play_and_pause(markup: MarkupPage, play_ms: int) -> int:
    """The frame held once paused, read as Chrome holds it rather than from the playhead."""
    markup.play()
    markup.page.wait_for_timeout(play_ms)
    markup.pause()
    markup.next_frames(3)
    state = markup.page.evaluate(
        "() => { const v = document.querySelector('video'); const f = new VideoFrame(v);"
        " const held = f.timestamp / 1e6; f.close(); return { held, time: v.currentTime }; }"
    )
    markup.report(f"paused: {state}")
    # A frame start, rounded to the microsecond.
    return round(state["held"] * VIDEO_FPS)


# With Measure off steps are 1/60 s; at the end Chrome snaps the time to the duration, past
# the last frame, and steps back must still leave the last frame.
def test_shift_mousewheel_steps_back_from_the_end_of_the_video(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the 60 fps default of a site that reports no frame rate")
    given_the_frame_rate_is(markup, measured=False)
    duration = markup.page.evaluate("() => document.querySelector('video').duration")
    markup.seek(duration - 0.12, presented=True)
    forward = when_i_shift_scroll(markup, "up", times=8)
    backward = when_i_shift_scroll(markup, "down", times=3)
    then_the_last_frame_was_reached_and_left(
        markup, forward, backward, math.ceil(duration * VIDEO_FPS) - 1
    )


# On YouTube the measured rate refines the stats rate, whatever the video's rate.
@pytest.mark.platform
@pytest.mark.measured_rate
def test_the_measured_frame_rate_flashes_once_the_video_plays(markup: MarkupPage) -> None:
    rate = f"{VIDEO_FPS} fps." if markup.host == DEV_SITE_HOST else ""
    with markup.untraced():
        given_the_video_is_playing(markup)
        then_a_flash_says(markup, f"Measured the frame rate: {rate}")


@pytest.mark.measured_rate
def test_the_command_palette_turns_frame_rate_measurement_off(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the 60 fps default of a site that reports no frame rate")
    when_i_run_the_palette_command(markup, "frame rate measurement")
    then_a_flash_says(markup, "Frame rate measurement off. Using 60 fps.")


@pytest.mark.measured_rate
def test_the_measure_button_beside_the_frame_rate_turns_measurement_off_and_on(
    markup: MarkupPage,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the 60 fps default of a site that reports no frame rate")
    given_the_global_settings_editor_is_open(markup)
    then_the_frame_rate_reads(markup, "60 fps (assumed)", measuring=True)
    when_i_click_the_measure_button(markup)
    then_a_flash_says(markup, "Frame rate measurement off. Using 60 fps.")
    then_the_frame_rate_reads(markup, "60 fps (assumed)", measuring=False)
    when_i_click_the_measure_button(markup)
    then_the_frame_rate_reads(markup, "60 fps (assumed)", measuring=True)


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
    if into_frame and not measured:
        # A half-frame grid can't tell whether a mid-frame marker is in the frame on screen or the next,
        # and the playhead here is before the start marker's time, which 5.48 also read as outside.
        reason = "a mid-frame marker's frame is unknown until the rate is measured"
        request.applymarker(pytest.mark.xfail(strict=True, reason=reason))
    if measured:
        given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    else:
        given_the_frame_rate_is(markup, measured=False)
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


# The loop seeks back on its end frame's last refresh, so a slow seek can let the next frame show
# now and then: the maintainer accepted a rare extra frame for an end frame shown its full time.
RARE_CYCLES_PAST_END = 1 / 8


# A pair's loop plays through its end marker's frame and seeks back before the frame after it shows,
# also on a 24 fps video, whose frames a 60 fps grid doesn't split evenly.
@pytest.mark.parametrize(
    "fps",
    [pytest.param(24, marks=pytest.mark.video_style("testsrc24")), 30],
    ids=["24 fps", "30 fps"],
)
@pytest.mark.parametrize("measured", [True, False], ids=["measured rate", "assumed 60 fps"])
# A mid-frame end marker, as 5.48 placed them and drags still do. At an assumed rate its frame is
# unknown, and as in 5.48 the frame after it shows on some or all cycles, by the display's rate and
# phase, so only its end frame is checked there.
@pytest.mark.parametrize(
    ("end_into_frame", "most_cycles_past_end_assumed"),
    [(0, RARE_CYCLES_PAST_END), (0.5, 1)],
    ids=["frame start end", "mid-frame end"],
)
@pytest.mark.timing
def test_a_pairs_loop_never_shows_the_frame_after_its_end_marker(
    markup: MarkupPage,
    measured: bool,
    fps: int,
    end_into_frame: float,
    most_cycles_past_end_assumed: float,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test videos")
    most_cycles_past_end = RARE_CYCLES_PAST_END if measured else most_cycles_past_end_assumed
    given_the_frame_rate_is(markup, measured=measured)
    end =(66 + end_into_frame) / fps
    markup.load_saved_marker_pairs([{"start": 60 / fps, "end": end, "crop": "0:0:iw:ih"}])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    shown = when_the_loop_plays(markup, fps, turns=LOOP_TURNS)
    markup.report(f"frames shown {shown}")
    assert shown
    assert min(shown) >= 60
    assert max(shown) <= 67
    assert 66 in shown
    cycles = sum(1 for frame, next_frame in zip(shown, shown[1:]) if next_frame < frame)
    assert cycles == LOOP_TURNS
    assert shown.count(67) <= most_cycles_past_end * cycles


# The loop turns back while its end frame shows, and should hold it the whole refreshes a frame lasts
# on this display, which every frame holds at least: 2 at 60 Hz for 24 or 30 fps. Headless Chrome
# sometimes runs at about 57 Hz, where a 30 fps frame may hold 1.
@pytest.mark.parametrize(
    "fps",
    [pytest.param(24, marks=pytest.mark.video_style("testsrc24")), 30],
    ids=["24 fps", "30 fps"],
)
@pytest.mark.timing
@pytest.mark.measured_rate
def test_a_pairs_loop_shows_its_end_frame_for_about_its_full_time(
    markup: MarkupPage, fps: int, browser_name: str
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test videos")
    if browser_name == "firefox":
        pytest.skip(
            "Firefox reads no frame times from VideoFrame, so the loop turns back at once, as 5.48"
        )
    markup.measure_frame_rate()
    markup.load_saved_marker_pairs([{"start": 60 / fps, "end": 66 / fps, "crop": "0:0:iw:ih"}])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    held, refresh_ms, _ = when_the_loop_plays_by_refresh(markup, fps, turns=END_FRAME_TURNS)
    runs = held_runs(held)
    end_frame = [refreshes for frame, refreshes, after in runs if frame == 66 and after < 66]
    played = [
        refreshes for frame, refreshes, after in runs if 60 < frame < 66 and after == frame + 1
    ]
    whole_refreshes = math.floor(1000 / fps / refresh_ms + 0.02)
    markup.report(f"refresh {refresh_ms:.2f} ms, whole refreshes a frame {whole_refreshes}")
    markup.report(f"end frame refreshes per turn {end_frame}")
    markup.report(f"played frame refreshes {played}")
    # Under 2 refreshes a frame means the display isn't at 60 Hz (asleep, see the harness warning).
    assert whole_refreshes >= 2, f"the display ran at {1000 / refresh_ms:.0f} Hz; wake it and rerun"
    assert len(end_frame) >= 10
    assert min(end_frame) >= whole_refreshes


# Paused in the end frame's second half, the loop turns back as 5.48 did: played from there, the next
# frame would show at the first refresh, before the loop can turn back.
@pytest.mark.timing
@pytest.mark.measured_rate
def test_a_pairs_loop_played_from_a_pause_on_its_end_frame_never_shows_the_next(
    markup: MarkupPage,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test videos")
    fps = 30
    markup.measure_frame_rate()
    markup.load_saved_marker_pairs([{"start": 60 / fps, "end": 66 / fps, "crop": "0:0:iw:ih"}])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    for _ in range(3):
        held, _, _ = when_the_loop_plays_by_refresh(markup, fps, turns=1, from_frame=66.75)
        markup.report(f"frames shown {held}")
        assert 67 not in held


# A step lands on a frame's middle, so stepping onto the end frame with the loop on stays there.
def test_a_pairs_loop_stays_on_its_end_frame_when_stepped_onto(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test video frame times")
    given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    markup.load_saved_marker_pairs(
        [{"start": 60 / VIDEO_FPS, "end": 66 / VIDEO_FPS, "crop": "0:0:iw:ih"}]
    )
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    markup.seek(65.5 / VIDEO_FPS, presented=True)
    when_i_step_to_the_next_frame(markup, "up")
    markup.next_frames(5)
    then_the_frame_shown_is(markup, 66)


@step
def then_the_frame_shown_is(markup: MarkupPage, frame: int) -> None:
    time = markup.current_time()
    markup.report(f"time {time}")
    assert math.floor(time * VIDEO_FPS) == frame


def display_rate_case(
    hz: int,
    fps: int,
    end_frame_refreshes: int,
    *marks: pytest.MarkDecorator,
    measured: bool = True,
) -> "pytest.ParameterSet":
    style = [pytest.mark.video_style("testsrc24")] if fps == 24 else []
    return pytest.param(
        hz,
        fps,
        measured,
        end_frame_refreshes,
        marks=[pytest.mark.display_rate(hz), *style, *marks],
        id=f"{hz} Hz {fps} fps" + ("" if measured else " assumed rate"),
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
# (display-cadences.json). Jest pins the other rates over the same code.
DISPLAY_RATE_CASES = [
    display_rate_case(30, 24, 1, SEEK_OUTLASTS_END_FRAME),
    display_rate_case(30, 30, 1),
    display_rate_case(50, 24, 2),
    display_rate_case(120, 24, 5),
    display_rate_case(144, 30, 4),
    # Before the rate is measured (or with Measure off) the frame's own duration, where the browser
    # reports it, times the end frame.
    display_rate_case(120, 24, 5, measured=False),
]


# The end frame gate on displays other than 60 Hz, simulated in chromium-headless-shell: the loop
# holds its end frame for the refreshes a frame holds there, and never shows the frame after it.
@pytest.mark.parametrize(("hz", "fps", "measured", "end_frame_refreshes"), DISPLAY_RATE_CASES)
def test_a_pairs_loop_holds_its_end_frame_and_never_the_next_on_other_display_rates(
    markup: MarkupPage, hz: int, fps: int, measured: bool, end_frame_refreshes: int
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test videos")
    given_the_frame_rate_is(markup, measured=measured)
    markup.load_saved_marker_pairs([{"start": 60 / fps, "end": 66 / fps, "crop": "0:0:iw:ih"}])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    held, refresh_ms, refreshed_at = when_the_loop_plays_by_refresh(
        markup, fps, turns=END_FRAME_TURNS
    )
    end_frame_ms = [
        ms for frame, ms, after in shown_runs(held, refreshed_at) if frame == 66 and after < 66
    ]
    markup.report(f"refresh {refresh_ms:.2f} ms, end frame ms on screen per turn {end_frame_ms}")
    markup.report(f"refreshes past the end {held.count(67)}")
    assert refresh_ms == pytest.approx(1000 / hz, abs=0.2)
    assert max(1, math.floor(1000 / fps / refresh_ms + 0.02)) == end_frame_refreshes
    assert min(held) >= 60
    assert 67 not in held
    assert len(end_frame_ms) >= 10
    # A turn may end a refresh early: the gate times the end frame from the last check that saw another
    # frame, which errs early so it never shows the next. 0.2 ms covers rounded animation frame times.
    assert min(end_frame_ms) >= (end_frame_refreshes - 1) * 1000 / hz - 0.2
    # Most turns hold it the full refreshes, which the early bound alone can't check at 2 or fewer.
    assert statistics.median(end_frame_ms) >= end_frame_refreshes * 1000 / hz - 0.2


@step
def given_the_frame_rate_is(markup: MarkupPage, measured: bool) -> None:
    """Measured from played frames, or assumed at 60 fps with Measure off."""
    if measured:
        markup.measure_frame_rate()
    elif not markup.assumed_frame_rate:
        when_i_run_the_palette_command(markup, "frame rate measurement")
        then_a_flash_says(markup, "Frame rate measurement off. Using 60 fps.")


@pytest.mark.parametrize(
    ("hz", "fps", "measured", "end_frame_refreshes"),
    [pytest.param(*case.values, id=case.id) for case in DISPLAY_RATE_CASES],
)
def test_the_end_frame_refreshes_expected_are_the_fewest_in_chromiums_cadence(
    hz: int, fps: int, measured: bool, end_frame_refreshes: int
) -> None:
    cadences = json.loads((REPO / "src/markup/util/display-cadences.json").read_text())
    [held] = [
        cadence["afterReset"] + cadence["playing"]
        for cadence in cadences
        if cadence["hz"] == hz and cadence["fps"] == fps
    ]
    assert min(held) == end_frame_refreshes


# The fewest turns back the loop assertions need, and a cap on how long to play for them.
LOOP_TURNS = 8
END_FRAME_TURNS = 11
LOOP_PLAY_CAP_MS = 10_000


@step
def when_the_loop_plays_by_refresh(
    markup: MarkupPage, fps: int, turns: int, from_frame: float = 60.5
) -> tuple[list[int], float, list[float]]:
    """The frame the video holds at each refresh while it plays (a VideoFrame read per animation
    frame), from paused at `from_frame` until it has turned back `turns` times, the median refresh
    (ms), and each refresh's animation frame time (ms)."""
    markup.seek(from_frame / fps, presented=True)
    with markup.untraced():
        rows = markup.page.evaluate(
            """async ([turns, capMs]) => {
                const v = document.querySelector('video');
                const rows = [];
                let turned = 0;
                let isDone = false;
                let done;
                const finished = new Promise((resolve) => {
                    done = () => { isDone = true; resolve(); };
                });
                const onRefresh = (now) => {
                    const frame = new VideoFrame(v);
                    const time = frame.timestamp / 1e6;
                    frame.close();
                    if (rows.length && time < rows[rows.length - 1][1]) turned++;
                    rows.push([now, time]);
                    if (turned >= turns) done();
                    if (!isDone) requestAnimationFrame(onRefresh);
                };
                await v.play();
                requestAnimationFrame(onRefresh);
                const timer = setTimeout(done, capMs);
                await finished;
                clearTimeout(timer);
                v.pause();
                return rows;
            }""",
            [turns, LOOP_PLAY_CAP_MS],
        )
    refreshed_at = [now for now, _ in rows]
    gaps = sorted(b - a for a, b in zip(refreshed_at, refreshed_at[1:]))
    held = [math.floor(time * fps + 0.02) for _, time in rows]
    return held, gaps[len(gaps) // 2], refreshed_at


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


def shown_runs(held: list[int], refreshed_at: list[float]) -> list[tuple[int, float, int]]:
    """Each run of one frame held: the frame, its time on screen (ms) from the refresh that showed it
    to the one that replaced it, and the frame after it."""
    runs, shown_at = [], refreshed_at[0]
    for frame, after, at in zip(held, held[1:], refreshed_at[1:]):
        if after != frame:
            runs.append((frame, at - shown_at, after))
            shown_at = at
    return runs


@step
def when_the_loop_plays(markup: MarkupPage, fps: int, turns: int) -> list[int]:
    """The frames shown while the video plays, from the first time it shows the pair's first frame
    until it has turned back `turns` times, so every cycle recorded is whole."""
    markup.seek(60.5 / fps, presented=True)
    times = markup.page.evaluate(
        """async ([turns, capMs]) => {
            const v = document.querySelector('video');
            const times = [];
            let turned = 0;
            let done;
            const finished = new Promise((resolve) => { done = resolve; });
            const onFrame = (_now, meta) => {
                if (times.length && meta.mediaTime < times[times.length - 1]) turned++;
                times.push(meta.mediaTime);
                if (turned >= turns) done();
                else v.requestVideoFrameCallback(onFrame);
            };
            v.requestVideoFrameCallback(onFrame);
            await v.play();
            const timer = setTimeout(done, capMs);
            await finished;
            clearTimeout(timer);
            v.pause();
            return times;
        }""",
        [turns, LOOP_PLAY_CAP_MS],
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
