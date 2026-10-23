import os


def pytest_xdist_auto_num_workers() -> int:
    """`-n auto` starts workers for 75% of the CPU cores, so a test run leaves the machine usable."""
    return max(1, (os.cpu_count() or 1) * 3 // 4)
