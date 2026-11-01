"""Measure clips' traits: each clip decoded once, small and gray, and every trait family read from
the same frames. Dataset items are read straight from their URL, so a survey downloads only the
seconds it reads.

Trait families:
- stabilization: clip_character.py (brightness changes, grain, motion, subject motion, ...)
- encoding: detail and change between frames (ITU-T P.910 SI and TI, here on the small frames), and
  the share of dark, flat pixels, where encoders band
"""

import itertools
import json
import subprocess
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import numpy as np
from media_steps import Steps

from clipper.tests.clip_character import asDict, measure

SURVEY_WIDTH = 480
# Dark and flat: below this luma and with less local change than FLAT, the areas encoders band
DARK = 64
FLAT = 2.0


@dataclass(frozen=True)
class Source:
    ref: str
    # A local path or a URL
    location: str
    # Clips from one source video count once in coverage
    group: str
    meta: dict = field(default_factory=dict, compare=False, hash=False)


@dataclass(frozen=True)
class Frames:
    frames: np.ndarray
    fps: float


def read_frames(ffmpeg: str, location: str, seconds: float) -> Frames:
    """The first seconds of a clip at SURVEY_WIDTH in gray, from one decode (y4m keeps the size)."""
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-t", str(seconds), "-i", location, "-an",
               "-vf", f"scale={SURVEY_WIDTH}:-2:flags=area,format=gray", "-f", "yuv4mpegpipe", "-strict", "-1", "-"]  # fmt: skip
    data = subprocess.run(command, capture_output=True, check=True, stdin=subprocess.DEVNULL).stdout
    header, _, body = data.partition(b"\n")
    tokens = {token[:1]: token[1:] for token in header.split()[1:]}
    width, height = int(tokens[b"W"]), int(tokens[b"H"])
    fps = float(Fraction(tokens[b"F"].decode().replace(":", "/")))
    frame = len(b"FRAME\n") + width * height
    count = len(body) // frame
    frames = np.frombuffer(body[: count * frame], np.uint8).reshape(count, frame)[
        :,
        len(b"FRAME\n") :,
    ]
    return Frames(frames.reshape(count, height, width), fps)


def sobel(frame: np.ndarray) -> np.ndarray:
    f = frame.astype(np.float32)
    gx = (f[:-2, 2:] + 2 * f[1:-1, 2:] + f[2:, 2:]) - (f[:-2, :-2] + 2 * f[1:-1, :-2] + f[2:, :-2])
    gy = (f[2:, :-2] + 2 * f[2:, 1:-1] + f[2:, 2:]) - (f[:-2, :-2] + 2 * f[:-2, 1:-1] + f[:-2, 2:])
    return np.hypot(gx, gy)


def encoding_traits(frames: np.ndarray) -> dict[str, float]:
    gradients = [sobel(f) for f in frames]
    flat = [
        ((f[1:-1, 1:-1] < DARK) & (g < FLAT)).mean() for f, g in zip(frames, gradients, strict=True)
    ]
    changes = [np.std(b.astype(np.float32) - a) for a, b in itertools.pairwise(frames)]
    return {
        "si": float(np.mean([g.std() for g in gradients])),
        "ti": float(np.mean(changes)) if changes else 0.0,
        "dark_flat": float(np.mean(flat)),
    }


FAMILIES: dict[str, Callable[[np.ndarray], dict[str, float]]] = {
    # As the tests read frames (stabilization_metrics.grayFrames), so values compare
    "stabilization": lambda frames: asDict(measure(frames.astype(np.float64))),
    "encoding": encoding_traits,
}


def survey_one(
    ffmpeg: str,
    source: Source,
    families: list[str],
    seconds: float,
    steps: Steps,
) -> dict:
    row = {
        "ref": source.ref,
        "group": source.group,
        "seconds": seconds,
        "families": families,
        "meta": source.meta,
    }
    try:
        with steps.step("decode"):
            read = read_frames(ffmpeg, source.location, seconds)
        traits = {}
        for family in families:
            with steps.step(family):
                traits.update(FAMILIES[family](read.frames))
    except (subprocess.CalledProcessError, ValueError, KeyError) as error:
        return {**row, "error": str(error)[:200]}
    height, width = read.frames.shape[1:]
    return {
        **row,
        "width": width,
        "height": height,
        "fps": read.fps,
        "frames": len(read.frames),
        "traits": traits,
    }


def survey(
    ffmpeg: str,
    sources: Iterable[Source],
    out: Path,
    families: list[str],
    seconds: float,
    workers: int,
    steps: Steps,
) -> int:
    """Appends a row per source to the JSON lines file, skipping sources it already has for these
    families and seconds. Returns how many it measured."""
    done = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            done.add((row["ref"], row["seconds"], tuple(row["families"])))
    todo = [s for s in sources if (s.ref, seconds, tuple(families)) not in done]
    out.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(workers) as pool, out.open("a", encoding="utf-8") as file:
        for row in pool.map(lambda s: survey_one(ffmpeg, s, families, seconds, steps), todo):
            file.write(json.dumps(row) + "\n")
            file.flush()
            print(f"{row['ref']}{' failed: ' + row['error'] if 'error' in row else ''}", flush=True)
    return len(todo)
