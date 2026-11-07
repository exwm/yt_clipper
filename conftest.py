import os
import zlib

import pytest


def pytest_xdist_auto_num_workers() -> int | None:
    """`-n auto` starts workers for 75% of the CPU cores, so a test run leaves the machine usable.
    CI runners have nothing to share: PYTEST_XDIST_AUTO_NUM_WORKERS there passes to xdist's own hook."""
    if os.environ.get("PYTEST_XDIST_AUTO_NUM_WORKERS"):
        return None
    return max(1, (os.cpu_count() or 1) * 3 // 4)


def parseShard(spec: str) -> tuple[int, int]:
    """YTC_TEST_SHARD as (index, count): "2/3" is the second of three shards."""
    index, _, count = spec.partition("/")
    if not (index.isdigit() and count.isdigit() and 1 <= int(index) <= int(count)):
        raise pytest.UsageError(f"YTC_TEST_SHARD must look like 1/2, not {spec!r}")
    return int(index), int(count)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """With YTC_TEST_SHARD=i/n, keeps the i-th of n parts of the tests, split by a hash of each test's
    id, so parallel CI jobs share a run without a durations file."""
    spec = os.environ.get("YTC_TEST_SHARD")
    if not spec:
        return
    index, count = parseShard(spec)
    kept: list[pytest.Item] = []
    deselected: list[pytest.Item] = []
    for item in items:
        inShard = zlib.crc32(item.nodeid.encode()) % count == index - 1
        (kept if inShard else deselected).append(item)
    config.hook.pytest_deselected(items=deselected)
    items[:] = kept
