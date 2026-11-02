"""Score duplicate frame removal against synthetic clips whose repeated frames are known.

    uv run python tools/encoding/dedupe_eval.py [--seconds 5] [--jobs 6]

Uses ffmpeg from PATH, or DEDUPE_EVAL_FFMPEG (with its ffprobe beside it).

The clips come from src/clipper/tests/synthetic_media.py: each is made losslessly, so its true
repeats are the frames identical to the frame before, then encoded like an upload. Each detector
runs on the upload and keeps the timestamps of the frames it keeps, so kept frames map back to
frame numbers. The clipper's detector (clipper/dedupe.py) is run by ffmpeg and checked against a
Python model of it, which is what to tune.

Scores per detector:
- stalls: repeats kept between moving frames. Interpolating between a frame and its repeat holds
  the picture still for a moment. Repeats kept in a still stretch do not count: holding is correct.
- visible drops: real frames dropped where some 16x16 block (on a 640 px wide frame) moved more
  than VISIBLE_BLOCK_MOTION. Dropping a frame that only differs by noise is harmless.
- longest gap: the most frames between two kept ones. Interpolation spreads a change evenly over
  the gap, so a long gap smears a movement that starts suddenly after a still stretch.

Clips with no repeats are the negative cases: every frame dropped from them is a mistake. The real
e2e test cartoon is scored too, with repeats labeled from frame differences (less certain), as a
check that the synthetic cartoons stand in for it. It is not ranked.
"""

import argparse
import itertools
import json
import os
import shutil
import statistics
import subprocess
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "src"))
from clipper import dedupe  # noqa: E402
from clipper.tests import synthetic_media  # noqa: E402

FFMPEG = os.environ.get("DEDUPE_EVAL_FFMPEG") or shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = str(Path(FFMPEG).with_name(Path(FFMPEG).name.replace("ffmpeg", "ffprobe")))
WORK = REPO / "sandbox" / "dedupe_eval" / "clips"
REAL_CARTOON = (REPO / "src" / "clipper" / "tests" / "testdata" / "test-with-dynamic.mp4", 75.2)
REAL_UPLOAD_REPEAT_DIFF = 1.5
VISIBLE_BLOCK_MOTION = 4.0
MAX_GAP = 3
# Measuring at one width makes a block the same share of the picture at any resolution.
MEASURE_SIZE = "scale=640:-2:flags=area"
BLOCK_GAIN = 4


@dataclass(frozen=True)
class FrameDiff:
    """Difference from the frame before: over the whole frame, and in the most changed block."""

    mean: float
    block: float


@dataclass(frozen=True)
class Detector:
    label: str
    keep: Callable[[Path, Fraction], set[int]]


def run(command: list[str]) -> str:
    return subprocess.run(command, capture_output=True, text=True, check=True).stderr


def frame_rate(path: Path) -> Fraction:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    return Fraction(out.strip())


def metadata_values(video: Path, graph: str, key: str) -> list[float]:
    log = run([FFMPEG, "-hide_banner", "-i", str(video), "-an", "-vf", f"{graph},metadata=mode=print:key={key}",
               "-f", "null", "-"])  # fmt: skip
    return [float(line.split("=")[-1]) for line in log.splitlines() if f"{key}=" in line]


def frame_diffs(video: Path) -> list[FrameDiff]:
    """Each frame's difference from the frame before; frame 0 gets none."""
    means = metadata_values(
        video, f"{MEASURE_SIZE},tblend=all_mode=difference,signalstats", "lavfi.signalstats.YAVG"
    )
    # Averaging the difference over 16x16 blocks makes its max the most changed block's mean. The
    # averages are 8 bit, so the difference is amplified first to keep small ones apart.
    blocks = metadata_values(
        video,
        f"{MEASURE_SIZE},tblend=all_mode=difference,format=gray,lut=c0=min(val*{BLOCK_GAIN}\\,255),"
        "scale=iw/16:ih/16:flags=area,signalstats",
        "lavfi.signalstats.YMAX",
    )
    return [FrameDiff(0, 0)] + [
        FrameDiff(mean, block / BLOCK_GAIN) for mean, block in zip(means, blocks, strict=True)
    ]


def frame_times(video: Path) -> list[float]:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0",
         str(video)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    return [float(line.strip(",")) for line in out.split() if line.strip(",")]


def kept_by_filter(video: Path, _fps: Fraction, video_filter: str) -> set[int]:
    """Frame numbers of the frames the filter keeps, matched by timestamp (so VFR input works)."""
    log = run(
        [
            FFMPEG,
            "-hide_banner",
            "-i",
            str(video),
            "-vf",
            f"{video_filter},showinfo",
            "-f",
            "null",
            "-",
        ]
    )
    kept_times = [
        float(line.split(" pts_time:")[1].split()[0])
        for line in log.splitlines()
        if "Parsed_showinfo" in line and " pts_time:" in line
    ]
    times = frame_times(video)
    return {min(range(len(times)), key=lambda n: abs(times[n] - kept)) for kept in kept_times}


def filter_detector(label: str, video_filter: str) -> Detector:
    return Detector(label, lambda video, fps: kept_by_filter(video, fps, video_filter))


def keep_unless_repeat(count: int, is_repeat: Callable[[int], bool]) -> set[int]:
    kept, run_length = {0}, 0
    for n in range(1, count):
        if is_repeat(n) and run_length < dedupe.MAX_DROPS_IN_A_ROW:
            run_length += 1
        else:
            kept.add(n)
            run_length = 0
    return kept


def relative_centered(ratio: float = 0.3, ceiling: float = 1.5, window: int = 4) -> Detector:
    """A reference that looks ahead, so it needs a separate pass: a repeat differs by much less than
    the upper quartile of the differences within `window` frames on both sides."""

    def keep(video: Path, _fps: Fraction) -> set[int]:
        diffs = [d.mean for d in frame_diffs(video)]

        def is_repeat(n: int) -> bool:
            around = diffs[max(1, n - window) : n + window + 1]
            reference = statistics.quantiles(around, n=4)[2] if len(around) > 1 else around[0]
            return diffs[n] < min(ceiling, ratio * reference)

        return keep_unless_repeat(len(diffs), is_repeat)

    return Detector(f"relative centered (separate pass)", keep)


def detector_model(video: Path, _fps: Fraction) -> set[int]:
    """A Python model of clipper/dedupe.py's filter (8 bit), for tuning its constants."""
    ti = metadata_values(video, "siti", "lavfi.siti.ti")
    mafd = metadata_values(video, "scdet=threshold=100", "lavfi.scd.mafd")
    peak, run_length, kept_by_repeats = 0.0, 0, []
    for n, value in enumerate(ti):
        repeat = (
            n > 0
            and value < min(dedupe.CEILING, max(dedupe.RATIO * peak, dedupe.STILL))
            and run_length < dedupe.MAX_DROPS_IN_A_ROW
        )
        run_length = run_length + 1 if repeat else 0
        peak = max(value, peak * dedupe.DECAY)
        if not repeat:
            kept_by_repeats.append(n)
    kept, peak, dropped_last = set(), 0.0, False
    for seen, n in enumerate(kept_by_repeats, start=1):
        drop = (
            seen > dedupe.WARMUP
            and peak > dedupe.FLOOR
            and mafd[n] > dedupe.SPIKE * peak
            and not dropped_last
        )
        peak = peak * dedupe.DECAY if drop else max(mafd[n], peak * dedupe.DECAY)
        dropped_last = drop
        if not drop:
            kept.add(n)
    return kept


# The build ships 5.49's mpdecimate while FIND_REPEATS_AGAINST_NEARBY_CHANGES is off
SHIPPED = "mpdecimate (5.49, shipped)"
DETECTOR = "clipper detector (ffmpeg, behind the flag)"
MODEL = "clipper detector (Python model)"
DETECTORS = [
    filter_detector(SHIPPED, "mpdecimate=hi=64*8:lo=64*5:frac=0.1"),
    filter_detector("mpdecimate best tuned", "mpdecimate=hi=1536:lo=192:frac=0.33:max=2"),
    relative_centered(),
    filter_detector(DETECTOR, dedupe.getRemoveDuplicateFramesFilter()),
    Detector(MODEL, detector_model),
]


def is_moving(n: int, repeats: set[int], truth: list[FrameDiff]) -> bool:
    """Whether the real changes on both sides of frame n, within MAX_GAP frames, moved."""
    before = next((m for m in range(n, max(0, n - MAX_GAP) - 1, -1) if m not in repeats), None)
    after = next(
        (m for m in range(n + 1, min(len(truth), n + MAX_GAP + 1)) if m not in repeats), None
    )
    return (
        before is not None
        and after is not None
        and min(truth[before].block, truth[after].block) > VISIBLE_BLOCK_MOTION
    )


def score(kept: set[int], repeats: set[int], truth: list[FrameDiff]) -> dict:
    dropped = set(range(len(truth))) - kept
    real_dropped = dropped - repeats
    return {
        "kept": sorted(kept),
        "stalls": sum(1 for n in repeats - dropped if is_moving(n, repeats, truth)),
        "real_dropped": len(real_dropped),
        "visible_drops": sum(1 for n in real_dropped if truth[n].block > VISIBLE_BLOCK_MOTION),
        "longest_gap": max((b - a for a, b in itertools.pairwise(sorted(kept))), default=1),
    }


def real_cartoon(seconds: float) -> tuple[Path, set[int], list[FrameDiff]]:
    path, start = REAL_CARTOON
    clip = WORK / f"e2e-cartoon-{start:g}-{seconds:g}s.mkv"
    if not clip.exists():
        WORK.mkdir(parents=True, exist_ok=True)
        synthetic_media.makeWhole(clip, [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start),
                                         "-i", str(path), "-t", str(seconds), "-an", "-c:v", "ffv1", "-pix_fmt", "yuv420p"])  # fmt: skip
    truth = frame_diffs(clip)
    return clip, {n for n in range(1, len(truth)) if truth[n].mean < REAL_UPLOAD_REPEAT_DIFF}, truth


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--seconds", type=float, default=5)
    parser.add_argument("--jobs", type=int, default=6)
    args = parser.parse_args()

    cases = []
    for name in synthetic_media.CLIPS:
        lossless, uploaded = synthetic_media.makeSyntheticClip(FFMPEG, name, WORK, args.seconds)
        cases.append(
            (
                name,
                uploaded,
                synthetic_media.repeatedFrames(FFMPEG, lossless),
                frame_diffs(lossless),
                True,
            )
        )
    clip, repeats, truth = real_cartoon(args.seconds)
    cases.append(("e2e-cartoon", clip, repeats, truth, False))

    results = []
    for name, uploaded, repeats, truth, ranked in cases:
        fps = frame_rate(uploaded)
        with ThreadPoolExecutor(args.jobs) as pool:
            kept_by_detector = list(
                pool.map(
                    lambda detector, video=uploaded, rate=fps: detector.keep(video, rate), DETECTORS
                )
            )
        for detector, kept in zip(DETECTORS, kept_by_detector, strict=True):
            results.append({"clip": name, "ranked": ranked, "negative": not repeats, "detector": detector.label,
                            "repeats": len(repeats), **score(kept, repeats, truth)})  # fmt: skip

    kept = {(row["clip"], row["detector"]): row["kept"] for row in results}
    mismatched = [name for name, *_ in cases if kept[name, DETECTOR] != kept[name, MODEL]]
    print(f"clipper filter matches its Python model on {len(cases) - len(mismatched)} of {len(cases)} clips"
          + (f"; differs on {', '.join(mismatched)}" if mismatched else ""))  # fmt: skip

    print(
        f"\n{'detector':<36}{'stalls':>7}{'visible':>8}{'negatives dropped':>18}{'gap':>5}{'real cartoon':>14}"
    )
    for detector in DETECTORS:
        rows = [row for row in results if row["detector"] == detector.label]
        ranked_rows = [row for row in rows if row["ranked"]]
        cartoon = next(row for row in rows if not row["ranked"])
        print(
            f"{detector.label:<36}{sum(r['stalls'] for r in ranked_rows):>7}"
            f"{sum(r['visible_drops'] for r in ranked_rows):>8}"
            f"{sum(r['real_dropped'] for r in ranked_rows if r['negative']):>18}"
            f"{max(r['longest_gap'] for r in ranked_rows):>5}{cartoon['stalls']:>9} / {cartoon['visible_drops']}",
        )

    out = WORK.parent / "results.json"
    out.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(f"\nper clip: {out}")


if __name__ == "__main__":
    main()
