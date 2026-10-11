"""The loop guard: while a marker pair loops, a press on the platform's progress bar outside the
pair goes to the pair's start, and a press on a player button just below the bar reaches the
button."""

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step

PAIR = (10.0, 12.0)
# The guard used to take presses this far below the bar as bar presses.
NEAR_THE_BAR_PX = 8


@pytest.fixture
def looping(markup: MarkupPage) -> MarkupPage:
    markup.load_marker_pairs([PAIR])
    markup.open_marker_pair(0)
    markup.press("Shift+KeyC")
    markup.seek(sum(PAIR) / 2)  # mid-pair, so going to the pair start is a real seek
    record_seeks(markup)
    return markup


@pytest.mark.platform
def test_a_press_just_above_the_bar_track_goes_to_the_loop_start(looping: MarkupPage) -> None:
    when_i_click_just_above_the_bar_track_after_the_pair(looping)
    then_playback_only_seeks_to_the_pair_start(looping)


@pytest.mark.platform
def test_play_just_below_the_bar_starts_playback(looping: MarkupPage) -> None:
    when_i_click_the_top_edge_of(looping, looping.host.play_button)
    then_the_video_is_playing(looping)
    then_playback_did_not_seek(looping)


@pytest.mark.platform
def test_the_palette_button_just_below_the_bar_opens_the_palette(looping: MarkupPage) -> None:
    when_i_click_the_top_edge_of(looping, ".yt-clipper-palette-button")
    then_the_command_palette_is_open(looping)
    then_playback_did_not_seek(looping)


# ─── when ───────────────────────────────────────────────────────────────────


@step
def when_i_click_just_above_the_bar_track_after_the_pair(markup: MarkupPage) -> None:
    track = markup.box_of(markup.host.progress_track)
    duration = markup.page.evaluate("() => document.querySelector('video').duration")
    x = track["x"] + track["width"] * (PAIR[1] + 5) / duration
    markup.page.mouse.click(x, track["y"] - 4)
    wait_for_seeks_to_land(markup)


@step
def when_i_click_the_top_edge_of(markup: MarkupPage, selector: str) -> None:
    button = markup.box_of(selector)
    bar = markup.box_of(markup.host.progress_bar)
    x, y = button["x"] + button["width"] / 2, button["y"]
    gap = y - (bar["y"] + bar["height"])
    markup.report(f"clicking {gap:.1f}px below the bar")
    assert 0 <= gap <= NEAR_THE_BAR_PX, "the button's top edge is not near the bar"
    on_button = markup.page.evaluate(
        "([x, y, s]) => !!document.elementFromPoint(x, y)?.closest(s)", [x, y, selector]
    )
    assert on_button, f"{selector} is not under its own top edge"
    markup.page.mouse.click(x, y)
    markup.next_frames(5)
    markup.shot("button-clicked")


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_playback_only_seeks_to_the_pair_start(markup: MarkupPage) -> None:
    # No seek may land outside the pair, or the clicked frame would flash before the loop returns.
    seeks = markup.page.evaluate("() => window.__seeks")
    markup.report(f"seeks {[round(t, 2) for t in seeks]}")
    assert all(PAIR[0] - 0.1 <= t <= PAIR[1] + 0.1 for t in seeks)
    assert any(t == pytest.approx(PAIR[0], abs=0.1) for t in seeks)


@step
def then_playback_did_not_seek(markup: MarkupPage) -> None:
    seeks = markup.page.evaluate("() => window.__seeks")
    markup.report(f"seeks {[round(t, 2) for t in seeks]}")
    assert seeks == []


@step
def then_the_video_is_playing(markup: MarkupPage) -> None:
    assert markup.eventually("() => !document.querySelector('video').paused")
    markup.pause()


@step
def then_the_command_palette_is_open(markup: MarkupPage) -> None:
    assert markup.eventually("() => !!document.querySelector('.cmdp-footer')?.checkVisibility()")
    markup.press("Escape")


# ─── page state ─────────────────────────────────────────────────────────────


def record_seeks(markup: MarkupPage) -> None:
    """Collect the video's seek targets in `window.__seeks`."""
    markup.page.evaluate(
        "() => { window.__seeks = []; document.querySelector('video')"
        ".addEventListener('seeking', (e) => window.__seeks.push(e.target.currentTime)); }",
    )


def wait_for_seeks_to_land(markup: MarkupPage) -> None:
    """Wait for a recorded seek to finish, plus a few frames for any loop pull-back to follow."""
    assert markup.eventually(
        "() => window.__seeks.length > 0 && !document.querySelector('video').seeking",
    ), "no seek happened"
    markup.next_frames(5)
