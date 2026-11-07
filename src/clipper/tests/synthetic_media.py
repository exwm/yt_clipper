"""Small synthetic videos made with ffmpeg, each standing in for a kind of real upload.

Each clip is made losslessly first, so its exact repeated frames are known, then encoded like an
upload. Used by the e2e tests and by tools/encoding/dedupe_eval.py.
"""

import functools
import hashlib
import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from clipper.tests import shaky_media

MOTION = "testsrc2=size=640x360:rate={rate}"
# A textured still: a fixed test pattern, no moving parts.
STILL = "smptehdbars=size=640x360:rate={rate},drawgrid=w=40:h=40:c=white@0.4"
CAMERA_NOISE = "noise=alls=3:allf=t"


def movingBox(size: int, speed: int) -> str:
    """Follows a graph ending in a still: a white box moving across it at `speed` px/s."""
    return (
        f"[bg];color=white:size={size}x{size}:rate={{rate}}[box];"
        f"[bg][box]overlay=x='mod(t*{speed},{640 - size})':y=150"
    )


# Upload encodes. x264 at a good quality codes a repeat as skipped blocks, so it decodes nearly
# like the frame before. Low quality vp9 (as on YouTube) keeps refining a held frame, so its repeats
# differ from the frame before by encoder noise.
UPLOADS = {
    "x264": (("-c:v", "libx264", "-crf", "20", "-preset", "medium"), "mp4"),
    "vp9-low": (
        ("-c:v", "libvpx-vp9", "-crf", "50", "-b:v", "0", "-cpu-used", "4", "-row-mt", "1"),
        "webm",
    ),
    "vp9-mid": (
        ("-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-cpu-used", "4", "-row-mt", "1"),
        "webm",
    ),
}


@dataclass(frozen=True)
class SyntheticClip:
    description: str
    # ffmpeg lavfi graph of the lossless clip
    source: str
    upload: str
    # Extra encode args, e.g. to keep a variable frame rate
    encodeArgs: tuple[str, ...] = field(default=())


def at(graph: str, rate: str) -> str:
    return graph.format(rate=rate)


CLIPS = {
    "motion-24-in-30": SyntheticClip("repeats in motion", at(f"{MOTION},fps=30000/1001", "24000/1001"), "x264"),
    "motion-24-in-30-vp9": SyntheticClip("repeats in motion, noisy upload", at(f"{MOTION},fps=30000/1001", "24000/1001"), "vp9-low"),
    "still-noise-24": SyntheticClip("a still with camera noise, no repeats", at(f"{STILL},{CAMERA_NOISE}", "24000/1001"), "x264"),
    "still-noise-24-in-30": SyntheticClip("repeats among near identical frames", at(f"{STILL},{CAMERA_NOISE},fps=30000/1001", "24000/1001"), "x264"),
    "still-start-and-end": SyntheticClip(
        "motion between a still start and a still end",
        at(f"{MOTION},trim=duration=2,tpad=start_mode=clone:start_duration=1.5:stop_mode=clone:stop_duration=1.5", "30000/1001"),
        "vp9-low",
    ),
    "cartoon-12-in-30": SyntheticClip("animation at 12 fps stored at 30, noisy upload", at(f"{MOTION},fps=30000/1001", "12"), "vp9-low"),
    "small-motion-12-in-30": SyntheticClip(
        "a small box moving over a still, 12 fps in 30",
        at(f"{STILL}{movingBox(40, 150)},fps=30000/1001[out0]", "12"),
        "vp9-low",
    ),
    "tiny-motion-noisy-12-in-30": SyntheticClip(
        "a tiny box moving over a noisy still, 12 fps in 30, noisy upload",
        at(f"{STILL},{CAMERA_NOISE}{movingBox(16, 60)},fps=30000/1001[out0]", "12"),
        "vp9-low",
    ),
    "vfr-motion": SyntheticClip(
        "motion with every third frame missing, timestamps kept",
        at(f"{MOTION},select='not(eq(mod(n\\,3)\\,2))'", "30000/1001"),
        "x264",
        ("-fps_mode", "passthrough"),
    ),
    # Hard cases: a keyframe repaints the noisy still with fresh noise, which changes the frame
    # more than the small box moving does.
    "small-motion-noisy": SyntheticClip(
        "a 32 px box moving over a noisy still, 12 fps in 30, noisy upload",
        at(f"{STILL},{CAMERA_NOISE}{movingBox(32, 60)},fps=30000/1001[out0]", "12"),
        "vp9-low",
    ),
    "tiny-motion-noisy-mid-upload": SyntheticClip(
        "the tiny box over a noisy still, uploaded at a middle quality",
        at(f"{STILL},{CAMERA_NOISE}{movingBox(16, 60)},fps=30000/1001[out0]", "12"),
        "vp9-mid",
    ),
    # Like the real e2e cartoon's slow stretch: each drawing moves only a little, so its change is
    # close to the encoder noise on the repeats.
    "cartoon-slow-12-in-30": SyntheticClip(
        "animation at 12 fps stored at 30 with slow movement, noisy upload",
        at(f"{STILL},{CAMERA_NOISE}{movingBox(160, 24)},fps=30000/1001[out0]", "12"),
        "vp9-low",
    ),
    # High frame rate: 30 fps content doubled to 60, and real 60 fps motion
    "motion-30-in-60": SyntheticClip("30 fps motion doubled to 60, noisy upload", at(f"{MOTION},fps=60000/1001", "30000/1001"), "vp9-low"),
    "motion-native-60": SyntheticClip("no repeats: motion at 60 fps", at(MOTION, "60000/1001"), "vp9-low"),
    # No repeats: every frame dropped from these is a mistake.
    "motion-native-30": SyntheticClip("no repeats: motion at its own frame rate", at(MOTION, "30000/1001"), "vp9-low"),
    "pan-slow": SyntheticClip("no repeats: a slow pan over a still", at(f"{STILL},scroll=horizontal=0.003", "30000/1001"), "vp9-low"),
    "fade": SyntheticClip("no repeats: a still fading out", at(f"{STILL},fade=t=out:st=0:d=5", "30000/1001"), "vp9-low"),
    "dark-motion": SyntheticClip(
        "no repeats: dark, noisy, low contrast motion",
        at(f"{MOTION},lutyuv=y=16+val/8,{CAMERA_NOISE}", "30000/1001"),
        "vp9-low",
    ),
    "tiny-motion-native": SyntheticClip(
        "no repeats: the tiny box over a noisy still at its own frame rate",
        at(f"{STILL},{CAMERA_NOISE}{movingBox(16, 60)}[out0]", "30000/1001"),
        "vp9-low",
    ),
    "noisy-still-cut-to-motion": SyntheticClip(
        "no repeats: a noisy still that cuts to motion at 2 s",
        at(f"{STILL},{CAMERA_NOISE}[still];{MOTION}[motion];[still][motion]overlay=enable='gte(t,2)'[out0]", "30000/1001"),
        "vp9-low",
    ),
    # Repeats that stand for different things, for the timing of kept frames
    "lost-frames": SyntheticClip(
        "lost frames replaced by a copy of the one before (A A C)",
        at(f"{MOTION},select='not(eq(mod(n\\,7)\\,3)+eq(mod(n\\,11)\\,5))',fps=30000/1001", "30000/1001"),
        "vp9-low",
    ),
    "added-copies": SyntheticClip(
        "copies added while the scene paused (A A B)",
        at(f"{MOTION},setpts='(N+floor((N+4)/9))/FR/TB',fps=30000/1001", "30000/1001"),
        "vp9-low",
    ),
}  # fmt: skip


@functools.cache
def ffmpegVersion(ffmpeg: str) -> str:
    return subprocess.run(
        [ffmpeg, "-version"], capture_output=True, text=True, check=True
    ).stdout.splitlines()[0]


def makeWhole(path: Path, command: list[str]) -> None:
    """Runs an ffmpeg command whose last argument is the output, into a partial file of this process
    first, so a stopped run never leaves a file that looks made and test workers sharing the folder
    never write the same file."""
    partial = path.with_name(f"partial-{os.getpid()}-{path.name}")
    subprocess.run([*command, str(partial)], check=True)
    try:
        partial.replace(path)
    except PermissionError:
        # Windows: another worker made it first and a test is reading it
        if not path.exists():
            raise
        partial.unlink()


def mediaFolder(ffmpeg: str) -> Path:
    """A folder for the clips kept between test runs and shared by the test workers, as the shaky
    clips' is."""
    return shaky_media.mediaFolder(ffmpeg, Path(__file__), "yt_clipper-synthetic-media")


def makeSyntheticClip(
    ffmpeg: str,
    name: str,
    folder: Path,
    seconds: float = 5,
) -> tuple[Path, Path]:
    """The lossless clip (exact frames) and the uploaded one, made once per folder and recipe."""
    clip = CLIPS[name]
    encode, container = UPLOADS[clip.upload]
    recipe = [clip.source, clip.encodeArgs, encode, seconds, ffmpegVersion(ffmpeg)]
    key = hashlib.sha256(json.dumps(recipe).encode()).hexdigest()[:12]
    folder.mkdir(parents=True, exist_ok=True)
    lossless = folder / f"{name}-{key}.mkv"
    if not lossless.exists():
        makeWhole(
            lossless,
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", clip.source,
             "-t", str(seconds), *clip.encodeArgs, "-c:v", "ffv1", "-pix_fmt", "yuv420p"],
        )  # fmt: skip
    uploaded = folder / f"{name}-{key}.{container}"
    if not uploaded.exists():
        makeWhole(
            uploaded,
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(lossless), *encode,
             *clip.encodeArgs, "-pix_fmt", "yuv420p"],
        )  # fmt: skip
    return lossless, uploaded


def repeatedFrames(ffmpeg: str, lossless: Path) -> set[int]:
    """The frames identical to the frame before."""
    out = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(lossless), "-f", "framemd5", "-"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    hashes = [
        line.rsplit(",", 1)[1].strip() for line in out.splitlines() if not line.startswith("#")
    ]
    return {n for n in range(1, len(hashes)) if hashes[n] == hashes[n - 1]}
