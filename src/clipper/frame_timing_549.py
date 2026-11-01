"""5.49's frame decisions: times on the video timeline mean the frame shown there (frame_grid.py). A clip
runs from the frame shown at its start marker through the one at its end marker, seeked and trimmed half a
frame from every frame edge, and crop points take effect on the frame they were placed on."""

from fractions import Fraction
from typing import Optional

from clipper import cinematic_path, ffmpeg_filter
from clipper.frame_grid import FrameGrid, frameSpan
from clipper.frame_timing import ClipSpan, DictStrAny, FrameTiming, VideoInput


def clipFrameGrid(mps: DictStrAny) -> FrameGrid:
    """The source's frames on the markers' timeline. A local video is seeked by its own timestamps
    (-seek_timestamp 1), which start at its video stream's start time; a network stream from 0."""
    origin = float(mps.get("start_time") or 0) if mps["inputVideo"] else 0.0
    return FrameGrid(origin=origin, rate=Fraction(mps["r_frame_rate"]))


def clipSpan(mp: DictStrAny, mps: DictStrAny, videoPartDelay: float) -> ClipSpan:
    grid = clipFrameGrid(mps)
    span = frameSpan(
        grid, mp["start"] + mps["delay"] - videoPartDelay, mp["end"] + mps["delay"] - videoPartDelay
    )
    # The maps' ends are the pair's own, also when a sample-guided trial clips a window of it.
    pairSpan = frameSpan(
        grid,
        mp.get("pairStart", mp["start"]) + mps["delay"] - videoPartDelay,
        mp.get("pairEnd", mp["end"]) + mps["delay"] - videoPartDelay,
    )
    # The speed and crop maps stay on the video's timeline (the markers' plus the delay).
    mapsStart, mapsEnd = pairSpan.start + videoPartDelay, pairSpan.end + videoPartDelay
    return ClipSpan(
        start=span.start,
        end=span.end,
        seekTo=span.seekTo,
        trimEnd=span.trimEnd,
        speedMapEnds=(mapsStart, mapsEnd),
        # The crop map's last point sits mid last frame, where an ease into it finishes on that frame.
        cropMapEnds=(mapsStart, mapsStart + pairSpan.trimEnd),
        speedMapWindow=(span.start + videoPartDelay, span.end + videoPartDelay)
        if span != pairSpan
        else None,
        cropMapTimeOffset=span.start - pairSpan.start,
        # The video part's frames start at its first frame.
        cropFrameOrigin=videoPartDelay + grid.origin,
    )


def videoInput(mp: DictStrAny, mps: DictStrAny, settings: DictStrAny) -> Optional[VideoInput]:
    # -seek_timestamp 1: in a local video, -ss is the video's own timestamp, as the markup's player time
    # is, not an offset from the file's start time, which audio pre-roll can make negative. Network
    # streams keep the offset, which matches players that count from an HLS stream's start. ffplay has
    # no such option and always seeks from the file's start time, so the preview subtracts it.
    # Each seeks half a frame before the first frame, which keeps that frame and drops the one before.
    if mps["inputVideo"] and settings["preview"]:
        inputs = (
            f' -ss {mp["seekTo"] - settings.get("inputStartTime", 0)} -i "{mps["inputVideo"]}" '
        )
    elif mps["inputVideo"]:
        inputs = f' -seek_timestamp 1 -ss {mp["seekTo"]} -i "{mps["inputVideo"]}" '
    elif mps["videoType"] != "multi_video":
        inputs = f' -ss {mp["seekTo"]} -i "{mps["videoDownloadURL"]}" '
    elif "videoPart" in mp:
        inputs = f' -ss {mp["seekTo"]} -i "{mp["videoPart"]["url"]}" '
    else:
        return None
    # Time 0 is the first frame's start, and the trim ends mid last frame, half a frame from both its
    # neighbors.
    if not mps["preview"]:
        trim = f"setpts=PTS-STARTPTS,trim=0:{mp['trimEnd']}"
    else:
        trim = f"trim={mp['seekTo']}:{mp['start'] + mp['trimEnd']}"
    return VideoInput(inputs=inputs, trim=trim)


def fastTrimInput(mp: DictStrAny, mps: DictStrAny) -> Optional[str]:
    videoStart, videoEnd = mp["start"], mp["end"]
    if mps["inputVideo"]:
        return f' -seek_timestamp 1 -ss {videoStart} -to {videoEnd} -i "{mps["inputVideo"]}" '
    if mps["videoType"] != "multi_video":
        return f' -ss {videoStart} -to {videoEnd} -i "{mps["videoDownloadURL"]}" '
    if "videoPart" in mp:
        return f' -ss {videoStart} -to {videoEnd} -i "{mp["videoPart"]["url"]}" '
    return None


def audioFilter(mp: DictStrAny, mps: DictStrAny, aDuration: float) -> str:
    # A local video's audio comes with the video, seeked half a frame before the first frame: it starts
    # with that frame.
    audioOffset = mp["start"] - mp["seekTo"] if mps["inputVideo"] else 0
    audio_filter = f"atrim={audioOffset}:{audioOffset + aDuration},asetpts=PTS-STARTPTS"
    # atempo plays its output ahead of its input (about 10 ms at tempo 1, more for sparse sounds), so normal
    # speed skips it.
    if mp["speed"] != 1:
        audio_filter += f",atempo={mp['speed']}"
    return audio_filter


FRAME_TIMING = FrameTiming(
    name="5.49",
    clipSpan=clipSpan,
    videoInput=videoInput,
    fastTrimInput=fastTrimInput,
    audioFilter=audioFilter,
    speedFilter=ffmpeg_filter.getSpeedFilterAndDuration,
    sectionEaseDuration=ffmpeg_filter.sectionEaseDurationFromVideoPart,
    cutTime=cinematic_path.cutTime,
)
