"""Small synthetic videos made with ffmpeg, each standing in for a kind of real upload.

Each clip is made losslessly first, so its exact repeated frames are known, then encoded like an
upload. Used by the e2e tests and by tools/encoding/dedupe_eval.py.
"""

import subprocess
from dataclasses import dataclass, field
from pathlib import Path

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
}  # fmt: skip


def makeSyntheticClip(
    ffmpeg: str,
    name: str,
    folder: Path,
    seconds: float = 5,
) -> tuple[Path, Path]:
    """The lossless clip (exact frames) and the uploaded one, made once per folder."""
    clip = CLIPS[name]
    folder.mkdir(parents=True, exist_ok=True)
    lossless = folder / f"{name}.mkv"
    if not lossless.exists():
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", clip.source,
             "-t", str(seconds), *clip.encodeArgs, "-c:v", "ffv1", "-pix_fmt", "yuv420p", str(lossless)],
            check=True,
        )  # fmt: skip
    encode, container = UPLOADS[clip.upload]
    uploaded = folder / f"{name}.{container}"
    if not uploaded.exists():
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(lossless), *encode,
             *clip.encodeArgs, "-pix_fmt", "yuv420p", str(uploaded)],
            check=True,
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
