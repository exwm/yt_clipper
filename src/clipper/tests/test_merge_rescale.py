import json
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from clipper import banded_lapack, clip_maker, merge_inputs, merge_rescale
from clipper.clipper_types import ClipperPaths, ClipperState
from clipper.ffmpeg_codec import dynamic_range
from clipper.merge_inputs import MergeInput, StreamTraits, probeMergeInput

SETTINGS = {
    "cropResWidth": 1920,
    "cropResHeight": 1080,
    "cropMultipleX": 1,
    "cropMultipleY": 1,
    "width": 1920,
    "height": 1080,
}


def test_a_cinematic_pair_that_cannot_be_solved_has_no_predicted_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Too long for the dense solve, so without banded LAPACK the solve fails; the merge is then
    # rescaled when merging rather than stopping the run before encoding.
    monkeypatch.setattr(banded_lapack, "lapack", lambda: None)
    pair = {
        "crop": "0:0:640:360",
        "cropMap": [
            {"x": 0, "y": 0, "crop": "0:0:640:360"},
            {"x": 300, "y": 0, "crop": "0:0:1280:720"},
        ],
        "overrides": {"cropPointEasing": "cinematic"},
    }
    assert merge_rescale.predictClipSize(SETTINGS, pair) is None


def test_a_merge_whose_rescaled_copy_fails_is_reported_as_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sizes = {"clip-1.mp4": (640, 360), "clip-2.mp4": (320, 180)}
    for name in sizes:
        (tmp_path / name).write_bytes(b"")

    def probe(_cp: object, path: str) -> MergeInput:
        traits = StreamTraits("30/1", "1/82882800", "yuv420p", None, None, None, None)
        return MergeInput(path, "av1", sizes[Path(path).name], 2.0, traits)

    monkeypatch.setattr(merge_inputs, "probeMergeInput", probe)
    monkeypatch.setattr(merge_rescale, "probeMergeInput", probe)
    monkeypatch.setattr(merge_rescale, "makeRescaledCopy", lambda *_args: False)
    cs = ClipperState(
        settings={
            "markerPairMergeList": "1-2",
            "markerPairs": [
                {"overrides": {}, "fileName": name, "filePath": str(tmp_path / name)}
                for name in sizes
            ],
            "titleSuffix": "video",
            "videoCodec": "av1",
            "overwrite": False,
        }
    )
    cs.clipper_paths.clipsPath = str(tmp_path)
    assert clip_maker.mergeClips(cs) == ["merge 1-2"]


CLIP_TRAITS = StreamTraits("1740538800/86533207", "1/82882800", "yuv420p", "tv", None, None, None)


@pytest.mark.parametrize(
    ("copyTraits", "matches"),
    [
        pytest.param(CLIP_TRAITS, True, id="same"),
        # SVT-AV1's copy of a vfr clip ends its last frame 76 us later
        pytest.param(
            replace(CLIP_TRAITS, frameRate="870269400/43269761"), True, id="last frame longer"
        ),
        pytest.param(replace(CLIP_TRAITS, frameRate="207207000/10317361"), False, id="retimed"),
        pytest.param(replace(CLIP_TRAITS, frameRate="0/0"), False, id="no rate"),
        pytest.param(replace(CLIP_TRAITS, pixelFormat="yuv420p10le"), False, id="10-bit"),
        pytest.param(replace(CLIP_TRAITS, colorRange=None), False, id="untagged"),
    ],
)
def test_a_copy_has_its_clips_traits_with_the_frame_rate_within_a_tolerance(
    copyTraits: StreamTraits, matches: bool
) -> None:
    clip = MergeInput("clip.mp4", "av1", (320, 180), 1.0, CLIP_TRAITS)
    copy = MergeInput("copy.mp4", "av1", (640, 360), 1.0, copyTraits)
    assert merge_rescale.hasClipTraits(copy, clip) == matches


@pytest.fixture
def svtav1() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg")
    encoders = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=True
    ).stdout
    if " libsvtav1 " not in encoders:
        pytest.skip("needs ffmpeg with libsvtav1")
    return ffmpeg


def makeAv1Clip(ffmpeg: str, path: Path, rate: str, *encodeArgs: str) -> Path:
    """A small AV1 clip at 320x180 in the mp4 timescale every clip uses."""
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"testsrc2=size=320x180:rate={rate}:duration=1", "-c:v", "libsvtav1", "-preset", "12",
         *encodeArgs, "-video_track_timescale", "82882800", str(path)],
        check=True,
    )  # fmt: skip
    return path


def probeVideo(path: Path, entries: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", entries,
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    return json.loads(out)


def lastPts(path: Path) -> int:
    return max(int(packet["pts"]) for packet in probeVideo(path, "packet=pts")["packets"])


def rescaleToMerge(tmp_path: Path, clip: Path, **settings: object) -> Path | None:
    """Rescales the clip to 640x360 as a merge does, and returns the copy, or None when it failed."""
    cs = ClipperState(
        settings={
            "videoCodec": "av1",
            "markerPairs": [{"overrides": {}, "filePath": str(clip)}],
            "enableHDR": False,
            # The source video's rate, which a clip made by video2x or a speed change no longer has
            "r_frame_rate": "30",
            "targetSize": 0,
            **settings,
        }
    )
    cp = cs.clipper_paths
    cp.clipsPath = str(tmp_path)
    inputs = [probeMergeInput(cp, str(clip))]
    lines = merge_rescale.rescaledConcatInputs(
        cs, "1", [1], inputs, (640, 360), clip_maker.getDefaultEncodeSettings
    )
    if lines is None:
        return None
    return Path(merge_rescale.rescaledCopyPath(cp, str(clip), (640, 360)))


def test_an_av1_copy_of_a_clip_whose_frames_fit_no_frame_rate_keeps_its_timestamps(
    tmp_path: Path, svtav1: str
) -> None:
    # Like video2x's x3 of 29.97 fps: 90000/1001 fps frames don't land on whole mp4 ticks, so
    # ffprobe reads the timescale as the frame rate, which SVT-AV1 refuses (over 240 fps)
    clip = makeAv1Clip(svtav1, tmp_path / "clip.mp4", "90000/1001", "-fps_mode", "vfr")
    assert probeVideo(clip, "stream=r_frame_rate")["streams"][0]["r_frame_rate"] == "82882800/1"
    copy = rescaleToMerge(tmp_path, clip)
    assert copy is not None
    assert lastPts(copy) == lastPts(clip)


COLOR_TRAITS = "stream=pix_fmt,color_range,color_space,color_transfer,color_primaries"
SDR_CLIP = ("-pix_fmt", "yuv420p")
HDR_CLIP = ("-pix_fmt", "yuv420p10le", *dynamic_range.hdr_args_for_output_metadata.split())


@pytest.mark.parametrize(
    ("clipArgs", "enableHDR"),
    [
        pytest.param(SDR_CLIP, True, id="sdr clip, hdr run"),
        pytest.param(HDR_CLIP, False, id="hdr clip, sdr run"),
    ],
)
def test_a_copy_keeps_the_clips_pixel_format_and_colors_whatever_the_run_sets(
    tmp_path: Path, svtav1: str, clipArgs: tuple[str, ...], enableHDR: bool
) -> None:
    # A merge joins the copy with clips made like the one copied, so a copy that followed this
    # run's --enable-hdr would mix 8-bit and 10-bit video
    clip = makeAv1Clip(svtav1, tmp_path / "clip.mp4", "30", *clipArgs)
    copy = rescaleToMerge(tmp_path, clip, enableHDR=enableHDR)
    assert copy is not None
    assert probeVideo(copy, COLOR_TRAITS) == probeVideo(clip, COLOR_TRAITS)


def test_a_copy_that_differs_from_its_clip_is_made_again(tmp_path: Path, svtav1: str) -> None:
    clip = makeAv1Clip(svtav1, tmp_path / "clip.mp4", "30", *SDR_CLIP)
    # Left by a run whose copies followed its --enable-hdr, and newer than the clip
    stale = Path(
        merge_rescale.rescaledCopyPath(ClipperPaths(clipsPath=str(tmp_path)), str(clip), (640, 360))
    )
    stale.parent.mkdir(parents=True)
    subprocess.run(
        [svtav1, "-hide_banner", "-loglevel", "error", "-i", str(clip), "-vf", "scale=640:360",
         "-c:v", "libsvtav1", "-preset", "12", *HDR_CLIP, "-video_track_timescale", "82882800",
         str(stale)],
        check=True,
    )  # fmt: skip
    copy = rescaleToMerge(tmp_path, clip)
    assert copy == stale
    assert probeVideo(copy, COLOR_TRAITS) == probeVideo(clip, COLOR_TRAITS)


def test_a_merge_with_a_clip_that_cannot_be_read_is_reported_as_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    names = ["clip-1.mp4", "clip-2.mp4"]
    for name in names:
        (tmp_path / name).write_bytes(b"")
    monkeypatch.setattr(clip_maker, "planMergeRescales", lambda *_args: {})
    monkeypatch.setattr(clip_maker, "probeMergeInputs", lambda *_args: None)
    cs = ClipperState(
        settings={
            "markerPairMergeList": "1-2",
            "markerPairs": [
                {"overrides": {}, "fileName": name, "filePath": str(tmp_path / name)}
                for name in names
            ],
            "titleSuffix": "video",
            "videoCodec": "av1",
            "overwrite": False,
        }
    )
    cs.clipper_paths.clipsPath = str(tmp_path)
    assert clip_maker.mergeClips(cs) == ["merge 1-2"]
