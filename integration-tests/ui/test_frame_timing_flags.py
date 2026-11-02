"""The UI tests' list of frame timing flags matches the groups in the markup's table."""

from conftest import FRAME_TIMING_FLAGS, frame_timing_groups


def test_the_frame_timing_flags_are_the_groups_table_named_group_timing() -> None:
    assert frame_timing_groups(), "no groups parsed from keys.ts"
    assert sorted(FRAME_TIMING_FLAGS) == sorted(f"{group}Timing" for group in frame_timing_groups())
