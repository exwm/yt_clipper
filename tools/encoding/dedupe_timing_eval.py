"""Compare ways to time the frames kept after duplicate removal, by how evenly the scene moves.

    uv run python tools/encoding/dedupe_timing_eval.py

Each synthetic clip knows which moment of the scene every frame shows. After the clipper's
detector drops repeats, a timing policy gives each kept frame an output time. Interpolation then
moves the picture evenly between kept frames, so the scene's speed over each step is (scene time
advanced) / (output time advanced). A step much slower than the clip's average is a hitch, much
faster a jump.

Policies:
- keep: kept frames keep their timestamps (what the clipper does)
- reset: kept frames play back to back (the clipper's old setpts=N/FR/TB)
- classify: a repeat whose next change is about one normal step was added (its time is removed);
  about two steps means a frame was lost (its time is kept)
- fit: kept frames spaced by how many scene steps each advances, fitted evenly to their real times
  within +-8 kept frames. Needs lookahead, so it cannot run in ffmpeg's filter graph.
- causal: each kept frame steps on by a running average of recent spacing, pulled toward its real
  time. Uses only frames already seen.
"""

import itertools
import math
import statistics
import sys
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dedupe_eval as d

FPS = 30000 / 1001
SECONDS = 5
FRAMES = 150


def lost(n: int) -> bool:
    """The source frames lost in the lost-frames clip (synthetic_media's select)."""
    return n % 7 == 3 or n % 11 == 5


# (clip, scene time of frame k in seconds, or the rate its distinct pictures were made at)
CLIPS: list[tuple[str, Callable[[int], float] | float]] = [
    ("lost-frames", lambda k: max(i for i in range(k + 1) if not lost(i)) / FPS),
    ("added-copies", FPS),
    ("motion-24-in-30-vp9", 24000 / 1001),
    ("cartoon-12-in-30", 12.0),
]


def scene_times(sceneTime: Callable[[int], float] | float, lossless: Path) -> list[float]:
    if callable(sceneTime):
        return [sceneTime(k) for k in range(FRAMES)]
    repeats = d.synthetic_media.repeatedFrames(d.FFMPEG, lossless)
    distinct, times = -1, []
    for k in range(FRAMES):
        distinct += k not in repeats
        times.append(distinct / sceneTime)
    return times


def keep_times(kept: list[int], _mafd: list[float]) -> list[float]:
    return [n / FPS for n in kept]


def reset_times(kept: list[int], _mafd: list[float]) -> list[float]:
    return [i / FPS for i in range(len(kept))]


def scene_steps(kept: list[int], mafd: list[float]) -> list[int]:
    """How many scene steps each kept frame advances: 1, or more after frames that were lost (its
    change is about that many normal steps)."""
    steps, normal = [0], []
    for previous, n in itertools.pairwise(kept):
        repeats = n - previous - 1
        if repeats and len(normal) >= 3:
            steps.append(min(repeats + 1, max(1, round(mafd[n] / statistics.median(normal[-8:])))))
        else:
            steps.append(1)
            if not repeats:
                normal.append(mafd[n])
    return steps


def classify_times(kept: list[int], mafd: list[float]) -> list[float]:
    times, removed = [kept[0] / FPS], 0
    for (previous, n), step in zip(
        itertools.pairwise(kept), scene_steps(kept, mafd)[1:], strict=True
    ):
        removed += n - previous - step
        times.append((n - removed) / FPS)
    return times


def fit_times(kept: list[int], mafd: list[float], window: int = 8) -> list[float]:
    times = [n / FPS for n in kept]
    position = list(itertools.accumulate(scene_steps(kept, mafd)))
    fitted = []
    for i in range(len(kept)):
        lo, hi = max(0, i - window), min(len(kept), i + window + 1)
        slope, intercept = statistics.linear_regression(position[lo:hi], times[lo:hi])
        fitted.append(intercept + slope * position[i])
    return fitted


def causal_times(
    kept: list[int], _mafd: list[float], alpha: float = 0.2, pull: float = 0.1
) -> list[float]:
    times = [n / FPS for n in kept]
    output, spacing = [times[0]], None
    for previous, current in itertools.pairwise(times):
        gap = current - previous
        spacing = gap if spacing is None else spacing + alpha * (gap - spacing)
        predicted = output[-1] + spacing
        output.append(predicted + pull * (current - predicted))
    return output


POLICIES = {
    "keep": keep_times,
    "reset": reset_times,
    "classify": classify_times,
    "fit": fit_times,
    "causal": causal_times,
}


def evenness(kept: list[int], output: list[float], scene: list[float]) -> dict:
    speeds = [
        (scene[b] - scene[a]) / (ob - oa)
        for a, b, oa, ob in zip(kept, kept[1:], output, output[1:], strict=False)
        if ob > oa
    ]
    average = (scene[kept[-1]] - scene[kept[0]]) / (output[-1] - output[0])
    relative = [speed / average for speed in speeds]
    return {
        "slowest": min(relative),
        "fastest": max(relative),
        "rms": math.sqrt(statistics.fmean((r - 1) ** 2 for r in relative)),
    }


def main() -> None:
    shipped = next(detector for detector in d.DETECTORS if detector.label == d.SHIPPED)
    print(f"{'clip':<22}{'policy':<10}{'slowest':>8}{'fastest':>8}{'rms':>7}{'length':>8}")
    for name, sceneTime in CLIPS:
        lossless, uploaded = d.synthetic_media.makeSyntheticClip(d.FFMPEG, name, d.WORK, SECONDS)
        scene = scene_times(sceneTime, lossless)
        mafd = d.metadata_values(uploaded, "scdet=threshold=100", "lavfi.scd.mafd")
        kept = sorted(shipped.keep(uploaded, d.frame_rate(uploaded)))
        for policy_name, policy in POLICIES.items():
            output = policy(kept, mafd)
            score = evenness(kept, output, scene)
            length = (output[-1] - output[0]) / ((kept[-1] - kept[0]) / FPS)
            print(f"{name:<22}{policy_name:<10}{score['slowest']:>8.2f}{score['fastest']:>8.2f}"
                  f"{score['rms']:>7.2f}{length:>8.2f}")  # fmt: skip


if __name__ == "__main__":
    main()
