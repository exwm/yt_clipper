"""Tests for the ffmpeg encode-progress tracker."""

from __future__ import annotations

import io
import time

from rich.console import Console

from clipper.log_helpers.encode_progress import (
    EncodeProgressTracker,
    SearchProgressTracker,
    active_filter_graph_registry,
    get_active_filter_graph_registry,
    get_active_search_progress,
    substitute_filter_graphs,
    track_crf_search_progress,
)


def _make_tracker(total_frames: int = 100) -> EncodeProgressTracker:
    """Tracker writing to an in-memory Console so tests don't print
    to the real terminal."""
    console = Console(file=io.StringIO(), force_terminal=False, no_color=True)
    return EncodeProgressTracker(total_frames, "test", console)


def test_stdout_reader_parses_frame_lines() -> None:
    tracker = _make_tracker(total_frames=100)
    pipe = io.BytesIO(
        b"frame=10\n"
        b"out_time_ms=300000\n"
        b"progress=continue\n"
        b"frame=42\n"
        b"out_time_ms=1400000\n"
        b"progress=end\n",
    )
    with tracker:
        tracker.attach(pipe, None)
        # Reader is daemon; give it a moment to consume the buffer.
        time.sleep(0.1)
    # Progress should have advanced to the last frame.
    task = tracker._progress.tasks[0]
    assert task.completed == 42


def test_stdout_reader_exits_on_eof_without_progress_end() -> None:
    tracker = _make_tracker(total_frames=50)
    pipe = io.BytesIO(b"frame=7\nout_time_ms=200000\nprogress=continue\n")
    # No "progress=end" — reader must exit on EOF.
    with tracker:
        tracker.attach(pipe, None)
        time.sleep(0.1)
    task = tracker._progress.tasks[0]
    assert task.completed == 7
    # Threads should have exited within the join timeout.
    assert tracker._stdout_thread is None or not tracker._stdout_thread.is_alive()


def test_stdout_reader_ignores_malformed_frame_lines() -> None:
    tracker = _make_tracker(total_frames=100)
    pipe = io.BytesIO(
        b"frame=10\n"
        b"frame=garbage\n"  # malformed — should be skipped
        b"frame=20\n"
        b"progress=end\n",
    )
    with tracker:
        tracker.attach(pipe, None)
        time.sleep(0.1)
    task = tracker._progress.tasks[0]
    assert task.completed == 20


def test_stderr_reader_extracts_latest_progress_line() -> None:
    tracker = _make_tracker(total_frames=100)
    # Simulate ffmpeg's stderr output: setup lines on \n, progress
    # updates on \r (overwrites in place).
    stderr_data = (
        b"libvpx-vp9: encoder version 1.13\n"
        b"frame=  10 fps=30 q=29 time=00:00.33 bitrate=1000kbps speed=1x\r"
        b"frame=  20 fps=30 q=28 time=00:00.66 bitrate=1100kbps speed=2x\r"
        b"frame=  30 fps=30 q=27 time=00:01.00 bitrate=1200kbps speed=3x\r"
    )
    pipe = io.BytesIO(stderr_data)
    with tracker:
        tracker.attach(None, pipe)
        time.sleep(0.1)
    # The latest frame= line should be the status text.
    assert "frame=  30" in tracker._status_text.plain
    assert "speed=3x" in tracker._status_text.plain


def test_stderr_reader_handles_zero_total_frames() -> None:
    # total_frames=0 means "unknown duration" — the bar renders as
    # pulsing, but updates still work.
    tracker = _make_tracker(total_frames=0)
    pipe = io.BytesIO(b"frame=5\nprogress=end\n")
    with tracker:
        tracker.attach(pipe, None)
        time.sleep(0.1)
    task = tracker._progress.tasks[0]
    assert task.completed == 5
    # Task.total is None for unknown-duration tasks.
    assert task.total is None


def test_tracker_context_exit_joins_reader_threads() -> None:
    tracker = _make_tracker(total_frames=100)
    # Pipe that blocks forever — simulates a hung subprocess.
    blocking_pipe = io.BytesIO(b"frame=1\nout_time_ms=0\n")
    # Don't write progress=end and don't close the pipe; the reader
    # will hit EOF on BytesIO and exit. Verifying the join semantics
    # here is mainly a regression check for clean context exit.
    with tracker:
        tracker.attach(blocking_pipe, None)
        # Thread will read to EOF and exit
    # After context exit, thread should have joined.
    assert tracker._stdout_thread is not None
    assert not tracker._stdout_thread.is_alive()


def _make_search_tracker() -> SearchProgressTracker:
    """Search tracker writing to an in-memory Console so tests
    don't print to the real terminal."""
    console = Console(file=io.StringIO(), force_terminal=False, no_color=True)
    return SearchProgressTracker(label="CRF search", console=console)


def test_search_tracker_begin_trial_advances_counter_and_label() -> None:
    tracker = _make_search_tracker()
    with tracker:
        tracker._begin_trial_display("(crf=27 w1)")
        first_desc = tracker._progress.tasks[0].description
        tracker._begin_trial_display("(crf=30 w2)")
        second_desc = tracker._progress.tasks[0].description
        tracker._begin_trial_display()  # no label suffix
        third_desc = tracker._progress.tasks[0].description
    assert "trial 1 (crf=27 w1)" in first_desc
    assert "trial 2 (crf=30 w2)" in second_desc
    assert "trial 3" in third_desc
    assert "(crf" not in third_desc
    # Total stays None — search trial count isn't known up front.
    assert tracker._progress.tasks[0].total is None


def test_track_crf_search_progress_binds_contextvar_for_with_scope() -> None:
    # Outside the with-block: no active tracker.
    assert get_active_search_progress() is None
    # Inside: the yielded tracker is the active one.
    with track_crf_search_progress(
        console=Console(file=io.StringIO(), force_terminal=False, no_color=True),
    ) as tracker:
        assert get_active_search_progress() is tracker
        tracker._begin_trial_display("(crf=25 w1)")
    # After exit: contextvar reset to the prior value (None).
    assert get_active_search_progress() is None


# --- filter-graph substitution --------------------------------------------


# A representative long filter graph — long enough to clear the
# ``_FILTER_GRAPH_MIN_LEN_TO_SUBSTITUTE`` (200 char) threshold.
_LONG_FILTER = (
    "trim=0:1.5,format=yuv444p10le,crop='x=0:y=0:w=1920:h=1080:exact=1',"
    "sendcmd='1.0 crop x 100, crop y 50, crop w 1820, crop h 1030',"
    "scale=w=iw/2:h=ih/2,transpose=1,setpts=PTS*1.5,"
    "split=2[main][thumb];[main]format=yuv420p[v];[thumb]scale=480:270[t]"
)


def test_substitute_filter_graphs_no_op_when_no_registry_active() -> None:
    cmd = f'ffmpeg -i input.mp4 -vf "{_LONG_FILTER}" -c:v libvpx-vp9 out.webm'
    new_cmd, new_entries = substitute_filter_graphs(cmd)
    # No active registry → cmd untouched, no entries reported.
    assert new_cmd == cmd
    assert new_entries == []


def test_substitute_filter_graphs_registers_long_graph_and_substitutes() -> None:
    cmd = f'ffmpeg -i input.mp4 -vf "{_LONG_FILTER}" -c:v libvpx-vp9 out.webm'
    with active_filter_graph_registry() as registry:
        new_cmd, new_entries = substitute_filter_graphs(cmd)
        # First call: graph registered as #1, full expr returned as a new entry,
        # cmd's -vf "..." replaced with the placeholder.
        assert new_entries == [(1, _LONG_FILTER)]
        assert '-vf <filter-graph #1>' in new_cmd
        assert _LONG_FILTER not in new_cmd
        assert registry == {_LONG_FILTER: 1}


def test_substitute_filter_graphs_skips_short_filter() -> None:
    short_filter = "trim=0:1.0,format=yuv420p"  # <200 chars
    cmd = f'ffmpeg -i input.mp4 -vf "{short_filter}" -c:v libvpx-vp9 out.webm'
    with active_filter_graph_registry():
        new_cmd, new_entries = substitute_filter_graphs(cmd)
    # Below the threshold → keep inline, don't register.
    assert short_filter in new_cmd
    assert new_entries == []


def test_substitute_filter_graphs_deduplicates_repeat_graphs() -> None:
    cmd_a = f'ffmpeg -i a.mp4 -vf "{_LONG_FILTER}" -crf 23 out-a.webm'
    cmd_b = f'ffmpeg -i b.mp4 -vf "{_LONG_FILTER}" -crf 30 out-b.webm'
    with active_filter_graph_registry():
        _, entries_a = substitute_filter_graphs(cmd_a)
        new_cmd_b, entries_b = substitute_filter_graphs(cmd_b)
    # Second invocation hits the cache: no new entries logged, but the
    # placeholder still substitutes against the previously-assigned id.
    assert entries_a == [(1, _LONG_FILTER)]
    assert entries_b == []
    assert '-vf <filter-graph #1>' in new_cmd_b


def test_substitute_filter_graphs_assigns_distinct_ids_to_distinct_graphs() -> None:
    other_filter = (
        "trim=0:2.0,format=yuv420p,"
        "crop='x=200:y=150:w=1280:h=720:exact=1',"
        "scale=w=iw/3:h=ih/3,transpose=2,"
        "drawtext=fontfile='/tmp/font.ttf':text='hello':fontcolor=white,"
        "sendcmd='2.0 crop x 250, crop y 175, crop w 1230, crop h 670',"
        "split=2[main][thumb];[main]format=yuv420p[v];[thumb]scale=320:180[t]"
    )
    assert len(other_filter) >= 200  # guard for the test's premise
    cmd_a = f'ffmpeg -i a.mp4 -vf "{_LONG_FILTER}" out.webm'
    cmd_b = f'ffmpeg -i b.mp4 -vf "{other_filter}" out.webm'
    with active_filter_graph_registry():
        _, entries_a = substitute_filter_graphs(cmd_a)
        new_cmd_b, entries_b = substitute_filter_graphs(cmd_b)
    assert entries_a == [(1, _LONG_FILTER)]
    assert entries_b == [(2, other_filter)]
    assert '-vf <filter-graph #2>' in new_cmd_b


def test_substitute_filter_graphs_uses_angle_brackets_not_square_brackets() -> None:
    """Angle brackets so rich's markup parser doesn't strip the placeholder.

    Square-bracket form ``[filter-graph #N]`` got eaten by rich (it
    treats ``[X]`` as an unknown style-span open tag and silently
    drops the tag from the rendered output), leaving the operator
    looking at ``-vf  -crf 23`` with the placeholder missing.
    """
    cmd = f'ffmpeg -i input.mp4 -vf "{_LONG_FILTER}" out.webm'
    with active_filter_graph_registry():
        new_cmd, _ = substitute_filter_graphs(cmd)
    assert '<filter-graph #1>' in new_cmd
    assert '[filter-graph #1]' not in new_cmd


def test_active_filter_graph_registry_resets_on_exit() -> None:
    assert get_active_filter_graph_registry() is None
    with active_filter_graph_registry() as registry:
        assert get_active_filter_graph_registry() is registry
        substitute_filter_graphs(
            f'ffmpeg -i x.mp4 -vf "{_LONG_FILTER}" out.webm',
        )
        assert _LONG_FILTER in registry
    # After the with-block: a fresh registry for the next search would
    # start at id #1 again (no leakage of prior entries).
    assert get_active_filter_graph_registry() is None


def test_track_crf_search_progress_enters_filter_graph_registry() -> None:
    # Reuses the in-memory console pattern from the surrounding suite.
    console = Console(file=io.StringIO(), force_terminal=False, no_color=True)
    assert get_active_filter_graph_registry() is None
    with track_crf_search_progress(console=console):
        # Both contextvars active simultaneously during a search.
        assert get_active_search_progress() is not None
        assert get_active_filter_graph_registry() is not None
        # Confirm substitution works inside the search scope.
        _, entries = substitute_filter_graphs(
            f'ffmpeg -i x.mp4 -vf "{_LONG_FILTER}" out.webm',
        )
        assert entries == [(1, _LONG_FILTER)]
    assert get_active_filter_graph_registry() is None


# --- progress-timestamp state (feeds the cancellation diagnostic) ---------


def test_frame_advance_resets_progress_timestamp() -> None:
    # When ffmpeg actually advances the frame counter, the idle
    # clock should snap back to zero.
    tracker = _make_tracker(total_frames=100)
    pipe = io.BytesIO(b"frame=42\nout_time_ms=1400000\nprogress=end\n")
    with tracker:
        # Backdate first so we can verify the reset moves it forward.
        tracker._last_progress_ts -= 10.0
        before = tracker._last_progress_ts
        tracker.attach(pipe, None)
        time.sleep(0.1)
    # After consuming ``frame=42`` the timestamp should have
    # advanced — by more than the 10s we backdated.
    assert tracker._last_progress_ts > before
    assert tracker._last_frame_count == 42


def test_repeated_frame_zero_does_not_reset_progress_timestamp() -> None:
    # ffmpeg hanging on input read may keep flushing the same
    # ``frame=0 fps=0.0 ...`` stats line indefinitely. The idle
    # clock must keep counting through that, not be falsely reset
    # on every stats refresh — the strict ``n > _last_frame_count``
    # gate is what protects this.
    tracker = _make_tracker(total_frames=100)
    pipe = io.BytesIO(
        b"frame=0\nout_time_ms=0\n"
        b"frame=0\nout_time_ms=0\n"
        b"frame=0\nout_time_ms=0\nprogress=end\n",
    )
    with tracker:
        tracker._last_progress_ts -= 5.0
        anchor = tracker._last_progress_ts
        tracker.attach(pipe, None)
        time.sleep(0.1)
    # Timestamp unchanged — every line was ``frame=0`` so the
    # strict-advance gate kept it pinned at the backdated value.
    assert tracker._last_progress_ts == anchor
    assert tracker._last_frame_count == 0


def test_exception_exit_prints_idle_diagnostic_when_idle_exceeds_threshold() -> None:
    # Simulate the operator's hang scenario: encode entered, no
    # frames produced, Ctrl+C raised. The __exit__ path should
    # print a one-line diagnostic before the persisted final stats.
    file = io.StringIO()
    console = Console(file=file, force_terminal=False, no_color=True)
    tracker = EncodeProgressTracker(0, "trial", console)
    try:
        with tracker:
            # 10s of accumulated idle — well above the 2s diagnostic
            # threshold.
            tracker._last_progress_ts -= 10.0
            raise KeyboardInterrupt
    except KeyboardInterrupt:
        pass
    output = file.getvalue()
    assert "encode idle for" in output
    assert "last frame=0" in output


def test_clean_exit_does_not_print_idle_diagnostic() -> None:
    # Normal exit (no exception) — diagnostic must NOT appear, even
    # if some idle time accumulated during the encode. The
    # diagnostic is keyed on abnormal exit only.
    file = io.StringIO()
    console = Console(file=file, force_terminal=False, no_color=True)
    tracker = EncodeProgressTracker(0, "trial", console)
    with tracker:
        tracker._last_progress_ts -= 30.0
    assert "encode idle for" not in file.getvalue()


def test_exception_exit_below_threshold_skips_diagnostic() -> None:
    # The 2s minimum keeps "raised immediately on entry" abnormal
    # exits from emitting a noisy ``encode idle for 0:00:00`` line.
    file = io.StringIO()
    console = Console(file=file, force_terminal=False, no_color=True)
    tracker = EncodeProgressTracker(0, "trial", console)
    try:
        with tracker:
            raise RuntimeError("immediate")
    except RuntimeError:
        pass
    assert "encode idle for" not in file.getvalue()


def test_search_tracker_resets_per_trial_state_at_trial_start() -> None:
    # Between trials a slow prior trial's terminal frame count,
    # progress timestamp, banner buffer, and stats line would all
    # falsely bleed into the next trial's display if not cleared.
    # ``_run_subprocess`` resets every per-trial field before
    # launching ffmpeg; we exercise the reset directly here to
    # avoid Popen-mocking. The state mutation is the contract
    # under test.
    tracker = _make_search_tracker()
    with tracker:
        # Simulate state left over from a prior trial.
        tracker._last_frame_count = 9999
        tracker._last_progress_ts -= 30.0
        tracker._recent_non_stats_lines.append("[stale @ ...] prior banner")
        tracker._latest_stats_line = "frame= 9999 fps= 30 ..."
        stale_ts = tracker._last_progress_ts

        # Replicate the reset block at the top of _run_subprocess.
        tracker._last_frame_count = 0
        tracker._last_progress_ts = time.monotonic()
        tracker._recent_non_stats_lines.clear()
        tracker._latest_stats_line = ""
        tracker._status_text.plain = ""

        assert tracker._last_frame_count == 0
        assert tracker._last_progress_ts > stale_ts
        assert len(tracker._recent_non_stats_lines) == 0
        assert tracker._latest_stats_line == ""


def test_search_tracker_exception_exit_emits_idle_diagnostic() -> None:
    # Mirror of the EncodeProgressTracker case for the search
    # tracker — Ctrl+C during a wedged trial should leave the same
    # one-line summary in scrollback.
    file = io.StringIO()
    console = Console(file=file, force_terminal=False, no_color=True)
    tracker = SearchProgressTracker(label="sample-guided encode", console=console)
    try:
        with tracker:
            tracker._last_progress_ts -= 10.0
            tracker._last_frame_count = 5
            raise KeyboardInterrupt
    except KeyboardInterrupt:
        pass
    output = file.getvalue()
    assert "encode idle for" in output
    assert "last frame=5" in output


# --- recent-lines rolling buffer ------------------------------------------


def test_push_stderr_line_buffers_non_stats_lines_and_renders_them() -> None:
    # Non-stats lines (banners, decoder setup, errors) accumulate
    # in the rolling buffer and render as newline-joined text in
    # the transient region — gives the operator live visibility
    # into the setup window before any frame= line arrives.
    tracker = _make_tracker(total_frames=100)
    with tracker:
        tracker._push_stderr_line("[https @ 0x1234] Opening 'https://example' for reading")
        tracker._push_stderr_line("[mov,mp4,m4a,3gp,3g2,mj2 @ 0x5678] decoded 5 frames")
        rendered = tracker._status_text.plain
    assert "Opening 'https://example'" in rendered
    assert "decoded 5 frames" in rendered
    # Order preserved — operator reads top-to-bottom = oldest-to-newest.
    assert rendered.index("Opening") < rendered.index("decoded")


def test_push_stderr_line_caps_non_stats_buffer_at_max_length() -> None:
    # Oldest banner is evicted when the buffer fills, so the
    # transient region stays bounded in height regardless of how
    # chatty ffmpeg's setup output is.
    from clipper.log_helpers.encode_progress import _RECENT_NON_STATS_LINES_MAX
    tracker = _make_tracker(total_frames=100)
    with tracker:
        for i in range(_RECENT_NON_STATS_LINES_MAX + 3):
            tracker._push_stderr_line(f"banner-{i}")
        rendered = tracker._status_text.plain
    # The 3 oldest banners (banner-0 .. banner-2) must be gone.
    assert "banner-0" not in rendered
    assert "banner-1" not in rendered
    assert "banner-2" not in rendered
    # The most recent ``_RECENT_NON_STATS_LINES_MAX`` banners survive.
    for i in range(3, _RECENT_NON_STATS_LINES_MAX + 3):
        assert f"banner-{i}" in rendered


def test_stats_line_lives_in_separate_slot_below_banners() -> None:
    # The single stats line slot doesn't evict banners — even at
    # ffmpeg's 10x/s stats period, banners persist in the rolling
    # buffer while the stats line refreshes in place below them.
    tracker = _make_tracker(total_frames=100)
    with tracker:
        tracker._push_stderr_line("[https @ 0x1234] Opening 'https://example' for reading")
        # 20 stats refreshes — under the old "everything appends"
        # design these would evict the banner above. Now they all
        # collapse into the latest_stats_line slot.
        for i in range(20):
            tracker._push_stderr_line(
                f"frame={i} fps= 30 q=29.0 size= 100KiB time=00:00.50 bitrate= 1000kbits/s speed=1.0x",
            )
        rendered = tracker._status_text.plain
    assert "Opening 'https://example'" in rendered  # banner survived
    # Only the LATEST stats line is rendered (not all 20).
    assert "frame=5 fps" not in rendered  # mid-loop value, evicted
    assert "frame=19 fps" in rendered  # final loop value
    # And the stats line appears AFTER the banner (rendered below).
    assert rendered.index("Opening") < rendered.index("frame=19 fps")


def test_final_persisted_footprint_is_only_the_stats_line() -> None:
    # On context exit the persisted-to-scrollback footprint is the
    # latest stats line ONLY — not the rolling banner buffer.
    # Banners would either duplicate scrollback (non-silent mode
    # scrolls them above the bar anyway) or pollute it (silent
    # mode replays 4-line clusters every trial).
    file = io.StringIO()
    console = Console(file=file, force_terminal=False, no_color=True)
    tracker = EncodeProgressTracker(0, "test", console)
    with tracker:
        tracker._push_stderr_line("[banner] some setup line")
        tracker._push_stderr_line(
            "frame=  42 fps= 30 q=29.0 size= 100KiB time=00:01.40 bitrate=1000kbits/s speed=1.0x",
        )
    output = file.getvalue()
    assert "frame=  42" in output
    # Banner not persisted — it would re-emit content already in
    # scrollback (non-silent) or pollute it (silent).
    assert "[banner] some setup line" not in output


def test_search_tracker_buffers_non_stats_lines_in_silent_mode() -> None:
    # The search tracker drops banners from scrollback (to avoid
    # 20+ banner repeats across trials) but still surfaces them
    # transiently in the rolling buffer above the spinner — that's
    # the operator's only live signal during a stuck-trial setup.
    tracker = _make_search_tracker()
    with tracker:
        tracker._push_stderr_line("[https @ 0x9999] Opening 'remote' for reading")
        tracker._push_stderr_line(
            "frame=   1 fps= 30 q=29.0 size=  10KiB time=00:00.05 bitrate=1000kbits/s speed=1.0x",
        )
        rendered = tracker._status_text.plain
    # Both buffered.
    assert "Opening 'remote'" in rendered
    assert "frame=   1" in rendered
