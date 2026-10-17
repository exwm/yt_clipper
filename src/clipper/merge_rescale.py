"""Merges of clips of different sizes, rescaled to one size.

A merge copies its clips' streams, so a merge of clips of different sizes changes size at each join.
FFmpeg's AV1 hardware decoding keeps the first clip's frame size there and shows corrupted colors or
drops frames (FFmpeg issue 24132), so AV1 merges are rescaled by default; `--merge-rescale always`
does it for every codec, and `never` merges as is after asking. Clips keep their own size: a merge
that needs another size uses a rescaled copy, which later runs reuse.
"""

import contextlib
import glob
import os
import shlex
import subprocess
from collections.abc import Callable
from pathlib import Path

from clipper.clipper_types import ClipperPaths, ClipperState, DictStrAny, Settings, argvPath
from clipper.ffmpeg_codec import getFfmpegVideoCodecArgs, isHardwareAcceleratedVideoCodec
from clipper.merge_inputs import PROBE_ERRORS, PROBED_CODECS, MergeInput, probeMergeInput
from clipper.merge_sizes import (
    MergeClip,
    Size,
    describeMerge,
    markerPairsText,
    planMergeSizes,
    rescaleFilter,
    sizeText,
)
from clipper.util import escapeSingleQuotesFFmpeg
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.CLIP_MAKER)

MERGE_INPUTS_DIR = "temp/merge-inputs"
# A copy keeps the clip's timing: no speed change, frames at their own timestamps
COPY_TIMING = {"isVariableSpeed": True, "speed": 1, "averageSpeed": 1}

EncodeSettingsForBitrate = Callable[[float], DictStrAny]


def rescalesCodec(settings: Settings, codec: str) -> bool:
    """Whether merges of clips of this probed codec are rescaled to one size."""
    mode = settings.get("mergeRescale", "auto")
    return mode == "always" or (mode == "auto" and codec == "av1")


def canMakeCopies(settings: Settings, codec: str) -> bool:
    """Copies are encoded with --video-codec, which must be a software encoder of the clips' codec."""
    videoCodec = settings["videoCodec"]
    return PROBED_CODECS.get(videoCodec) == codec and not isHardwareAcceleratedVideoCodec(
        videoCodec,
    )


def rescaledCopyPath(cp: ClipperPaths, clipPath: str, size: Size) -> str:
    clip = Path(clipPath)
    return f"{cp.clipsPath}/{MERGE_INPUTS_DIR}/{clip.stem}-{size[0]}x{size[1]}{clip.suffix}"


def validCopySizes(cp: ClipperPaths, clip: MergeInput) -> frozenset[Size]:
    """Sizes of the clip's rescaled copies that are newer than the clip and read back as expected."""
    clipTime = Path(clip.path).stat().st_mtime
    sizes = set()
    pattern = f"{glob.escape(Path(clip.path).stem)}-*x*{Path(clip.path).suffix}"
    for copyPath in (Path(cp.clipsPath) / MERGE_INPUTS_DIR).glob(pattern):
        if copyPath.stat().st_mtime < clipTime:
            continue
        try:
            copy = probeMergeInput(cp, str(copyPath))
        except PROBE_ERRORS:
            continue
        if (
            copy.codec == clip.codec
            and copyPath.name == Path(rescaledCopyPath(cp, clip.path, copy.size)).name
        ):
            sizes.add(copy.size)
    return frozenset(sizes)


def readyMergeInputs(
    cp: ClipperPaths,
    settings: Settings,
    mergeList: list[int],
) -> list[MergeInput] | None:
    """The merge's clips, or None when one is missing or unreadable (the merge reports why)."""
    paths = []
    for pair in mergeList:
        if not 1 <= pair <= len(settings["markerPairs"]):
            return None
        path = settings["markerPairs"][pair - 1].get("filePath")
        if not path or not Path(path).is_file():
            return None
        paths.append(path)
    try:
        return [probeMergeInput(cp, path) for path in paths]
    except PROBE_ERRORS:
        return None


def planMergeRescales(
    cs: ClipperState,
    mergeRequests: list[tuple[str, list[int]]],
) -> dict[str, Size]:
    """The frame size of each merge to rescale, chosen for all of them together, and logged."""
    settings = cs.settings
    cp = cs.clipper_paths
    planned: list[tuple[str, list[int]]] = []
    clips: dict[int, MergeClip] = {}
    for merge, mergeList in mergeRequests:
        inputs = readyMergeInputs(cp, settings, mergeList)
        if inputs is None or len({clip.size for clip in inputs}) <= 1:
            continue
        codecs = {clip.codec for clip in inputs}
        codec = codecs.pop() if len(codecs) == 1 else None
        if codec is None or not rescalesCodec(settings, codec):
            continue
        if not canMakeCopies(settings, codec):
            logger.warning(
                f"Merge {merge} has marker pairs of different sizes, but --video-codec {settings['videoCodec']} "
                f"cannot rescale its {codec} clips. Use --video-codec {codec} to rescale them.",
            )
            continue
        for pair, clip in zip(mergeList, inputs, strict=True):
            if pair not in clips:
                clips[pair] = MergeClip(pair, clip.size, clip.seconds, validCopySizes(cp, clip))
        planned.append((merge, mergeList))
    if not planned:
        return {}

    targets = planMergeSizes([pairs for _, pairs in planned], clips)
    logger.notice(
        "Some players show corrupted colors where a merged clip changes size, so these marker pairs are rescaled "
        f"to one size for their merge. The clips themselves are kept, and the rescaled copies are saved in "
        f"{MERGE_INPUTS_DIR} for later runs. Use --merge-rescale never to turn this off.",
    )
    for (merge, pairs), target in zip(planned, targets, strict=True):
        logger.notice(f"  {describeMerge(merge, pairs, clips, target)}")
    return {merge: target for (merge, _), target in zip(planned, targets, strict=True)}


def copyEncodeSettings(
    settings: Settings,
    pair: int,
    clip: MergeInput,
    target: Size,
    encodeSettingsForBitrate: EncodeSettingsForBitrate,
) -> DictStrAny:
    """The clip's own encode settings: its resolved CRF when this run made it, else the default
    settings for its bitrate at the target size, under any the user set."""
    markerPair = settings["markerPairs"][pair - 1]
    clipKbps = Path(clip.path).stat().st_size * 8 / 1000 / clip.seconds
    targetKbps = clipKbps * (target[0] * target[1]) / (clip.size[0] * clip.size[1])
    mps = {**encodeSettingsForBitrate(targetKbps), **settings, **markerPair.get("overrides", {})}
    if "crf" in markerPair:
        mps["crf"] = markerPair["crf"]
    mps.setdefault("targetMaxBitrate", mps["autoTargetMaxBitrate"])
    # One pass at a quality, with the clip's frames as they are
    return {**mps, "targetSize": 0, "twoPass": False, "minterpFPS": None}


def makeRescaledCopy(
    cs: ClipperState,
    merge: str,
    pair: int,
    clip: MergeInput,
    target: Size,
    encodeSettingsForBitrate: EncodeSettingsForBitrate,
) -> bool:
    """A copy of the clip at target size, encoded like the clip."""
    settings = cs.settings
    cp = cs.clipper_paths
    mps = copyEncodeSettings(settings, pair, clip, target, encodeSettingsForBitrate)
    videoArgs, inputArgs, outputArgs = getFfmpegVideoCodecArgs(
        settings["videoCodec"],
        None,
        COPY_TIMING,
        mps,
    )
    copyPath = rescaledCopyPath(cp, clip.path, target)
    Path(copyPath).parent.mkdir(parents=True, exist_ok=True)
    # Written beside the copy and renamed when done, so an interrupted run leaves no half copy
    partialPath = f"{copyPath}.partial{Path(copyPath).suffix}"
    command = [
        argvPath(cp.ffmpegPath), "-hide_banner", "-loglevel", "error", "-y", *shlex.split(inputArgs),
        "-i", clip.path, "-map", "0:v:0", "-map", "0:a?", "-vf", rescaleFilter(clip.size, target),
        *shlex.split(videoArgs), "-c:a", "copy", *shlex.split(outputArgs), partialPath,
    ]  # fmt: skip
    logger.notice(f"Rescaling {markerPairsText([pair])} to {sizeText(target)} for merge {merge}.")
    if subprocess.run(command, check=False).returncode != 0:
        with contextlib.suppress(OSError):
            os.remove(partialPath)  # noqa: PTH107
        return False
    os.replace(partialPath, copyPath)  # noqa: PTH105
    return True


def rescaledConcatInputs(
    cs: ClipperState,
    merge: str,
    mergeList: list[int],
    inputs: list[MergeInput],
    target: Size,
    encodeSettingsForBitrate: EncodeSettingsForBitrate,
) -> str | None:
    """The merge's concat list, with a rescaled copy of each clip not at the target size, or None
    (logged) when a copy cannot be made."""
    cp = cs.clipper_paths
    lines = []
    for pair, clip in zip(mergeList, inputs, strict=True):
        path = clip.path
        if clip.size != target:
            path = rescaledCopyPath(cp, clip.path, target)
            if target in validCopySizes(cp, clip):
                logger.notice(
                    f"Reusing the {sizeText(target)} copy of {markerPairsText([pair])} for merge {merge}.",
                )
            elif not makeRescaledCopy(cs, merge, pair, clip, target, encodeSettingsForBitrate):
                logger.error(
                    f"Skipped merge {merge}: could not rescale {markerPairsText([pair])}.\n",
                )
                return None
        relative = Path(os.path.relpath(path, cp.clipsPath)).as_posix()
        lines.append(f"file '{escapeSingleQuotesFFmpeg(relative)}'\n")
    return "".join(lines)


def confirmMergeOfDifferentSizes(
    settings: Settings,
    merge: str,
    mergeList: list[int],
    inputs: list[MergeInput],
) -> bool:
    """With --merge-rescale never, asks before an av1 merge whose clips differ in size."""
    pairsBySize: dict[Size, list[int]] = {}
    for pair, clip in zip(mergeList, inputs, strict=True):
        pairsBySize.setdefault(clip.size, []).append(pair)
    if (
        settings.get("mergeRescale") != "never"
        or {clip.codec for clip in inputs} != {"av1"}
        or len(pairsBySize) <= 1
    ):
        return True
    described = ", ".join(
        f"{markerPairsText(pairs)} {'is' if len(set(pairs)) == 1 else 'are'} {sizeText(size)}"
        for size, pairs in pairsBySize.items()
    )
    logger.warning(f"The marker pairs in merge {merge} have different sizes: {described}.")
    logger.warning(
        "Players that decode av1 in hardware show corrupted colors or skip frames where the merged clip changes size.",
    )
    logger.warning(
        "To avoid this, remove --merge-rescale never, or give the marker pairs the same crop size.",
    )
    try:
        answer = input("Merge anyway? (y/n): ")
    except EOFError:
        answer = ""
    if answer.strip().lower() in {"yes", "y"}:
        return True
    logger.warning(f"Skipped merge {merge}.\n")
    return False
