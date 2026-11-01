"""5.48.0's frame decisions, for the `LEGACY_FRAME_TIMING` build. 5.48 had no frame grid: it passed the raw
marker times to ffmpeg (`-ss {start}` and `trim=0:{duration}`), so ffmpeg's own rounding to the video's
time base picks the frames, and it timed crop points from the start marker. Each piece is v5.48.0's code,
cited as file:line; test_frame_timing_548_source.py checks it against the tag.

Three 5.49 fixes are left out here, each its own decision so it can be switched on later: crop points
timed from the video's first frame (sectionEaseDuration), audio starting with the first frame (audioFilter),
and a local video's own timestamps for `-ss` (videoInput, fastTrimInput).
"""

from fractions import Fraction
from math import floor, log
from typing import List, Optional, Tuple, Union

from clipper.clipper_types import ExtendedRealNumber, SpeedMap
from clipper.frame_timing import ClipSpan, DictStrAny, FrameTiming, VideoInput


def clipSpan(mp: DictStrAny, mps: DictStrAny, videoPartDelay: float) -> ClipSpan:
    # clip_maker.py:135-136. The maps keep their saved points, and a sample-guided window clips only the
    # video (orchestrator.py:2508-2509 sets start and end alone).
    return ClipSpan(
        start=mp["start"] + mps["delay"] - videoPartDelay,
        end=mp["end"] + mps["delay"] - videoPartDelay,
    )


def videoInput(mp: DictStrAny, mps: DictStrAny, settings: DictStrAny) -> Optional[VideoInput]:
    # clip_maker.py:492-503.
    if mps["inputVideo"]:
        inputs = f' -ss {mp["start"]} -i "{mps["inputVideo"]}" '
    elif mps["videoType"] != "multi_video":
        inputs = f' -ss {mp["start"]} -i "{mps["videoDownloadURL"]}" '
    elif "videoPart" in mp:
        videoPart = mp["videoPart"]
        inputs = f' -ss {mp["start"]} -i "{videoPart["url"]}" '
    else:
        return None
    # clip_maker.py:515-518.
    trim = f"trim=0:{mp['duration']}" if not mps["preview"] else f"trim={mp['start']}:{mp['end']}"
    return VideoInput(inputs=inputs, trim=trim)


def fastTrimInput(mp: DictStrAny, mps: DictStrAny) -> Optional[str]:
    # clip_maker.py:371-384.
    videoStart = mp["start"]
    videoEnd = mp["end"]
    if mps["inputVideo"]:
        return f' -ss {videoStart} -to {videoEnd} -i "{mps["inputVideo"]}" '
    if mps["videoType"] != "multi_video":
        return f' -ss {videoStart} -to {videoEnd} -i "{mps["videoDownloadURL"]}" '
    if "videoPart" in mp:
        videoPart = mp["videoPart"]
        return f' -ss {videoStart} -to {videoEnd} -i "{videoPart["url"]}" '
    return None


def audioFilter(mp: DictStrAny, mps: DictStrAny, aDuration: float) -> str:
    # clip_maker.py:476: the audio starts at the start marker, with atempo at every speed.
    return f"atrim=0:{aDuration},atempo={mp['speed']}"


# ffmpeg_filter.py:218-294.
def getSpeedFilterAndDuration(
    speedMap: SpeedMap,
    mp: DictStrAny,
    fps: Union[float, Fraction],
) -> Tuple[str, ExtendedRealNumber, List[ExtendedRealNumber]]:
    if not mp["isVariableSpeed"]:
        duration = mp["duration"] / mp["speed"]
        return f"setpts=(PTS-STARTPTS)/{mp['speed']}", duration, [0, duration]

    video_filter_speed_map = ""
    setpts = ""
    outputDurations: List[ExtendedRealNumber] = [0]

    fps = Fraction(fps)
    frameDur = 1 / fps
    nSects = len(speedMap) - 1
    # Account for marker pair start time as trim filter sets start time to ~0
    speedMapStartTime = speedMap[0]["x"]

    for sect, (left, right) in enumerate(zip(speedMap[:-1], speedMap[1:])):
        startSpeed = left["y"]
        endSpeed = right["y"]
        speedChange = endSpeed - startSpeed

        sectStart = left["x"] - speedMapStartTime
        sectEnd = right["x"] - speedMapStartTime
        # Account for last input frame delay due to potentially imprecise trim
        if sect == nSects - 1:
            sectEnd = floor(right["x"] / frameDur) * frameDur
            # When trim is frame-precise, the frame that begins at the marker pair end time is not included
            if right["x"] - sectEnd < 1e-10:
                sectEnd = sectEnd - frameDur
            sectEnd = sectEnd - speedMapStartTime
            sectEnd = floor(sectEnd * 1000000) / 1000000

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
    # Each output frame time is rounded to the nearest multiple of a frame's duration at the given fps
    outputDurations[nDurs - 1] = round(outputDurations[nDurs - 1] / frameDur) * frameDur
    # The last included frame is held for a single frame's duration
    outputDurations[nDurs - 1] += frameDur
    outputDurations[nDurs - 1] = round(outputDurations[nDurs - 1] * 1000) / 1000

    outputDuration = outputDurations[nDurs - 1]

    return video_filter_speed_map, outputDuration, outputDurations


# ffmpeg_filter.py:564-577.
def getFrameTimeBetweenLeftFrames(time: float, fps: float) -> float:
    leftFrameIndex = floor(time * fps)

    midpointTime = (leftFrameIndex - 0.5) / fps

    return midpointTime


# ffmpeg_filter.py:580-603.
def getEaseSectionDuration(
    startTime: float,
    endTime: float,
    fps: float,
) -> Optional[float]:
    realDuration = endTime - startTime
    if realDuration <= 0:
        return None

    adjustedDuration = getFrameTimeBetweenLeftFrames(endTime, fps) - startTime

    if adjustedDuration <= 0:
        return realDuration

    return adjustedDuration


def sectionEaseDuration(
    easeType: str, leftX: float, rightX: float, firstTime: float, videoPartStart: float, fps: float
) -> Optional[float]:
    # Smooth Track is new in 5.49 and keeps its sections' real span (ffmpeg_filter.getSectionEaseDuration).
    if easeType == "smoothTrack":
        realDuration = rightX - leftX
        return realDuration if realDuration > 0 else None
    # ffmpeg_filter.py:331-344 and 405-436 (crop and zoompan): times from the crop map's first point, the
    # start marker.
    return getEaseSectionDuration(leftX - firstTime, rightX - firstTime, fps)


def cutTime(
    cutX: float, previousX: float, fps: Optional[float], firstTime: float, videoPartStart: float
) -> float:
    """Cinematic is new in 5.49: under 5.48's frame timing its cut takes effect where 5.48 ends an instant
    crop point's section, from the start marker (getEaseSectionDuration)."""
    if not fps:
        return cutX
    snapped = firstTime + getFrameTimeBetweenLeftFrames(cutX - firstTime, fps)
    return snapped if snapped > previousX else cutX


FRAME_TIMING = FrameTiming(
    name="5.48",
    clipSpan=clipSpan,
    videoInput=videoInput,
    fastTrimInput=fastTrimInput,
    audioFilter=audioFilter,
    speedFilter=getSpeedFilterAndDuration,
    sectionEaseDuration=sectionEaseDuration,
    cutTime=cutTime,
)
