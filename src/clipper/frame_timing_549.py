"""5.49's frame decisions: times on the video timeline mean the frame shown there (frame_grid.py). A clip
runs from the frame shown at its start marker through the one at its end marker, seeked and trimmed half a
frame from every frame edge, and crop points take effect on the frame they were placed on."""

import itertools
from fractions import Fraction
from math import floor, log

from clipper.clipper_types import ExtendedRealNumber, SpeedMap
from clipper.frame_grid import FrameGrid, frameAt, frameMiddle, frameSpan
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


def videoInput(mp: DictStrAny, mps: DictStrAny, settings: DictStrAny) -> VideoInput | None:
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


def fastTrimInput(mp: DictStrAny, mps: DictStrAny) -> str | None:
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


def getSpeedFilterAndDuration(
    speedMap: SpeedMap,
    mp: DictStrAny,
    fps: float | Fraction,
) -> tuple[str, ExtendedRealNumber, list[ExtendedRealNumber]]:
    if not mp["isVariableSpeed"]:
        duration = mp["duration"] / mp["speed"]
        return f"setpts=(PTS-STARTPTS)/{mp['speed']}", duration, [0, duration]

    video_filter_speed_map = ""
    setpts = ""
    outputDurations: list[ExtendedRealNumber] = [0]

    fps = Fraction(fps)
    frameDur = 1 / fps
    nSects = len(speedMap) - 1
    # Account for marker pair start time as trim filter sets start time to ~0
    speedMapStartTime = speedMap[0]["x"]

    for sect, (left, right) in enumerate(itertools.pairwise(speedMap)):
        startSpeed = left["y"]
        endSpeed = right["y"]
        speedChange = endSpeed - startSpeed

        sectStart = left["x"] - speedMapStartTime
        sectEnd = right["x"] - speedMapStartTime
        # The map ends at the last frame's end. Its last section runs to that frame's start, the frame
        # then held for a frame below; a speed point inside the last frame leaves that section empty.
        if sect == nSects - 1:
            sectEnd = max(sectStart, right["x"] - frameDur - speedMapStartTime)

        nDurs = len(outputDurations)
        nextDur = 0
        sectDuration = sectEnd - sectStart
        if sectDuration == 0:
            nextDur = outputDurations[nDurs - 1]
            outputDurations.append(nextDur)
            continue

        m = speedChange / sectDuration
        b = startSpeed - m * sectStart

        if speedChange == 0:
            # Duration is time multiplied by slowdown (or time divided by speed)
            sliceDuration = f"(min((T-STARTT-({sectStart})),{sectDuration})/{endSpeed})"
            nextDur = (sectDuration / endSpeed) + outputDurations[nDurs - 1]
        else:
            # Integrate the reciprocal of the linear time vs speed function for the current section
            sliceDuration = f"(1/{m})*(log(abs({m}*min((T-STARTT),{sectEnd})+({b})))-log(abs({m}*{sectStart}+({b}))))"
            nextDur = (
                (1 / m) * (log(abs(m * sectEnd + b)) - log(abs(m * sectStart + b)))
            ) + outputDurations[nDurs - 1]

        outputDurations.append(nextDur)
        sliceDuration = f"if(gte((T-STARTT),{sectStart}), {sliceDuration},0)"

        if sect == 0:
            setpts += f"(if(eq(N,0),0,{sliceDuration}))"
        else:
            setpts += f"+({sliceDuration})"

    video_filter_speed_map += f"""setpts='({setpts})/TB' """

    nDurs = len(outputDurations)
    # The last frame's output time rounds to a whole frame, half up as the markup's twin rounds, and
    # the frame is held for one frame.
    lastFrame = floor(Fraction(outputDurations[nDurs - 1]) * fps + Fraction(1, 2))
    outputDurations[nDurs - 1] = float((lastFrame + 1) / fps)

    outputDuration = outputDurations[nDurs - 1]

    return video_filter_speed_map, outputDuration, outputDurations


def getFrameTimeBetweenLeftFrames(time: float, fps: float) -> float:
    """The ease section end time to use for a crop keyframe placed at `time`.

    `time` is on the input video's timeline, whose frames lie on the 1/fps grid. A clip keeps that
    frame phase, so snapping times relative to a pair start that falls between frames is a frame off.
    A keyframe's time is user-placed and usually overshoots its actual frame. Ending the ease
    just before that frame keeps the normalized ease time reaching 1 by the time playback hits
    the frame, so the transition finishes on it. It shows most for instant ease in, whose
    jump must land on that frame. Landing between frames instead of snapping to a frame boundary
    also avoids float precision issues.
    """
    # The frame the keyframe was placed on, allowing for its time being rounded below that frame's start.
    grid = FrameGrid(origin=0, rate=fps)
    return frameMiddle(grid, frameAt(grid, time) - 1)


def getEaseSectionDuration(
    startTime: float,
    endTime: float,
    fps: float,
) -> float | None:
    realDuration = endTime - startTime
    # Zero/negative duration sections (e.g. redundant hold point pairs) have no
    # frames to render, so skip them.
    if realDuration <= 0:
        return None

    # Pull the end time back toward the last displayed frame so the ease finishes on it
    # rather than at the (usually overshot) keyframe time. See getFrameTimeBetweenLeftFrames.
    adjustedDuration = getFrameTimeBetweenLeftFrames(endTime, fps) - startTime

    # For sections shorter than the adjustment window the adjusted end time can land before
    # the start time. Fall back to the real duration so the section still renders instead of
    # being dropped, which would leave a gap that snaps the crop to 0. Such a short section
    # skips the frame-time adjustment, so an instant ease in here transitions at the next point
    # rather than a frame earlier. That is acceptable since the section spans under ~1.5 frames.
    if adjustedDuration <= 0:
        return realDuration

    return adjustedDuration


def getSectionEaseDuration(
    easeType: str,
    startTime: float,
    endTime: float,
    fps: float,
) -> float | None:
    """The span a section eases over, from start and end times on the input video's timeline. smoothTrack spans the points' real times, so its sections meet
    exactly and the crop keeps its speed through each point on any frame grid (the clip's frames start
    at the pair's own frame phase, not at multiples of 1/fps). A pulled-back end held it for part of a
    frame at every point. Mirrors the markup's getSmoothTrackCropComponentsAtTime."""
    if easeType == "smoothTrack":
        realDuration = endTime - startTime
        return realDuration if realDuration > 0 else None
    return getEaseSectionDuration(startTime, endTime, fps)


def sectionEaseDurationFromVideoPart(
    easeType: str, leftX: float, rightX: float, firstTime: float, videoPartStart: float, fps: float
) -> float | None:
    """5.49's span for a crop section (frame_timing.SectionEaseDuration): crop points count their frames
    from the video part's first frame."""
    return getSectionEaseDuration(easeType, leftX - videoPartStart, rightX - videoPartStart, fps)


def cutTime(
    cutX: float, previousX: float, fps: float | None, firstTime: float, videoPartStart: float
) -> float:
    """When a cut takes effect: half a frame before the frame the cut point falls in, as the other
    crop easings end a section (getEaseSectionDuration). A user-placed point usually
    overshoots its frame, so at the raw time the first frame of the new scene would keep the old crop.
    Frames lie on the input video's 1/fps grid, which starts at videoPartStart in crop point time.
    """
    if not fps:
        return cutX
    grid = FrameGrid(origin=videoPartStart, rate=fps)
    # The frame the cut point was placed on, allowing for its time being rounded below that frame's start.
    frame = frameAt(grid, cutX)
    snapped = frameMiddle(grid, frame - 1)
    return snapped if snapped > previousX else cutX


def varyingRateNote(rate: float | None) -> list[str]:
    stray = "a clip's first or last frame and instant crop points can be a frame off."
    if rate is None:
        return [
            "Clips use a constant frame rate,",
            f"so where the video's frames stray from it, {stray}",
        ]
    return [
        f"Clips use a constant {rate:.3f} fps,",
        f"so where the video's frames stray from that rate, {stray}",
    ]


FRAME_TIMING = FrameTiming(
    name="5.49",
    clipSpan=clipSpan,
    videoInput=videoInput,
    fastTrimInput=fastTrimInput,
    audioFilter=audioFilter,
    speedFilter=getSpeedFilterAndDuration,
    sectionEaseDuration=sectionEaseDurationFromVideoPart,
    cutTime=cutTime,
    varyingRateNote=varyingRateNote,
)
