"""End-to-end clipper runs on the test markers JSON.

The clipper runs in-process with ffmpeg from PATH, or with `--clipper-exe PATH` as that built
executable with its bundled tools. The local input video cases run offline. The rest download from
YouTube and are marked slow.
"""

import functools
import http.server
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from fractions import Fraction

import pytest

from clipper import clip_maker, dedupe, merge_rescale, video2x
from clipper.tests import shaky_media, synthetic_media
from clipper.tests.range_http_server import RangeHTTPServer
from clipper.tests.stabilization_metrics import grayFrames, shakeLeft
from clipper.tests.test_output_duration_cases import clipperOutputDuration
from clipper.vidstab_motions import CameraPath, TrialLog, parseTransforms, readAnalysis
from clipper.yt_clipper import main

REPO = pathlib.Path(__file__).resolve().parents[3]
TESTDATA = pathlib.Path(__file__).parent.resolve() / "testdata"
MARKERS = TESTDATA / "test-with-dynamic.json"
LOCAL_VIDEO = TESTDATA / "test-with-dynamic.mp4"
SOURCE_FPS = Fraction(30000, 1001)
# A clip may end up to a frame early or late of the speed map's length.
LENGTH_TOLERANCE = float(1 / SOURCE_FPS) + 0.001
EXE = ".exe" if sys.platform == "win32" else ""
# Without it a frozen clipper updates its bundled yt-dlp first.
OFFLINE_ARGS = ("--no-ytdl-auto-update", "--overwrite")


def toolPath(exe: pathlib.Path | None, name: str) -> str | None:
    """A built clipper's bundled tool, else the one on PATH."""
    if exe:
        return str(exe.parent / "bin" / "video-tools" / f"{name}{EXE}")
    return shutil.which(name)


@dataclass(frozen=True)
class ClipperRun:
    returncode: int
    stdout: str
    stderr: str


class Clipper:
    def __init__(
        self,
        exe: pathlib.Path | None,
        tmp_path: pathlib.Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture,
    ) -> None:
        self.exe = exe
        # A built clipper runs from its own folder, as the release's .bat helpers do, and reads its
        # default_args.txt (e.g. YouTube cookies).
        self.cwd = exe.parent if exe else tmp_path
        # Markers JSON files a test writes stay out of a built clipper's folder, which CI zips.
        self.markersDir = tmp_path
        self.monkeypatch = monkeypatch
        self.capsys = capsys

    def toolPath(self, name: str) -> str | None:
        return toolPath(self.exe, name)

    def requireEncoder(self, encoder: str) -> None:
        if encoder not in ffmpegEncoders(self.toolPath("ffmpeg")):
            pytest.skip(f"needs an ffmpeg with {encoder}")

    def requireVideo2x(self) -> pathlib.Path:
        """The video2x the clipper runs, skipping the test without one or a GPU it can use."""
        if self.exe:
            video2x = pathlib.Path(self.toolPath("video2x") or "")
            if not video2x.is_file():
                pytest.skip("needs a release with video2x")
        else:
            # The clipper looks for video2x in the working folder's bin/, then on PATH.
            video2xDir = pathlib.Path(os.environ.get("YTC_VIDEO2X_DIR") or REPO / "bin" / "video2x")
            video2x = video2xDir / f"video2x{EXE}"
            if not video2x.is_file():
                pytest.skip(f"needs video2x in {video2xDir} or YTC_VIDEO2X_DIR")
            self.monkeypatch.setenv("PATH", f"{video2xDir}{os.pathsep}{os.environ['PATH']}")
        if not hasVulkanDevice(str(video2x)):
            pytest.skip("needs a GPU video2x can use (none on CI runners)")
        return video2x

    def run(self, args: list[str], answer: str | None = None) -> ClipperRun:
        """Runs the clipper. `answer` is typed at every prompt; without it, prompts read end of input."""
        if self.exe:
            # Only the install's own settings: a shared yt_clipper_default_args.txt next to the
            # installs would change the clips.
            argFiles = ["--arg-files", str(self.exe.parent / "default_args.txt")]
            result = subprocess.run(
                [str(self.exe), *argFiles, *args],
                cwd=self.cwd,
                input=f"{answer}\n" * 10 if answer is not None else "",
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            return ClipperRun(result.returncode, result.stdout, result.stderr)
        self.monkeypatch.chdir(self.cwd)
        self.monkeypatch.setattr(sys, "argv", ["yt_clipper.py", *args])
        self.monkeypatch.setattr("builtins.input", lambda _prompt="": self.typeAnswer(answer))
        try:
            main()
            returncode = 0
        except SystemExit as systemExit:
            code = systemExit.code
            returncode = code if isinstance(code, int) else int(code is not None)
        out, err = self.capsys.readouterr()
        return ClipperRun(returncode, out, err)

    @staticmethod
    def typeAnswer(answer: str | None) -> str:
        if answer is None:
            raise EOFError
        return answer

    def probeVideo(self, clip: pathlib.Path) -> dict:
        ffprobe = self.toolPath("ffprobe")
        assert ffprobe is not None
        probe = subprocess.run(
            [
                ffprobe, "-v", "error", "-select_streams", "v:0", "-count_packets",
                "-show_entries", "stream=codec_name,nb_read_packets", "-of", "json", str(clip),
            ],
            capture_output=True,
            text=True,
            check=True,
        )  # fmt: skip
        return (json.loads(probe.stdout).get("streams") or [{}])[0]

    def probeDuration(self, clip: pathlib.Path) -> float:
        ffprobe = self.toolPath("ffprobe")
        assert ffprobe is not None
        probe = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(clip),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(probe.stdout.strip())


@functools.cache
def ffmpegEncoders(ffmpeg: str | None) -> str:
    """ffmpeg's encoder list, read once per worker: nearly every test asks it."""
    if not (ffmpeg and pathlib.Path(ffmpeg).is_file()):
        return ""
    return subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=False
    ).stdout


@functools.cache
def hasVulkanDevice(video2x: str) -> bool:
    """Whether video2x lists a Vulkan device: CI runners have none, so it can't interpolate."""
    result = subprocess.run(
        [video2x, "--list-devices"], capture_output=True, text=True, check=False
    )
    return result.returncode == 0 and bool(re.search(r"^0\. ", result.stdout, re.MULTILINE))


# The test marker pair's clip: source frames 2253 through 2306 of the 29.97 fps test video, at its
# speed map's speeds, play as 103 output frames.
MARKER_PAIR_LENGTH = 103 * 1001 / 30000


@pytest.fixture
def clipper(
    pytestconfig: pytest.Config,
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> Clipper:
    exe = pytestconfig.getoption("clipper_exe")
    return Clipper(pathlib.Path(exe).resolve() if exe else None, tmp_path, monkeypatch, capsys)


@dataclass(frozen=True)
class ClipCase:
    args: tuple[str, ...]
    encoder: str
    # None when the clip keeps the source codec.
    codec: str | None
    localVideo: bool
    length: float
    video2x: bool
    # The local test video is 12 fps content stored at 30. Interpolation removes its repeats, and
    # the kept frames play back to back, so the clip is shorter than the marker pair.
    keepsLength: bool


def clipCase(
    name: str,
    args: tuple[str, ...],
    encoder: str,
    codec: str | None,
    *,
    localVideo: bool,
    slow: bool = False,
    length: float = MARKER_PAIR_LENGTH,
    frameTiming: str | None = None,
    video2x: bool = False,
    keepsLength: bool = True,
) -> object:
    marks = [pytest.mark.slow] if slow or not localVideo else []
    if frameTiming:
        marks.append(pytest.mark.frame_timing(frameTiming))
    return pytest.param(
        ClipCase(args, encoder, codec, localVideo, length, video2x, keepsLength),
        id=name,
        marks=marks,
    )


CLIP_CASES = [
    clipCase("vp9", (), "libvpx-vp9", "vp9", localVideo=True, frameTiming="5.49"),
    # The shipped clips (next, deciding as 5.48 does) drop source frame 2253, where the start marker
    # sits mid-frame, which plays at 0.3x.
    clipCase(
        "vp9-shipped-frame-timing",
        (),
        "libvpx-vp9",
        "vp9",
        localVideo=True,
        length=MARKER_PAIR_LENGTH - float(1 / SOURCE_FPS) / 0.3,
        frameTiming="next",
    ),
    clipCase(
        "av1", ("--video-codec", "av1"), "libsvtav1", "av1", localVideo=True, frameTiming="5.49"
    ),
    clipCase(
        "av1-shipped-frame-timing",
        ("--video-codec", "av1"),
        "libsvtav1",
        "av1",
        localVideo=True,
        length=MARKER_PAIR_LENGTH - float(1 / SOURCE_FPS) / 0.3,
        frameTiming="next",
    ),
    # Motion interpolation turns on duplicate frame removal for this sub-47 fps source.
    clipCase(
        "minterpolate",
        ("--minterp-fps-multiplier", "2", "--minterp-tool", "ffmpeg"),
        "libvpx-vp9",
        "vp9",
        localVideo=True,
        keepsLength=False,
    ),
    clipCase(
        "video2x",
        ("--minterp-fps-multiplier", "2", "--minterp-tool", "video2x"),
        "libvpx-vp9",
        "vp9",
        localVideo=True,
        video2x=True,
        keepsLength=False,
    ),
    clipCase(
        "nvenc",
        ("--video-codec", "h264_nvenc"),
        "h264_nvenc",
        "h264",
        localVideo=True,
        slow=True,
        frameTiming="5.49",
    ),
    clipCase("youtube-vp9", (), "libvpx-vp9", "vp9", localVideo=False, frameTiming="5.49"),
    clipCase(
        "youtube-vp9-shipped-frame-timing",
        (),
        "libvpx-vp9",
        "vp9",
        localVideo=False,
        length=MARKER_PAIR_LENGTH - float(1 / SOURCE_FPS) / 0.3,
        frameTiming="next",
    ),
    clipCase(
        "youtube-vulkan",
        ("--video-codec", "h264_vulkan"),
        "h264_vulkan",
        "h264",
        localVideo=False,
        frameTiming="5.49",
    ),
    clipCase("youtube-fast-trim", ("--fast-trim",), "libvpx-vp9", None, localVideo=False),
]


def bundledFfmpegVersion() -> str:
    """The ffmpeg version releases bundle, pinned once in the CI workflow."""
    workflow = (REPO / ".github" / "workflows" / "yt_clipper_ci.yml").read_text(encoding="utf-8")
    match = re.search(r'^\s*FFMPEG_VERSION:\s*"([^"]+)"', workflow, re.MULTILINE)
    assert match, "FFMPEG_VERSION not found in yt_clipper_ci.yml"
    return match.group(1)


def test_ffmpeg_is_the_version_releases_bundle(clipper: Clipper) -> None:
    # The other end-to-end tests check behavior that changes between ffmpeg versions
    ffmpeg = clipper.toolPath("ffmpeg")
    if ffmpeg is None or not pathlib.Path(ffmpeg).is_file():
        pytest.skip("needs ffmpeg")
    banner = subprocess.run(
        [ffmpeg, "-hide_banner", "-version"], capture_output=True, text=True, check=True
    ).stdout
    version = bundledFfmpegVersion()
    assert re.match(rf"ffmpeg version n?{re.escape(version)}\b", banner), (
        f"expected ffmpeg {version} at {ffmpeg}, found: {banner.splitlines()[0]}"
    )


@pytest.mark.slow
def test_get_version_info(clipper: Clipper) -> None:
    run = clipper.run(["--version"])
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    assert re.search(r"yt_clipper\S* v\d", run.stdout)


def frameThumbnails(ffmpeg: str, video: pathlib.Path, count: int) -> list[bytes]:
    """The first `count` frames of `video`, as small grayscale images for comparing frames. Passthrough
    keeps ffmpeg from repeating frames to fill a start before the first video frame."""
    raw = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(video), "-frames:v", str(count), "-fps_mode", "passthrough", "-vf", "scale=80:45,format=gray", "-f", "rawvideo", "-"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip
    return [raw[i : i + 80 * 45] for i in range(0, len(raw), 80 * 45)]


def audioFirstVideo(ffmpeg: str, folder: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    """A 3 s video whose audio starts 0.1 s before its video, as audio pre-roll leaves a downloaded
    file, and markers for one full-frame pair from 1.0 to 2.0 s."""
    source = folder / "audio-first.mkv"
    subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3",
         "-itsoffset", "-0.1", "-f", "lavfi", "-i", "sine=duration=3.2",
         "-c:v", "libx264", "-qp", "0", "-c:a", "libopus", "-avoid_negative_ts", "disabled", str(source)],
        check=True,
    )  # fmt: skip
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    data.update(cropRes="320x180", cropResWidth=320, cropResHeight=180, titleSuffix="audio-first")
    data["markerPairs"] = [{"number": 1, "start": 1.0, "end": 2.0, "speed": 1, "crop": "0:0:iw:ih", "enableZoomPan": False, "cropRes": "320x180", "overrides": {}}]  # fmt: skip
    markers = folder / "audio-first.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    return source, markers


def lateStartVideo(ffmpeg: str, folder: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    """A 3 s video whose timestamps start at 10 s, as a cut recording's do, and markers for one
    full-frame pair from 11.0 to 12.0 s: Chrome's player time starts at the file's first timestamp."""
    source = folder / "late-start.mkv"
    subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3",
         "-c:v", "libx264", "-qp", "0", "-output_ts_offset", "10", str(source)],
        check=True,
    )  # fmt: skip
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    data.update(cropRes="320x180", cropResWidth=320, cropResHeight=180, titleSuffix="late-start")
    data["markerPairs"] = [{"number": 1, "start": 11.0, "end": 12.0, "speed": 1, "crop": "0:0:iw:ih", "enableZoomPan": False, "cropRes": "320x180", "overrides": {}}]  # fmt: skip
    markers = folder / "late-start.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    return source, markers


@pytest.mark.parametrize(
    "makeVideo",
    [
        pytest.param(audioFirstVideo, id="audio first: the file starting before 0"),
        pytest.param(lateStartVideo, id="late start: the file starting at 10 s"),
    ],
)
@pytest.mark.frame_timing("5.49")  # 5.48 seeks from the file's start time
def test_clip_of_a_video_with_a_start_time_begins_on_the_pair_start_frame(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    makeVideo: Callable[[str, pathlib.Path], tuple[pathlib.Path, pathlib.Path]],
) -> None:
    # -ss is the video's own timestamp, as the markup's player time is, so the clip begins on the
    # frame 1 s into the video in both: audio pre-roll can give a downloaded file a negative start
    # time, and a cut recording's timestamps can start late.
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    source, markers = makeVideo(ffmpeg, tmp_path)
    output = clipper.cwd / "webms" / markers.stem
    try:
        run = clipper.run(
            ["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS]
        )
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        first = frameThumbnails(ffmpeg, next(output.glob("*.webm")), 1)[0]
        sourceFrames = frameThumbnails(ffmpeg, source, 40)
        difference = [
            sum(abs(a - b) for a, b in zip(first, frame, strict=True)) for frame in sourceFrames
        ]
        assert difference.index(min(difference)) == 30
    finally:
        shutil.rmtree(output, ignore_errors=True)


def numberedVideo(ffmpeg: str, folder: pathlib.Path, start: float = 0) -> pathlib.Path:
    """A 4 s, 30 fps lossless video whose frame n has brightness 2n, so a clip's frame names its source
    frame exactly. Its first frame shows at `start`."""
    source = folder / "numbered.mkv"
    subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=gray:size=320x180:rate=30:duration=4",
         "-vf", "geq=lum='2*N':cb=128:cr=128", "-c:v", "libx264", "-qp", "0",
         "-output_ts_offset", str(start), str(source)],
        check=True,
    )  # fmt: skip
    return source


def frameBrightness(ffprobe: str, clip: pathlib.Path) -> list[float]:
    """Each of the clip's frames' average brightness."""
    movie = clip.as_posix().replace(":", "\\\\:")
    probe = subprocess.run(
        [ffprobe, "-v", "error", "-f", "lavfi", "-i", f"movie={movie},signalstats",
         "-show_entries", "frame_tags=lavfi.signalstats.YAVG", "-of", "csv=p=0"],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    return [float(value.strip(",")) for value in probe.stdout.split()]


def sourceFrames(ffprobe: str, clip: pathlib.Path) -> list[int]:
    """The numbered source frame of each of the clip's frames."""
    return [round(brightness / 2) for brightness in frameBrightness(ffprobe, clip)]


@pytest.mark.parametrize(
    ("start", "end", "frames", "sourceStart"),
    [
        pytest.param(30 / 30, 50 / 30, (30, 50), 0, id="markers on frame starts"),
        pytest.param(30.5 / 30, 50.5 / 30, (30, 50), 0, id="markers mid-frame"),
        # 6 decimals is how markers are saved; both round a hair below their frame's start.
        pytest.param(
            round(31 / 30, 6), round(52 / 30, 6), (31, 52), 0, id="markers saved to 6 decimals"
        ),
        pytest.param(30.9 / 30, 50.9 / 30, (30, 50), 0, id="markers late in their frames"),
        pytest.param(0, 1, (0, 28), 2 / 30, id="a start marker before the video's first frame"),
    ],
)
@pytest.mark.frame_timing("5.49")
def test_a_clip_runs_from_the_frame_shown_at_its_start_marker_through_the_one_at_its_end_marker(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    start: float,
    end: float,
    frames: tuple[int, int],
    sourceStart: float,
) -> None:
    shown = clipOfNumberedVideo(clipper, tmp_path, start, end, sourceStart)
    assert (shown[0], shown[-1], len(shown)) == (*frames, frames[1] - frames[0] + 1)


@pytest.mark.parametrize(
    ("start", "end", "frames", "sourceStart"),
    [
        pytest.param(30 / 30, 50 / 30, (30, 49), 0, id="markers on frame starts: the end marker's frame left out"),
        pytest.param(30.5 / 30, 50.5 / 30, (31, 50), 0, id="markers mid-frame: the start marker's frame dropped"),
        pytest.param(round(31 / 30, 6), round(52 / 30, 6), (31, 51), 0, id="markers saved to 6 decimals"),
        # ffmpeg rounds 5.48's seek and trim to the video's 1 ms timestamps.
        pytest.param(round(31 / 30 + 1e-6, 6), round(52 / 30 + 1e-6, 6), (31, 51), 0, id="markers 1 us after frame starts"),
        pytest.param(30.9 / 30, 50.9 / 30, (31, 50), 0, id="markers late in their frames"),
        # 5.48 seeks from the file's start time, so the clip runs 1 s from the video's first frame.
        pytest.param(0, 1, (0, 29), 2 / 30, id="a start marker before the video's first frame"),
    ],
)  # fmt: skip
@pytest.mark.frame_timing("5.48")
def test_a_legacy_clip_runs_from_the_first_frame_starting_at_its_start_marker_to_before_its_end_marker(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    start: float,
    end: float,
    frames: tuple[int, int],
    sourceStart: float,
) -> None:
    # Pins 5.48.0's own frame choices as an oracle, so only in process: a built clipper ships next.
    if clipper.exe:
        pytest.skip("pins 5.48's frame timing in process")
    shown = clipOfNumberedVideo(clipper, tmp_path, start, end, sourceStart)
    assert (shown[0], shown[-1], len(shown)) == (*frames, frames[1] - frames[0] + 1)


def clipOfNumberedVideo(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    start: float,
    end: float,
    sourceStart: float,
    *args: str,
) -> list[int]:
    """The numbered source frames of a clip of `numberedVideo` from `start` to `end`."""
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg, ffprobe = clipper.toolPath("ffmpeg"), clipper.toolPath("ffprobe")
    assert ffmpeg is not None
    assert ffprobe is not None
    source = numberedVideo(ffmpeg, tmp_path, sourceStart)
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    data.update(cropRes="320x180", cropResWidth=320, cropResHeight=180, titleSuffix="numbered")
    data["markerPairs"] = [{"number": 1, "start": start, "end": end, "speed": 1, "crop": "0:0:iw:ih", "enableZoomPan": False, "cropRes": "320x180", "overrides": {}}]  # fmt: skip
    markers = tmp_path / "numbered.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        run = clipper.run(
            ["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS, *args]
        )
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        return sourceFrames(ffprobe, next(output.glob("*.webm")))
    finally:
        shutil.rmtree(output, ignore_errors=True)


@pytest.mark.parametrize("easing", ["smoothInOut", "smoothTrack"])
@pytest.mark.parametrize(
    ("sourceStart", "pointTime"),
    [
        pytest.param(0, 91 / 30, id="exact"),
        # How markers are saved, and how YouTube rounds frame times: both a hair below the frame start.
        pytest.param(0, round(91 / 30, 6), id="saved to 6 decimals"),
        pytest.param(0, round(91 / 30, 3), id="a millisecond frame time"),
        # Over half a frame in, where frames counted from 0 would split a frame early.
        pytest.param(0.021, round(0.021 + 91 / 30, 6), id="a video starting 21 ms in"),
    ],
)
@pytest.mark.frame_timing("5.49")
def test_an_instant_crop_point_switches_on_its_own_frame(
    clipper: Clipper, tmp_path: pathlib.Path, easing: str, sourceStart: float, pointTime: float
) -> None:
    assert firstFrameCroppedRight(clipper, tmp_path, easing, sourceStart, pointTime) == 91


@pytest.mark.parametrize("easing", ["smoothInOut", "smoothTrack"])
@pytest.mark.parametrize(
    ("sourceStart", "pointTime", "frame"),
    [
        # 5.48 times the point from the start marker at 2 s: 91 / 30 - 2 is a hair below 31 / 30.
        pytest.param(0, 91 / 30, 90, id="exact: a frame early"),
        pytest.param(0, 91 / 30 - 0.0005, 90, id="in frame 90's last millisecond"),
        pytest.param(
            0, round(91 / 30, 6), 90, id="frame 91's start saved to 6 decimals: a frame early"
        ),
        # 5.48 seeks from the file's start time, so the crop's time runs 21 ms behind the video's.
        pytest.param(0.021, round(0.021 + 91 / 30, 6), 91, id="a video starting 21 ms in"),
    ],
)
@pytest.mark.frame_timing("5.48")
def test_a_legacy_instant_crop_point_switches_on_5_48s_frame(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    easing: str,
    sourceStart: float,
    pointTime: float,
    frame: int,
) -> None:
    # Pins 5.48.0's own crop timing as an oracle, so only in process: a built clipper ships next.
    if clipper.exe:
        pytest.skip("pins 5.48's frame timing in process")
    shown = firstFrameCroppedRight(clipper, tmp_path, easing, sourceStart, pointTime)
    assert shown == frame


# The start marker and the instant point inside their frames (30 fps, the point in frame 91), where
# 5.48 counted crop point frames from the start marker.
INSIDE_FRAMES = [
    pytest.param(60.7 / 30, round(91.85 / 30, 6), 92, id="start 70% in, point 85% in"),
    pytest.param(60.3 / 30, round(91.15 / 30, 6), 90, id="start 30% in, point 15% in"),
]


@pytest.mark.parametrize(("start", "pointTime", "frame548"), INSIDE_FRAMES)
@pytest.mark.frame_timing("next")
def test_an_instant_crop_point_switches_on_its_own_frame_wherever_the_start_marker_is(
    clipper: Clipper, tmp_path: pathlib.Path, start: float, pointTime: float, frame548: int
) -> None:
    assert firstFrameCroppedRight(clipper, tmp_path, "smoothInOut", 0, pointTime, start=start) == 91


@pytest.mark.parametrize(("start", "pointTime", "frame548"), INSIDE_FRAMES)
@pytest.mark.frame_timing("5.48")
def test_a_legacy_instant_crop_point_counts_its_frame_from_the_start_marker(
    clipper: Clipper, tmp_path: pathlib.Path, start: float, pointTime: float, frame548: int
) -> None:
    if clipper.exe:
        pytest.skip("pins 5.48's frame timing in process")
    shown = firstFrameCroppedRight(clipper, tmp_path, "smoothInOut", 0, pointTime, start=start)
    assert shown == frame548


@pytest.mark.frame_timing("next")
def test_an_instant_crop_point_in_a_video_starting_21_ms_in_switches_on_the_frame_shown(
    clipper: Clipper, tmp_path: pathlib.Path
) -> None:
    # Chrome's playhead is the file's own time, so frame 91 shows from 21 ms + 91/30. Crop point frames
    # count from where the clip's seek puts the video's frames: a seek by the file's own timestamps
    # (`-seek_timestamp 1`, T-101) that keeps this origin switches on frame 90 here.
    pointTime = round(0.021 + 91.2 / 30, 6)
    assert firstFrameCroppedRight(clipper, tmp_path, "smoothInOut", 0.021, pointTime) == 91


def firstFrameCroppedRight(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    easing: str,
    sourceStart: float,
    pointTime: float,
    *args: str,
    start: float | None = None,
) -> int:
    """The first source frame cropped to its right half, from an instant crop point at `pointTime`."""
    # Frame n's left half has brightness n and its right half 255 - n, so a frame's crop names the half
    # and the source frame both.
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    ffprobe = clipper.toolPath("ffprobe")
    assert ffmpeg is not None
    assert ffprobe is not None
    source = tmp_path / "halves.mkv"
    subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=gray:size=320x180:rate=30:duration=4",
         "-vf", "geq=lum='if(lt(X,160),N,255-N)':cb=128:cr=128", "-c:v", "libx264", "-qp", "0",
         "-output_ts_offset", str(sourceStart), str(source)],
        check=True,
    )  # fmt: skip
    left, right = "0:0:160:180", "160:0:160:180"
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    data.update(
        cropRes="320x180",
        cropResWidth=320,
        cropResHeight=180,
        titleSuffix="halves",
        cropPointEasing=easing,
    )
    start = sourceStart + 2.0 if start is None else start
    end = sourceStart + 3.5
    cropMap = [
        {"x": start, "y": 0, "crop": left},
        {"x": pointTime, "y": 0, "crop": right, "easeIn": "instant"},
        {"x": end, "y": 0, "crop": right},
    ]
    data["markerPairs"] = [{"number": 1, "start": start, "end": end, "speed": 1, "crop": left, "enableZoomPan": False, "cropRes": "320x180", "overrides": {}, "cropMap": cropMap}]  # fmt: skip
    markers = tmp_path / "halves.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        run = clipper.run(
            ["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS, *args]
        )
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        # A right-half frame is brighter than 127.5; its source frame is 255 - its brightness.
        brightness = frameBrightness(ffprobe, next(output.glob("*.webm")))
        return next(round(255 - b) for b in brightness if b > 127.5)
    finally:
        shutil.rmtree(output, ignore_errors=True)


def frameTimes(ffprobe: str, clip: pathlib.Path) -> dict[int, float]:
    """When each numbered source frame first shows in the clip."""
    movie = clip.as_posix().replace(":", "\\\\:")
    probe = subprocess.run(
        [ffprobe, "-v", "error", "-f", "lavfi", "-i", f"movie={movie},signalstats",
         "-show_entries", "frame=pts_time:frame_tags=lavfi.signalstats.YAVG", "-of", "csv=p=0"],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    times: dict[int, float] = {}
    for line in probe.stdout.split():
        pts, brightness = (float(value) for value in line.split(",") if value)
        times.setdefault(round(brightness / 2), pts)
    return times


@pytest.mark.parametrize(
    ("start", "sourceStart"),
    [
        pytest.param(30 / 30, 0, id="start marker on a frame start"),
        pytest.param(30.5 / 30, 0, id="mid-frame"),
        # Measured 18 ms early, with or without the audio trim: ffmpeg starts the audio of a seek before
        # the first video frame later than its seek point. Under the ~45 ms where early audio shows.
        pytest.param(
            0,
            2 / 30,
            id="start marker before the video's first frame",
            marks=pytest.mark.xfail(reason="audio about 18 ms early", strict=True),
        ),
    ],
)
@pytest.mark.frame_timing("5.49")  # 5.48's audio starts at the start marker
def test_a_clips_audio_starts_with_its_first_frame(
    clipper: Clipper, tmp_path: pathlib.Path, start: float, sourceStart: float
) -> None:
    # The source's click starts exactly with frame 40, so in the clip it starts with frame 40 too.
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg, ffprobe = clipper.toolPath("ffmpeg"), clipper.toolPath("ffprobe")
    assert ffmpeg is not None
    assert ffprobe is not None
    video = numberedVideo(ffmpeg, tmp_path)
    source = tmp_path / "numbered-click.mkv"
    click = sourceStart + 40 / 30
    # Offset when muxing: copying a stream drops an offset it was encoded with.
    subprocess.run(
        [ffmpeg, "-v", "error", "-itsoffset", str(sourceStart), "-i", str(video), "-f", "lavfi", "-i",
         f"aevalsrc='if(between(t,{click},{click}+0.01),0.9*sin(2*PI*1000*t),0)':s=48000:d=4",
         "-c:v", "copy", "-c:a", "pcm_s16le", str(source)],
        check=True,
    )  # fmt: skip
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    data.update(
        cropRes="320x180", cropResWidth=320, cropResHeight=180, titleSuffix="click", audio=True
    )
    data["markerPairs"] = [{"number": 1, "start": start, "end": 1.8, "speed": 1, "crop": "0:0:iw:ih", "enableZoomPan": False, "cropRes": "320x180", "overrides": {}}]  # fmt: skip
    markers = tmp_path / "click.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        run = clipper.run(
            ["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS]
        )
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        clip = next(output.glob("*.webm"))
        silence = subprocess.run(
            [ffmpeg, "-i", str(clip), "-af", "silencedetect=n=-30dB:d=0.005", "-f", "null", "-"],
            capture_output=True, text=True, check=True,
        ).stderr  # fmt: skip
        click = float(re.search(r"silence_end: (\S+)", silence)[1])  # type: ignore[index]
        # Under half a frame (16.7 ms): the encoder's own audio padding is a few ms.
        assert click == pytest.approx(frameTimes(ffprobe, clip)[40], abs=0.008)
    finally:
        shutil.rmtree(output, ignore_errors=True)


@pytest.mark.parametrize(
    "extraArgs",
    [
        pytest.param([], id="the encode"),
        # 5.48 seeks the late start video from its file's start time, past its end.
        pytest.param(
            ["--video-stabilization", "1"],
            id="video stabilization's two passes",
            marks=pytest.mark.frame_timing("5.49"),
        ),
    ],
)
def test_subtitles_burn_in_for_a_markers_file_named_with_an_apostrophe(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    extraArgs: list[str],
) -> None:
    # The name reaches each filter graph in the clips folder's path, through a `-vf "..."` command
    # string that shlex splits.
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    source, lateMarkers = lateStartVideo(ffmpeg, tmp_path)
    data = json.loads(lateMarkers.read_text(encoding="utf-8"))
    data["titleSuffix"] = "it's"
    markers = tmp_path / "it's.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    subs = tmp_path / "subs.vtt"
    subs.write_text("WEBVTT\n\n00:10.000 --> 00:13.000\nhello\n", encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        args = [
            "--markers-json",
            str(markers),
            "--input-video",
            str(source),
            "--subs-file",
            str(subs),
        ]
        run = clipper.run([*args, *extraArgs, *OFFLINE_ARGS])
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        assert len(list(output.glob("*.webm"))) == 1
    finally:
        shutil.rmtree(output, ignore_errors=True)
        # vidstab can't read the quote in the clips folder's path, so the transform goes to temp.
        transforms = clipper.cwd / "temp" / clip_maker.getTrimmedBase64Hash(data["titleSuffix"])
        shutil.rmtree(transforms, ignore_errors=True)


@pytest.mark.parametrize(
    ("makeVideo", "seek"),
    [
        # The pair starts at 1.0 s, and ffplay half a 30 fps frame before. The file starts at
        # -0.1065 s: the audio's 0.1 s lead plus the Opus encoder's 6.5 ms pre-skip.
        pytest.param(
            audioFirstVideo, 1.1065 - 1 / 60, id="audio first: the file starting before 0"
        ),
        # The pair starts at 11.0 s, the file at 10 s.
        pytest.param(lateStartVideo, 1.0 - 1 / 60, id="late start: the file starting at 10 s"),
    ],
)
@pytest.mark.frame_timing("5.49")  # 5.48 seeks from the file's start time
def test_preview_of_a_local_video_starts_ffplay_half_a_frame_before_the_pair_start(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    makeVideo: Callable[[str, pathlib.Path], tuple[pathlib.Path, pathlib.Path]],
    seek: float,
) -> None:
    # ffplay has no -seek_timestamp, which a preview command with it fails on at once, and its -ss
    # counts from the file's start time, where the clip's counts from the video's own timestamps.
    if clipper.exe:
        pytest.skip("records the ffplay command in process")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    source, markers = makeVideo(ffmpeg, tmp_path)
    previewInputs: list[str] = []

    def recordPreview(_cs: object, inputs: str, *_args: object, **_kwargs: object) -> None:
        previewInputs.append(inputs)

    monkeypatch.setattr(clip_maker, "runffplayCommand", recordPreview)
    pairPromptAnswers = iter(["1", "q"])
    monkeypatch.setattr(
        clip_maker, "input", lambda _prompt="": next(pairPromptAnswers), raising=False
    )
    run = clipper.run(
        ["--markers-json", str(markers), "--input-video", str(source), "--preview", *OFFLINE_ARGS],
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    assert len(previewInputs) == 1
    assert "-seek_timestamp" not in previewInputs[0]
    seekArg = re.search(r"-ss (\S+) -i", previewInputs[0])
    assert seekArg is not None
    assert float(seekArg[1]) == pytest.approx(seek, abs=0.001)


def loggedVideoFilter(output: pathlib.Path) -> str:
    """The -vf of the run's ffmpeg command, from its log, which wraps long lines."""
    text = re.sub(
        r"\s*\n\s*", "", next((output / "logs").glob("*.log")).read_text(encoding="utf-8")
    )
    # Joining the wrapped lines drops the space after -vf when the wrap falls there.
    match = re.search(r'-vf\s*"([^"]*)"', text)
    assert match, "no -vf in the log"
    return match.group(1)


def runInItsOwnProcess(clipper: Clipper, args: list[str]) -> int:
    """A finished process has written its whole log; the in-process runs leave it incomplete."""
    if clipper.exe:
        return clipper.run(args).returncode
    command = [sys.executable, "-m", "clipper.yt_clipper", *args]
    return subprocess.run(command, cwd=clipper.cwd, capture_output=True, check=False).returncode


def test_cinematic_solve_failing_renders_as_smooth_track(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A Cinematic pair whose path cannot be solved still makes its clip, with Smooth Track."""
    if clipper.exe:
        pytest.skip("patches the solver in process")
    clipper.requireEncoder("libvpx-vp9")

    def failingSolve(*_args: object) -> None:
        raise RuntimeError("solver failed")

    monkeypatch.setattr("clipper.cinematic_path.bakeCinematicPath", failingSolve)
    # A path solved for the same crop points in an earlier test would skip the failing solver.
    clip_maker._bakeCinematicPathFromKey.cache_clear()
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    pair = data["markerPairs"][0]
    crops = ("0:0:480:360", "480:0:480:360", "960:360:480:360")
    times = [pair["start"] + (pair["end"] - pair["start"]) * i / 2 for i in range(3)]
    pair.update(
        crop=crops[0],
        cropMap=[{"x": t, "y": 0, "crop": c} for t, c in zip(times, crops, strict=True)],
    )
    pair["overrides"] = {**pair.get("overrides", {}), "cropPointEasing": "cinematic"}
    markers = tmp_path / "cinematic-fallback.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        # In process, so the patched solver is the one that runs.
        run = clipper.run(
            ["--markers-json", str(markers), "--input-video", str(LOCAL_VIDEO), *OFFLINE_ARGS]
        )
        assert run.returncode == 0
        assert len(list(output.glob("*.webm"))) == 1
        assert "Could not solve the Cinematic crop path" in caplog.text
    finally:
        shutil.rmtree(output, ignore_errors=True)


def markersWithCropMap(crops: tuple[str, ...]) -> dict:
    """The test markers with the first pair's crop points spread evenly over it."""
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    pair = data["markerPairs"][0]
    times = [
        pair["start"] + (pair["end"] - pair["start"]) * i / (len(crops) - 1)
        for i in range(len(crops))
    ]
    pair.update(
        crop=crops[0],
        cropMap=[{"x": t, "y": 0, "crop": crop} for t, crop in zip(times, crops, strict=True)],
    )
    return data


def renderedVideoFilter(clipper: Clipper, markers: pathlib.Path, data: dict) -> str:
    """The video filter of a clip rendered from the markers data, in its own process."""
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        args = ["--markers-json", str(markers), "--input-video", str(LOCAL_VIDEO), *OFFLINE_ARGS]
        assert runInItsOwnProcess(clipper, args) == 0
        return loggedVideoFilter(output)
    finally:
        # A built clipper writes into its install folder, which must stay clean (see smoke_test.py).
        shutil.rmtree(output, ignore_errors=True)


def test_cinematic_set_globally_renders_like_a_pair_override(
    clipper: Clipper,
    tmp_path: pathlib.Path,
) -> None:
    # The markup saves a pair's easing only when it overrides the global setting. Frame sizes cannot
    # tell the modes apart, so this compares the crop filters in the runs' logs.
    clipper.requireEncoder("libvpx-vp9")
    filters = {}
    for name, globalEasing, pairEasing in [
        ("pair", None, "cinematic"),
        ("global", "cinematic", None),
        ("none", None, None),
    ]:
        data = markersWithCropMap(("0:0:480:360", "240:180:720:540", "0:0:960:720"))
        data["markerPairs"][0]["overrides"] = {"cropPointEasing": pairEasing} if pairEasing else {}
        if globalEasing:
            data["cropPointEasing"] = globalEasing
        filters[name] = renderedVideoFilter(clipper, tmp_path / f"cinematic-{name}.json", data)
    assert filters["global"] == filters["pair"]
    assert filters["none"] != filters["pair"]


def test_cinematic_hold_points_follow_the_pairs_hold_points_setting(
    clipper: Clipper,
    tmp_path: pathlib.Path,
) -> None:
    # Compares the crop filters in the runs' logs, as the global and pair easing test does.
    clipper.requireEncoder("libvpx-vp9")
    filters = {}
    for name, globalHolds, pairHolds in [
        ("default", None, None),
        ("global firm", "firm", None),
        ("pair firm", None, "firm"),
        ("pair loose under a global firm", "firm", "loose"),
        ("pair exact under a global loose", "loose", "exact"),
    ]:
        # A slow pan: a fast one keeps the whole margin under Firm, as under Loose.
        data = markersWithCropMap(
            ("0:0:480:360", "120:0:480:360", "120:0:480:360", "240:120:480:360")
        )
        data["cropPointEasing"] = "cinematic"
        pair = data["markerPairs"][0]
        pair["cropMap"][2]["hold"] = True
        pair["overrides"] = {"cropPointEasingCinematicHolds": pairHolds} if pairHolds else {}
        if globalHolds:
            data["cropPointEasingCinematicHolds"] = globalHolds
        markers = tmp_path / f"cinematic-holds-{name.replace(' ', '-')}.json"
        filters[name] = renderedVideoFilter(clipper, markers, data)
    # Exact is the default.
    assert filters["pair exact under a global loose"] == filters["default"]
    assert filters["global firm"] == filters["pair firm"]
    assert (
        len({filters["default"], filters["pair firm"], filters["pair loose under a global firm"]})
        == 3
    )


@pytest.mark.parametrize("case", CLIP_CASES)
def test_make_clip(case: ClipCase, clipper: Clipper) -> None:
    clipper.requireEncoder(case.encoder)
    if case.video2x:
        clipper.requireVideo2x()
    args = ["--markers-json", str(MARKERS), *OFFLINE_ARGS, *case.args]
    if case.localVideo:
        args += ["--input-video", str(LOCAL_VIDEO)]
    output = clipper.cwd / "webms" / MARKERS.stem
    shutil.rmtree(output, ignore_errors=True)
    run = clipper.run(args)
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    # A yt-dlp extractor warning
    assert "WARNING: [" not in run.stdout
    assert "error" not in run.stdout
    assert "ERROR" not in run.stdout

    clips = [path for path in output.glob("*") if path.suffix in {".webm", ".mp4"}]
    assert len(clips) == 1
    video = clipper.probeVideo(clips[0])
    assert int(video.get("nb_read_packets", 0)) > 0
    if case.codec:
        assert video.get("codec_name") == case.codec
    # Fast trim cuts at keyframes, so only re-encoded clips keep the exact length.
    if case.codec and case.keepsLength:
        assert clipper.probeDuration(clips[0]) == pytest.approx(case.length, abs=LENGTH_TOLERANCE)
    log = max((output / "logs").glob("*.log"), key=lambda path: path.stat().st_mtime)
    assert not re.findall(r"\b(?:ERROR|CRITICAL)\b", log.read_text(encoding="utf-8"))


# Synthetic clips, made by ffmpeg at test time (see synthetic_media.py), each marked up as one pair.
SYNTHETIC_PAIR = (0.5, 3.5)
SPEED_MAPS = {
    "slowdown": [{"x": SYNTHETIC_PAIR[0], "y": 0.5}, {"x": SYNTHETIC_PAIR[1], "y": 0.5}],
    "ramp": [{"x": SYNTHETIC_PAIR[0], "y": 1}, {"x": SYNTHETIC_PAIR[1], "y": 0.25}],
}
INTERPOLATION_TOOLS = {"minterpolate": "ffmpeg", "video2x": "video2x"}
# Motion interpolation's cost grows with the pixels, so the tests interpolate a quarter of the clip:
# testsrc2's top right, whose dots move on every new frame. The other quarters hold still for stretches,
# which the stall test would count, and mpdecimate drops the noisy repeats there that it keeps in the
# whole frame (measured with ffmpeg 9.0.2: every case's outcome matches the whole frame's).
INTERPOLATION_CROP = "320:0:320:180"


@pytest.fixture(scope="session")
def syntheticMedia(
    pytestconfig: pytest.Config, tmp_path_factory: pytest.TempPathFactory
) -> pathlib.Path:
    """The synthetic input clips, made once for every worker and run. Tests write their clips to
    their own folders."""
    exe = pytestconfig.getoption("clipper_exe")
    ffmpeg = toolPath(pathlib.Path(exe).resolve() if exe else None, "ffmpeg")
    if not (ffmpeg and pathlib.Path(ffmpeg).is_file()):
        # The tests skip for the missing ffmpeg
        return tmp_path_factory.mktemp("synthetic-media")
    return synthetic_media.mediaFolder(ffmpeg)


def syntheticMarkers(
    folder: pathlib.Path,
    name: str,
    speedMap: list[dict],
    pair: tuple[float, float] = SYNTHETIC_PAIR,
    crop: str = "0:0:iw:ih",
) -> pathlib.Path:
    """A markers JSON with one marker pair on a synthetic clip, full frame unless cropped."""
    markers = json.loads(MARKERS.read_text(encoding="utf-8"))
    start, end = pair
    markers.update(
        cropRes="640x360",
        cropResWidth=640,
        cropResHeight=360,
        titleSuffix=name,
        videoTag=name,
    )
    markers["markerPairs"] = [
        {
            "number": 1, "start": start, "end": end, "speed": speedMap[0]["y"], "speedMap": speedMap,
            "crop": crop, "cropRes": "640x360", "enableZoomPan": False, "overrides": {},
            "cropMap": [{"x": start, "y": 0, "crop": crop}, {"x": end, "y": 0, "crop": crop}],
        },
    ]  # fmt: skip
    path = folder / f"{name}.json"
    path.write_text(json.dumps(markers), encoding="utf-8")
    return path


def interpolateSyntheticClip(
    clipper: Clipper,
    media: pathlib.Path,
    source: str,
    tool: str,
    speed: str,
    dedupe: bool = True,
) -> pathlib.Path:
    clipper.requireEncoder("libvpx-vp9")
    if tool == "video2x":
        clipper.requireVideo2x()
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, source, media)
    name = f"{source}-{tool}-{speed}" + ("" if dedupe else "-no-dedupe")
    markers = syntheticMarkers(clipper.markersDir, name, SPEED_MAPS[speed], crop=INTERPOLATION_CROP)
    output = clipper.cwd / "webms" / name
    shutil.rmtree(output, ignore_errors=True)
    run = clipper.run(
        ["--markers-json", str(markers), "--input-video", str(uploaded), *OFFLINE_ARGS,
         "--minterp-fps-multiplier", "2", "--minterp-tool", INTERPOLATION_TOOLS[tool],
         *([] if dedupe else ["--no-remove-duplicate-frames"])],
    )  # fmt: skip
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    clips = [path for path in output.glob("*") if path.suffix in {".webm", ".mp4"}]
    assert len(clips) == 1
    return clips[0]


def lengthCase(source: str, tool: str, speed: str, dedupe: bool) -> object:
    marks = []
    if dedupe:
        # Removing duplicates plays the kept frames back to back, which drops the repeats' time and
        # squeezes a variable frame rate source's gaps (retiming kept frames is future work).
        marks.append(
            pytest.mark.xfail(reason="kept frames play back to back, as in 5.48", strict=True)
        )
    elif (source, tool, speed) == ("vfr-motion", "minterpolate", "slowdown"):
        # Its frames are off the constant-rate grid the clip's ends are mapped on, so the last one
        # kept is a source frame later than the grid says (the clipper warns about such sources).
        marks.append(pytest.mark.limit_of_549_frame_timing("ends a slowed source frame late"))
    elif (source, tool, speed) == ("vfr-motion", "video2x", "slowdown"):
        # The source's last frame is followed by a gap, so it shows for two frames. The clip given
        # to video2x cannot record that, so video2x shows it for one output frame.
        marks.append(
            pytest.mark.limit_of_549_frame_timing("ends up to a slowed source frame early")
        )
    removal = "dedupe" if dedupe else "no-dedupe"
    return pytest.param(
        source, tool, speed, dedupe, id=f"{source}-{tool}-{speed}-{removal}", marks=marks
    )


@pytest.mark.parametrize(
    ("source", "tool", "speed", "dedupe"),
    [
        lengthCase(source, tool, speed, dedupe)
        for source in ("cartoon-12-in-30", "vfr-motion")
        for tool in INTERPOLATION_TOOLS
        for speed in SPEED_MAPS
        for dedupe in (True, False)
    ],
)
def test_interpolated_synthetic_clip_keeps_its_length(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    source: str,
    tool: str,
    speed: str,
    dedupe: bool,
) -> None:
    clip = interpolateSyntheticClip(clipper, syntheticMedia, source, tool, speed, dedupe)
    # As the clipper renders the speed map: through the frame shown at its end.
    length = clipperOutputDuration(SPEED_MAPS[speed], str(SOURCE_FPS))
    assert clipper.probeDuration(clip) == pytest.approx(length, abs=LENGTH_TOLERANCE)


@pytest.mark.parametrize("speed", SPEED_MAPS)
def test_video2x_output_plays_at_the_target_frame_rate(
    clipper: Clipper, syntheticMedia: pathlib.Path, speed: str, request: pytest.FixtureRequest
) -> None:
    version = video2x.exwmVersion(
        subprocess.run(
            [clipper.requireVideo2x(), "--version"], capture_output=True, text=True, check=True
        ).stdout
    )
    if version is None:
        pytest.skip("needs the yt_clipper build of video2x, which has --vfr-min-fps")
    if version < (6, 6, 1):
        # Each frame's duration was rounded to the output's time base: a webm at 59.94 fps played at 58.82
        request.applymarker(pytest.mark.xfail(reason="fixed in video2x 6.6.1-exwm", strict=True))
    clip = interpolateSyntheticClip(
        clipper, syntheticMedia, "cartoon-12-in-30", "video2x", speed, dedupe=False
    )
    ffprobe = clipper.toolPath("ffprobe")
    assert ffprobe is not None
    times = [
        float(line)
        for line in subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", str(clip)],
            capture_output=True, text=True, check=True,
        ).stdout.split()
    ]  # fmt: skip
    rate = (len(times) - 1) / (times[-1] - times[0])
    assert rate == pytest.approx(2 * float(SOURCE_FPS), rel=0.002)


def holds(clipper: Clipper, clip: pathlib.Path, frames: int = 3) -> int:
    """Places in the middle of a moving clip where the picture holds still for 3 or more frames in
    a row (or `frames`): where interpolation ran between a frame and its repeat. RIFE eases in and
    out around each input frame, which gives one or two near-still frames but never 3."""
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    log = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-i",
            str(clip),
            "-vf",
            "scdet=threshold=100,metadata=mode=print",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    differences = [float(value) for value in re.findall(r"lavfi\.scd\.mafd=(\S+)", log)]
    middle = differences[len(differences) // 10 : -len(differences) // 10]
    typical = sorted(middle)[len(middle) // 2]
    still = "".join("s" if difference < typical / 10 else "m" for difference in middle)
    return len(re.findall(f"s{{{frames},}}", still))


@pytest.mark.parametrize(
    "detector",
    [
        # 5.49's mpdecimate keeps repeats that differ from their drawing by encoder noise.
        pytest.param(False, id="mpdecimate", marks=pytest.mark.xfail(reason="5.49's", strict=True)),
        pytest.param(True, id="detector"),
    ],
)
@pytest.mark.parametrize("tool", INTERPOLATION_TOOLS)
def test_interpolated_cartoon_does_not_stall(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
    tool: str,
    detector: bool,
) -> None:
    if clipper.exe and detector != dedupe.FIND_REPEATS_AGAINST_NEARBY_CHANGES:
        pytest.skip("a built clipper keeps its own duplicate frame detector")
    monkeypatch.setattr(dedupe, "FIND_REPEATS_AGAINST_NEARBY_CHANGES", detector)
    # Drawn at 12 fps and stored at 30, each drawing shows for 2 or 3 frames. Interpolating
    # between a drawing and its repeat would hold the picture still between moves.
    clip = interpolateSyntheticClip(clipper, syntheticMedia, "cartoon-12-in-30", tool, "slowdown")
    assert holds(clipper, clip) == 0


def test_removing_duplicate_frames_without_interpolation_plays_the_kept_frames_back_to_back(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    # 24 fps film stored at 30 repeats a frame in every 5, which stutters. The repeats are dropped and
    # the kept frames play back to back, a little faster.
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-24-in-30", syntheticMedia)
    name = "motion-24-in-30-no-interpolation"
    speedMap = [{"x": SYNTHETIC_PAIR[0], "y": 1}, {"x": SYNTHETIC_PAIR[1], "y": 1}]
    markers = syntheticMarkers(clipper.markersDir, name, speedMap)
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--remove-duplicate-frames",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    clip = next(
        path
        for path in (clipper.cwd / "webms" / name).glob("*")
        if path.suffix in {".webm", ".mp4"}
    )
    assert holds(clipper, clip, frames=1) == 0
    pairFrames = (SYNTHETIC_PAIR[1] - SYNTHETIC_PAIR[0]) * SOURCE_FPS
    assert int(clipper.probeVideo(clip)["nb_read_packets"]) == pytest.approx(
        pairFrames * 4 / 5, abs=3
    )
    assert holds(clipper, clip) == 0


def test_an_input_video_ffprobe_cannot_read_stops_with_a_clear_message(
    clipper: Clipper,
    tmp_path: pathlib.Path,
) -> None:
    # A local video has no yt-dlp info to fall back on, and the run once ended in a traceback.
    broken = tmp_path / "broken.mp4"
    broken.write_text("not a video", encoding="utf-8")
    markers = tmp_path / "broken-input.json"
    markers.write_text(MARKERS.read_text(encoding="utf-8"), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        run = clipper.run(
            ["--markers-json", str(markers), "--input-video", str(broken), *OFFLINE_ARGS]
        )
        assert run.returncode == 1
        log = "".join(path.read_text(encoding="utf-8") for path in output.glob("logs/*"))
        assert "ffprobe could not read the input video" in log
        assert "Unexpected error" not in log
    finally:
        shutil.rmtree(output, ignore_errors=True)


@pytest.mark.parametrize(
    ("crops", "size"),
    [
        pytest.param(("0:0:320:180", "320:0:320:180", "160:180:320:180"), "320x180", id="pan"),
        pytest.param(("0:0:320:180", "160:90:480:270", "0:0:640:360"), "640x360", id="zoom"),
        # Its filter is longer than ffmpeg's command line takes, so it is read from a file.
        pytest.param(
            ("0:0:320:180", "160:90:480:270", "0:0:640:360") * 4, "640x360", id="long zoom"
        ),
    ],
)
def test_cinematic_pair_renders_the_path_solved_from_its_crop_points(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    crops: tuple[str, ...],
    size: str,
) -> None:
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = f"cinematic-{len(crops)}-{size}"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    data = json.loads(markers.read_text(encoding="utf-8"))
    pair = data["markerPairs"][0]
    times = [start + (end - start) * i / (len(crops) - 1) for i in range(len(crops))]
    pair.update(
        crop=crops[0],
        cropMap=[{"x": t, "y": 0, "crop": crop} for t, crop in zip(times, crops, strict=True)],
    )
    pair["overrides"] = {"cropPointEasing": "cinematic"}
    markers.write_text(json.dumps(data), encoding="utf-8")
    run = clipper.run(
        ["--markers-json", str(markers), "--input-video", str(uploaded), *OFFLINE_ARGS]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    # A failed solve falls back to Smooth Track, which renders at the same size.
    log = "".join(
        path.read_text(encoding="utf-8") for path in (clipper.cwd / "webms" / name).glob("logs/*")
    )
    assert "Could not solve the Cinematic crop path" not in log
    # The long case is there to read its filter from a file.
    assert (clipper.cwd / "webms" / name / "temp" / "vfilter-1-pass1.txt").is_file() == (
        len(crops) > 3
    )
    clip = next((clipper.cwd / "webms" / name).glob("*.webm"))
    assert frameSizes(clipper, clip) == {size}


@pytest.mark.parametrize(
    ("args", "savesShakyClip"),
    [
        pytest.param((), False, id="default"),
        pytest.param(("--two-pass",), False, id="two-pass"),
        pytest.param(("--video-stabilization-save-shaky-clip",), True, id="saved"),
        pytest.param(
            ("--video-stabilization-save-shaky-clip", "--two-pass"), True, id="saved with two-pass"
        ),
    ],
)
def test_stabilized_clip_saves_the_shaky_clip_only_when_asked(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    args: tuple[str, ...],
    savesShakyClip: bool,
) -> None:
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = "stabilized" + "".join(args).replace("--", "-")
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--video-stabilization",
            "2",
            *args,
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    output = clipper.cwd / "webms" / name
    assert len(list(output.glob("*.webm"))) == 1
    assert len(list((output / "shaky").glob("*.trf"))) == 1
    assert len(list((output / "shaky").glob("*-shaky.webm"))) == int(savesShakyClip)


def test_stabilized_clip_is_made_without_overwrite(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    # The passes' extra analysis outputs once carried -y, which ffmpeg refuses beside -n
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    commands: list[str] = []
    if not clipper.exe:
        runFfmpeg = clip_maker.run_ffmpeg_with_progress
        clipper.monkeypatch.setattr(
            clip_maker,
            "run_ffmpeg_with_progress",
            lambda command, **kwargs: commands.append(command) or runFfmpeg(command, **kwargs),
        )
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = "stabilized-without-overwrite"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            "--no-ytdl-auto-update",
            "--video-stabilization",
            "2",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    assert len(list((clipper.cwd / "webms" / name).glob("*.webm"))) == 1
    for command in commands:
        assert not {"-y", "-n"} <= set(shlex.split(command))


def test_stabilization_analyses_the_frames_vid_stab_sees_when_removing_duplicate_frames(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    # Duplicate frame removal keeps other frames under the passes' gamma lift than without it: on
    # a still fading out, 128 of 150 frames with it and 84 without
    if clipper.exe:
        pytest.skip("records the analysis in process")
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    analysed: list[int] = []

    def recording(*args: str) -> list:
        analysis = readAnalysis(*args)
        analysed.append(len(analysis))
        return analysis

    clipper.monkeypatch.setattr("clipper.vidstab_motions.readAnalysis", recording)
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "fade", syntheticMedia)
    name = "stabilized-dedupe"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--video-stabilization",
            "2",
            "--remove-duplicate-frames",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    transforms = next((clipper.cwd / "webms" / name / "shaky").glob("*.trf"))
    detected = len(parseTransforms(transforms.read_text(encoding="utf-8")).frames)
    # The input's analysis, then the stabilized clip's
    assert analysed[:2] == [detected, detected]


def test_stabilization_repairs_the_motion_with_ffmpeg_from_a_tools_folder(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # A Windows tools folder is shell-quoted (backslashes), as in every Windows release
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = "stabilized-tools-folder"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--ffmpeg-tools-dir",
            str(pathlib.Path(ffmpeg).parent),
            "--video-stabilization",
            "2",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    # In process the clipper logs to caplog, a built clipper to its stdout
    assert "Could not check the video stabilization motion" not in run.stdout + caplog.text


@pytest.mark.parametrize("failingPass", [1, 2], ids=["detect pass fails", "transform pass fails"])
def test_a_failed_stabilization_pass_leaves_no_analysis_or_shake_files(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    failingPass: int,
) -> None:
    # The analysis frames take about 260 MB a minute at 720p
    if clipper.exe:
        pytest.skip("fails a pass in process")
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    passes: list[str] = []
    runFfmpeg = clip_maker.run_ffmpeg_with_progress

    def failAfterWriting(command: str, **kwargs: object) -> int:
        passes.append(command)
        returncode = runFfmpeg(command, **kwargs)
        return 1 if len(passes) == failingPass else returncode

    clipper.monkeypatch.setattr(clip_maker, "run_ffmpeg_with_progress", failAfterWriting)
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = f"stabilized-failing-pass-{failingPass}"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--video-stabilization",
            "2",
        ]
    )
    print(run.stdout, run.stderr)
    assert len(passes) == failingPass
    shaky = clipper.cwd / "webms" / name / "shaky"
    assert len(list(shaky.glob("*.trf"))) == 1
    left = [path.name for path in shaky.iterdir() if path.suffix in {".nut", ".shake"}]
    assert left == []


def recordStabilizationSteps(clipper: Clipper) -> dict[str, list]:
    """The ffmpeg commands, stall trials, motion repairs and shakier clip checks of a clipper run."""
    steps: dict[str, list] = {"commands": [], "trials": [], "repairs": [], "checks": []}

    def recording(original: Callable, calls: list) -> Callable:
        def recorded(*args: object, **kwargs: object) -> object:
            calls.append(args[0])
            return original(*args, **kwargs)

        return recorded

    for name, key in (
        ("run_ffmpeg_with_progress", "commands"),
        ("repairMotionsInFiles", "repairs"),
        ("checkStabilizedShake", "checks"),
    ):
        original = getattr(clip_maker, name)
        clipper.monkeypatch.setattr(clip_maker, name, recording(original, steps[key]))
    clipper.monkeypatch.setattr(
        clip_maker,
        "transformCameraPath",
        lambda command, cwd=None: steps["trials"].append(command) or TrialLog(CameraPath.SOLVED),
    )
    return steps


def test_stabilization_without_motion_analysis_keeps_the_zoom_budget_and_check(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    # -nvsma turns off only the motion repair: text transforms, the zoom budget, the stall trial and
    # the shakier clip check stay
    if clipper.exe:
        pytest.skip("records the steps in process")
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    steps = recordStabilizationSteps(clipper)
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = "stabilized-without-motion-analysis"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--video-stabilization",
            "2",
            "--no-video-stabilization-motion-analysis",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    assert len(list((clipper.cwd / "webms" / name).glob("*.webm"))) == 1
    detect, transform = steps["commands"]
    assert "fileformat=1" in detect
    assert ".nut" in detect
    assert re.search(r"vidstabtransform=[^\"]*:zoom=\d+\.\d\d", transform)
    assert "optalgo" not in transform
    assert ".nut" in transform
    assert steps["trials"]
    assert not steps["repairs"]
    assert steps["checks"]


def test_stabilization_runs_without_the_repair_where_vid_stab_has_no_text_transforms(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    # As on ffmpeg 6.x and some 7.x builds, whose vid.stab has no fileformat option
    if clipper.exe:
        pytest.skip("fakes the probe in process")
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    clipper.monkeypatch.setattr(clip_maker, "vidstabWritesTextTransforms", lambda _path: False)
    commands: list[str] = []
    runFfmpeg = clip_maker.run_ffmpeg_with_progress
    clipper.monkeypatch.setattr(
        clip_maker,
        "run_ffmpeg_with_progress",
        lambda command, **kwargs: commands.append(command) or runFfmpeg(command, **kwargs),
    )
    trials: list[list[str]] = []
    clipper.monkeypatch.setattr(
        clip_maker,
        "transformCameraPath",
        lambda command, cwd=None: trials.append(command) or TrialLog(CameraPath.SOLVED),
    )
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = "stabilized-plain-by-probe"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--video-stabilization",
            "2",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    output = clipper.cwd / "webms" / name
    assert len(list(output.glob("*.webm"))) == 1
    detect, transform = commands
    assert "vidstabdetect=" in detect
    assert "fileformat" not in detect
    assert ".nut" not in detect
    assert "vidstabtransform=" in transform
    assert "zoom=" not in transform
    assert ".nut" not in transform
    # As 5.49: vid.stab picks the zoom, so no trial of the camera path runs before the transform
    assert not trials


def test_stabilization_crops_as_5_49_with_a_vid_stab_without_the_l1_camera_path(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    # ffmpeg 8.0.1's vid.stab 1.1 has text transforms but only the gaussian camera path, which adds
    # a zoom option to its own zoom instead of capping it
    tools = os.environ.get("YTC_TEST_FFMPEG_8_DIR")
    if not tools:
        pytest.skip("needs YTC_TEST_FFMPEG_8_DIR, a folder with ffmpeg 8.0.1 and ffprobe")
    if clipper.exe:
        pytest.skip("records the commands in process")
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    commands: list[str] = []
    checkedAt: list[float] = []
    runFfmpeg = clip_maker.run_ffmpeg_with_progress
    clipper.monkeypatch.setattr(
        clip_maker,
        "run_ffmpeg_with_progress",
        lambda command, **kwargs: commands.append(command) or runFfmpeg(command, **kwargs),
    )
    clipper.monkeypatch.setattr(
        clip_maker, "checkStabilizedShake", lambda *args: checkedAt.append(args[-1]) or False
    )
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = "stabilized-gaussian-only"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--ffmpeg-tools-dir",
            tools,
            "--video-stabilization",
            "2",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    assert len(list((clipper.cwd / "webms" / name).glob("*.webm"))) == 1
    detect, transform = commands
    assert "fileformat=1" in detect
    assert ".nut" in detect
    transformFilter = re.search(r"vidstabtransform=[^,\"]*", transform)
    assert transformFilter is not None
    assert transformFilter.group().endswith(":zoom=0"), transformFilter.group()
    # At vid.stab's own zoom, which is never 0 on a moving clip
    assert len(checkedAt) == 1
    assert 0 < checkedAt[0] < 15


def test_stabilized_pair_with_a_filter_too_long_for_the_command_line_reads_it_from_files(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    # ffmpeg 9 removed -filter_script, and the analysis outputs once still used it
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, "motion-native-30", syntheticMedia)
    name = "stabilized-long-filter"
    start, end = SYNTHETIC_PAIR
    markers = syntheticMarkers(clipper.markersDir, name, [{"x": start, "y": 1}, {"x": end, "y": 1}])
    data = json.loads(markers.read_text(encoding="utf-8"))
    crops = ("0:0:320:180", "320:0:320:180") * 20
    times = [start + (end - start) * i / (len(crops) - 1) for i in range(len(crops))]
    data["markerPairs"][0].update(
        crop=crops[0],
        cropMap=[{"x": t, "y": 0, "crop": crop} for t, crop in zip(times, crops, strict=True)],
    )
    markers.write_text(json.dumps(data), encoding="utf-8")
    run = clipper.run(
        [
            "--markers-json",
            str(markers),
            "--input-video",
            str(uploaded),
            *OFFLINE_ARGS,
            "--video-stabilization",
            "2",
        ]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    output = clipper.cwd / "webms" / name
    assert (output / "temp" / "vfilter-1-analysis.txt").is_file()
    assert (output / "temp" / "vfilter-1-pass2-analysis.txt").is_file()
    # The trial of the camera path before the transform pass reads the long filter from a file too
    assert (output / "temp" / "vfilter-1-trial.txt").is_file()
    assert len(list(output.glob("*.webm"))) == 1
    # Both analysis outputs are read and removed
    assert not list((output / "shaky").glob("*.nut"))


def test_stabilization_with_a_slowdown_and_interpolation_stays_stable_to_the_end(
    clipper: Clipper,
) -> None:
    # vid.stab uses the motion of each frame in order, so both passes must see the same frames
    # (vid.stab issue 127): a filter that changes the frame count in one pass jerks the clip's end
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    source = shaky_media.makeShakyClip(ffmpeg, "plain", shaky_media.mediaFolder(ffmpeg))
    name = "stabilized-slowdown"
    pair = (0.2, 2.8)
    # A quarter of the frame, a third of the time: the end jerk of 8 frames missing from the detect
    # pass leaves 1.7 px/frame of shake here, 1.03 in the whole frame (measured)
    size = (shaky_media.WIDTH // 2, shaky_media.HEIGHT // 2)
    markers = syntheticMarkers(
        clipper.markersDir, name, [{"x": pair[0], "y": 0.5}, {"x": pair[1], "y": 0.5}], pair=pair,
        crop=f"0:0:{size[0]}:{size[1]}",
    )  # fmt: skip
    args = [
        "--video-stabilization",
        "4",
        "--minterp-fps-multiplier",
        "2",
        "--minterp-tool",
        "ffmpeg",
    ]
    run = clipper.run(
        ["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS, *args]
    )
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    clip = next((clipper.cwd / "webms" / name).glob("*.webm"))
    assert clipper.probeDuration(clip) == pytest.approx((pair[1] - pair[0]) / 0.5, abs=0.2)
    assert shakeLeft(grayFrames(ffmpeg, clip, size)) < 1.0


def mergedMarkers(folder: pathlib.Path, name: str, crops: tuple[str, str]) -> pathlib.Path:
    """Two one-second marker pairs on a synthetic clip, with the given crops, merged as 1-2."""
    path = syntheticMarkers(folder, name, [{"x": 0.5, "y": 1}, {"x": 1.5, "y": 1}], pair=(0.5, 1.5))
    markers = json.loads(path.read_text(encoding="utf-8"))
    first = markers["markerPairs"][0]
    # A whole number of frames (at 30000/1001 fps) after the first, so both clips have the same
    # length under any frame rule
    start, end = 0.5 + 45 * 1001 / 30000, 1.5 + 45 * 1001 / 30000
    second = {
        **first,
        "number": 2,
        "start": start,
        "end": end,
        "speedMap": [{"x": start, "y": 1}, {"x": end, "y": 1}],
    }
    for pair, crop in zip((first, second), crops, strict=True):
        pair["crop"] = crop
        pair["cropMap"] = [
            {"x": pair["start"], "y": 0, "crop": crop},
            {"x": pair["end"], "y": 0, "crop": crop},
        ]
    markers["markerPairs"] = [first, second]
    markers["markerPairMergeList"] = "1-2"
    path.write_text(json.dumps(markers), encoding="utf-8")
    return path


SAME_SIZE, DIFFERENT_SIZES = ("0:0:640:360", "0:0:640:360"), ("0:0:640:360", "0:0:320:180")
CODEC_ENCODERS = {
    "vp9": ("libvpx-vp9", "webm"),
    "av1": ("libsvtav1", "mp4"),
    "h264": ("libx264", "mp4"),
}
# Offline, but keeping clips and copies made by an earlier run
REUSE_ARGS = tuple(arg for arg in OFFLINE_ARGS if arg != "--overwrite")


@dataclass(frozen=True)
class MergeRun:
    run: ClipperRun
    output: pathlib.Path
    log: str

    def clip(self, name: str) -> pathlib.Path:
        return self.output / name


def runMerge(
    clipper: Clipper,
    media: pathlib.Path,
    name: str,
    crops: tuple[str, str],
    *args: str,
    answer: str | None = None,
    mergeList: str = "1-2",
    editMarkers: Callable[[dict], None] | None = None,
    source: str = "motion-native-30",
) -> MergeRun:
    """Clips two synthetic marker pairs with the given crops and merges them."""
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    _, uploaded = synthetic_media.makeSyntheticClip(ffmpeg, source, media)
    markers = mergedMarkers(clipper.markersDir, name, crops)
    data = json.loads(markers.read_text(encoding="utf-8"))
    data["markerPairMergeList"] = mergeList
    if editMarkers:
        editMarkers(data)
    markers.write_text(json.dumps(data), encoding="utf-8")
    run = clipper.run(
        ["--markers-json", str(markers), "--input-video", str(uploaded), *args], answer
    )
    print(run.stdout, run.stderr)
    output = clipper.cwd / "webms" / name
    log = max((output / "logs").glob("*.log"), key=lambda path: path.stat().st_mtime).read_text(
        encoding="utf-8"
    )
    # The log wraps long lines
    return MergeRun(run, output, re.sub(r"\s+", " ", log))


def frameSizes(clipper: Clipper, video: pathlib.Path) -> set[str]:
    ffprobe = clipper.toolPath("ffprobe")
    assert ffprobe is not None
    out = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=width,height",
         "-of", "csv=p=0:s=x", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    return set(out.split())


def streamTraits(clipper: Clipper, video: pathlib.Path) -> dict:
    """What a merge needs to match across clips, besides the size."""
    ffprobe = clipper.toolPath("ffprobe")
    assert ffprobe is not None
    out = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name,pix_fmt,r_frame_rate,time_base,color_space,color_transfer,color_primaries", "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    return json.loads(out)["streams"][0]


def videoPts(clipper: Clipper, video: pathlib.Path) -> list[int]:
    ffprobe = clipper.toolPath("ffprobe")
    assert ffprobe is not None
    out = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts",
         "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    return sorted(map(int, out.split()))


@pytest.mark.parametrize(
    ("codec", "crops", "sizes"),
    [
        pytest.param("vp9", DIFFERENT_SIZES, {"640x360", "320x180"}, id="vp9 of different sizes"),
        pytest.param("av1", SAME_SIZE, {"640x360"}, id="av1 of one size"),
    ],
)
def test_merging_copies_the_clips_as_they_are(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    codec: str,
    crops: tuple[str, str],
    sizes: set[str],
) -> None:
    # Other codecs decode a size change correctly, and clips of one size need nothing
    encoder, container = CODEC_ENCODERS[codec]
    clipper.requireEncoder(encoder)
    merge = runMerge(
        clipper, syntheticMedia, f"merge-{codec}", crops, *OFFLINE_ARGS, "--video-codec", codec
    )
    assert merge.run.returncode == 0
    assert frameSizes(clipper, merge.clip(f"merge-{codec}-(1-2).{container}")) == sizes
    assert not (merge.output / "temp" / "merge-inputs").exists()


@pytest.mark.parametrize(
    ("codec", "rescale"),
    [
        # FFmpeg's AV1 hardware decoding keeps the first clip's frame size, so a size change in a
        # merge shows corrupted colors or drops frames (FFmpeg issue 24132)
        pytest.param("av1", (), id="av1 by default"),
        pytest.param("vp9", ("--merge-rescale", "always"), id="vp9 when asked"),
    ],
)
def test_merge_of_clips_made_earlier_at_different_sizes_uses_a_rescaled_copy_and_reuses_it(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    codec: str,
    rescale: tuple[str, ...],
) -> None:
    encoder, container = CODEC_ENCODERS[codec]
    clipper.requireEncoder(encoder)
    name = f"merge-rescale-{codec}"
    args = ("--video-codec", codec, *rescale)
    # An earlier run makes the clips at their own sizes, without merging them
    earlier = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *OFFLINE_ARGS, "--video-codec", codec,
                       "--merge-rescale", "never", answer="n")  # fmt: skip
    assert earlier.run.returncode == 0
    earlier.clip(f"{name}-(1-2).{container}").unlink(missing_ok=True)
    merge = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *REUSE_ARGS, *args)
    assert merge.run.returncode == 0
    merged = merge.clip(f"{name}-(1-2).{container}")
    assert frameSizes(clipper, merged) == {"640x360"}
    assert clipper.probeDuration(merged) == pytest.approx(2.0, abs=2 * LENGTH_TOLERANCE)
    # The clips keep their own sizes; the merge used a rescaled copy of the second
    assert frameSizes(clipper, merge.clip(f"{name}-2.{container}")) == {"320x180"}
    copies = list((merge.output / "temp" / "merge-inputs").glob(f"*.{container}"))
    assert len(copies) == 1
    assert frameSizes(clipper, copies[0]) == {"640x360"}
    assert streamTraits(clipper, copies[0]) == streamTraits(
        clipper, merge.clip(f"{name}-2.{container}")
    )
    assert "Merge 1-2 at 640x360: marker pair 2 from 320x180." in merge.log

    # A later merge of the same clips reuses the copy
    madeAt = copies[0].stat().st_mtime_ns
    later = runMerge(
        clipper, syntheticMedia, name, DIFFERENT_SIZES, *REUSE_ARGS, *args, mergeList="1-2;2,1"
    )
    assert later.run.returncode == 0
    assert frameSizes(clipper, later.clip(f"{name}-(2,1).{container}")) == {"640x360"}
    assert copies[0].stat().st_mtime_ns == madeAt


@pytest.mark.parametrize(
    ("codec", "rescale"),
    [
        pytest.param("av1", (), id="av1"),
        pytest.param("h264", ("--merge-rescale", "always"), id="h264"),
    ],
)
def test_a_rescaled_copy_of_a_vfr_clip_keeps_its_timestamps_and_is_reused(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    codec: str,
    rescale: tuple[str, ...],
) -> None:
    # Frames off the rate ffprobe guesses, which the copy's encoder time base must not round onto
    encoder, container = CODEC_ENCODERS[codec]
    clipper.requireEncoder(encoder)
    name = f"merge-rescale-vfr-{codec}"
    args = ("--video-codec", codec, *rescale)
    earlier = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *OFFLINE_ARGS, "--video-codec", codec,
                       "--merge-rescale", "never", answer="n", source="vfr-motion")  # fmt: skip
    assert earlier.run.returncode == 0
    earlier.clip(f"{name}-(1-2).{container}").unlink(missing_ok=True)
    merge = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *REUSE_ARGS, *args,
                     source="vfr-motion")  # fmt: skip
    assert merge.run.returncode == 0
    (copy,) = (merge.output / "temp" / "merge-inputs").glob(f"*.{container}")
    assert videoPts(clipper, copy) == videoPts(clipper, merge.clip(f"{name}-2.{container}"))

    madeAt = copy.stat().st_mtime_ns
    later = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *REUSE_ARGS, *args,
                     mergeList="1-2;2,1", source="vfr-motion")  # fmt: skip
    assert later.run.returncode == 0
    assert copy.stat().st_mtime_ns == madeAt


@pytest.mark.parametrize(("answer", "merged"), [("n", False), ("y", True)])
def test_av1_merge_of_different_sizes_without_rescale_asks_first(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    answer: str,
    merged: bool,
) -> None:
    clipper.requireEncoder("libsvtav1")
    name = "merge-av1-no-rescale"
    merge = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *OFFLINE_ARGS, "--video-codec", "av1",
                     "--merge-rescale", "never", answer=answer)  # fmt: skip
    assert merge.run.returncode == 0
    assert "different sizes" in merge.log
    output = merge.clip(f"{name}-(1-2).mp4")
    assert output.is_file() == merged
    if merged:
        assert frameSizes(clipper, output) == {"640x360", "320x180"}


@pytest.mark.parametrize(
    ("rotate", "big", "small"),
    [
        pytest.param((), "640x360", "320x180", id="landscape"),
        pytest.param(("--rotate", "clock"), "360x640", "180x320", id="rotated"),
    ],
)
def test_clips_made_for_a_merge_are_encoded_at_its_size(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    rotate: tuple[str, ...],
    big: str,
    small: str,
) -> None:
    clipper.requireEncoder("libsvtav1")
    name = f"merge-encode-size-{len(rotate)}"
    merge = runMerge(
        clipper,
        syntheticMedia,
        name,
        DIFFERENT_SIZES,
        *OFFLINE_ARGS,
        "--video-codec",
        "av1",
        *rotate,
    )
    assert merge.run.returncode == 0
    # The smaller pair is scaled while it is encoded, so the merge needs no rescaled copy
    assert frameSizes(clipper, merge.clip(f"{name}-2.mp4")) == {big}
    assert frameSizes(clipper, merge.clip(f"{name}-(1-2).mp4")) == {big}
    assert not (merge.output / "temp" / "merge-inputs").exists()
    plan = f"Merge 1-2 at {big}: marker pair 2 from {small}."
    assert plan in merge.log
    # The summary report at the end of the log repeats it
    assert merge.log.split("Summary Report")[0].count(plan) == 1
    assert merge.log.index(plan) < merge.log.index("Marker pair 1")


def test_a_new_clip_keeps_its_size_when_merged_with_a_smaller_clip_made_earlier(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    clipper.requireEncoder("libsvtav1")
    name = "merge-grow-only"
    earlier = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *OFFLINE_ARGS,
                       "--video-codec", "av1", "--only", "2")  # fmt: skip
    assert earlier.run.returncode == 0
    merge = runMerge(
        clipper, syntheticMedia, name, DIFFERENT_SIZES, *REUSE_ARGS, "--video-codec", "av1"
    )
    assert merge.run.returncode == 0
    # The new clip is not shrunk to the earlier one's size; the earlier one gets a copy instead
    assert frameSizes(clipper, merge.clip(f"{name}-1.mp4")) == {"640x360"}
    assert frameSizes(clipper, merge.clip(f"{name}-2.mp4")) == {"320x180"}
    assert frameSizes(clipper, merge.clip(f"{name}-(1-2).mp4")) == {"640x360"}
    copies = list((merge.output / "temp" / "merge-inputs").glob("*.mp4"))
    assert [frameSizes(clipper, copy) for copy in copies] == [{"640x360"}]


def zoomCinematically(markers: dict) -> None:
    pair = markers["markerPairs"][0]
    pair["cropMap"] = [
        {"x": pair["start"], "y": 0, "crop": "0:0:320:180"},
        {"x": pair["end"], "y": 0, "crop": "0:0:640:360"},
    ]
    pair["overrides"] = {"cropPointEasing": "cinematic"}


def test_cinematic_clip_made_for_a_merge_is_planned_at_its_solved_size(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    clipper.requireEncoder("libsvtav1")
    name = "merge-encode-size-cinematic"
    crops = ("0:0:320:180", "0:0:320:180")
    merge = runMerge(
        clipper,
        syntheticMedia,
        name,
        crops,
        *OFFLINE_ARGS,
        "--video-codec",
        "av1",
        editMarkers=zoomCinematically,
    )
    assert merge.run.returncode == 0
    (size,) = frameSizes(clipper, merge.clip(f"{name}-1.mp4"))
    assert size != "320x180"
    assert frameSizes(clipper, merge.clip(f"{name}-2.mp4")) == {size}
    assert frameSizes(clipper, merge.clip(f"{name}-(1-2).mp4")) == {size}
    assert not (merge.output / "temp" / "merge-inputs").exists()


def addThirdPairLikeTheSecond(markers: dict) -> None:
    second = markers["markerPairs"][1]
    start, end = second["start"] + 1, second["end"] + 1
    markers["markerPairs"].append(
        {
            **second,
            "number": 3,
            "start": start,
            "end": end,
            "speedMap": [{"x": start, "y": 1}, {"x": end, "y": 1}],
            "cropMap": [
                {**point, "x": x} for point, x in zip(second["cropMap"], (start, end), strict=True)
            ],
        }
    )


def test_a_merge_of_one_size_grows_with_a_merge_it_shares_a_pair_with(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
) -> None:
    clipper.requireEncoder("libsvtav1")
    name = "merge-linked-one-size"
    merge = runMerge(clipper, syntheticMedia, name, DIFFERENT_SIZES, *OFFLINE_ARGS, "--video-codec", "av1",
                     mergeList="1-2;2-3", editMarkers=addThirdPairLikeTheSecond)  # fmt: skip
    assert merge.run.returncode == 0
    # Pair 2 grows to merge 1-2's size, so pair 3 is made at it too rather than copied later
    assert frameSizes(clipper, merge.clip(f"{name}-3.mp4")) == {"640x360"}
    assert frameSizes(clipper, merge.clip(f"{name}-(2-3).mp4")) == {"640x360"}
    assert not (merge.output / "temp" / "merge-inputs").exists()


def test_a_cinematic_solve_failure_while_planning_a_merge_leaves_the_rescale_to_merging(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if clipper.exe:
        pytest.skip("patches the solver in process")
    clipper.requireEncoder("libsvtav1")

    def failingSolve(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("solver failed")

    monkeypatch.setattr("clipper.cinematic_path.bakeCinematicPath", failingSolve)
    clip_maker._bakeCinematicPathFromKey.cache_clear()
    name = "merge-cinematic-solve-fails"
    crops = ("0:0:320:180", "0:0:320:180")
    merge = runMerge(clipper, syntheticMedia, name, crops, *OFFLINE_ARGS, "--video-codec", "av1",
                     editMarkers=zoomCinematically)  # fmt: skip
    assert merge.run.returncode == 0
    # Pair 1 renders with Smooth Track at its largest crop point; pair 2 gets a copy when merging
    assert frameSizes(clipper, merge.clip(f"{name}-2.mp4")) == {"320x180"}
    assert frameSizes(clipper, merge.clip(f"{name}-(1-2).mp4")) == {"640x360"}


def test_a_wrong_size_prediction_does_not_stretch_a_clip_made_for_a_merge(
    clipper: Clipper,
    syntheticMedia: pathlib.Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if clipper.exe:
        pytest.skip("patches the prediction in process")
    clipper.requireEncoder("libsvtav1")
    predict = merge_rescale.predictClipSize

    def wrongForTheSquarePair(settings: dict, pair: dict) -> tuple[int, int] | None:
        # Pair 2 is square, but predicted at the merge's shape
        return (320, 180) if pair["crop"] == "0:0:360:360" else predict(settings, pair)

    monkeypatch.setattr(merge_rescale, "predictClipSize", wrongForTheSquarePair)
    name = "merge-wrong-prediction"
    crops = ("0:0:640:360", "0:0:360:360")
    merge = runMerge(clipper, syntheticMedia, name, crops, *OFFLINE_ARGS, "--video-codec", "av1")
    assert merge.run.returncode == 0
    assert frameSizes(clipper, merge.clip(f"{name}-2.mp4")) == {"640x360"}
    # Fitted with black bars from its real size, not stretched from the predicted one
    ffmpeg = clipper.toolPath("ffmpeg")
    assert ffmpeg is not None
    frames = grayFrames(ffmpeg, merge.clip(f"{name}-2.mp4"), (640, 360))
    assert frames[:, :, :130].max() < 32
    assert frames[:, :, 150:490].mean() > 32


def test_merge_of_different_codecs_is_skipped(
    clipper: Clipper, syntheticMedia: pathlib.Path
) -> None:
    # av1 and h264 clips share names (both .mp4), so a later h264 run reuses the av1 clip
    clipper.requireEncoder("libsvtav1")
    clipper.requireEncoder("libx264")
    name = "merge-codecs"
    first = runMerge(
        clipper,
        syntheticMedia,
        name,
        SAME_SIZE,
        *OFFLINE_ARGS,
        "--video-codec",
        "av1",
        "--only",
        "1",
    )
    assert first.run.returncode == 0
    merge = runMerge(clipper, syntheticMedia, name, SAME_SIZE, *REUSE_ARGS, "--video-codec", "h264")
    assert merge.run.returncode == 1
    assert not merge.clip(f"{name}-(1-2).mp4").exists()
    assert "marker pair 1 is av1, marker pair 2 is h264" in merge.log
    assert "--overwrite --only 1" in merge.log


# A video host stand-in: a long synthetic video and its audio served over local HTTP with byte
# ranges, so tests can count how much of the video each clip fetches.
NETWORK_VIDEO_SECONDS = 20
NETWORK_PAIR = (10.0, 12.0)


@pytest.fixture(scope="session")
def networkMedia(tmp_path_factory: pytest.TempPathFactory) -> pathlib.Path:
    folder = tmp_path_factory.mktemp("network-media")
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg")
    quiet = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi"]
    subprocess.run(
        [*quiet, "-i", f"testsrc2=size=640x360:rate=30000/1001:duration={NETWORK_VIDEO_SECONDS}",
         "-c:v", "libvpx-vp9", "-b:v", "1M", "-g", "60", "-deadline", "realtime", "-cpu-used", "8",
         str(folder / "video.webm")],
        check=True,
    )  # fmt: skip
    subprocess.run(
        [*quiet, "-i", f"sine=frequency=440:duration={NETWORK_VIDEO_SECONDS}", "-c:a", "libopus",
         str(folder / "audio.webm")],
        check=True,
    )  # fmt: skip
    return folder


@pytest.fixture
def videoHost(
    networkMedia: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[RangeHTTPServer]:
    """Serves the network media and makes the clipper's yt-dlp lookup return its URLs."""
    with RangeHTTPServer(networkMedia) as server:

        def videoInfo(_cs: object) -> dict:
            video = {"url": server.url("video.webm"), "format_id": "248", "ext": "webm", "vcodec": "vp9",
                     "acodec": "none", "width": 640, "height": 360, "fps": 29.97, "tbr": 1000, "protocol": "https"}  # fmt: skip
            audio = {"url": server.url("audio.webm"), "format_id": "251", "ext": "webm", "vcodec": "none",
                     "acodec": "opus", "abr": 128, "tbr": 128, "protocol": "https"}  # fmt: skip
            return {"requested_formats": [video, audio], "formats": [video, audio]}

        monkeypatch.setattr("clipper.ytc_settings.ytdl_bin_get_video_info", videoInfo)
        yield server


def segmentReads(clipper: Clipper, videoHost: RangeHTTPServer, name: str, args: list[str]) -> int:
    """Clips the network video's marker pair and returns how many times it read the pair's part
    of the video."""
    if clipper.exe:
        pytest.skip("replaces the yt-dlp lookup, so it runs the clipper in-process")
    clipper.requireEncoder("libvpx-vp9")
    start, end = NETWORK_PAIR
    markers = syntheticMarkers(
        clipper.markersDir,
        name,
        [{"x": start, "y": 1}, {"x": end, "y": 1}],
        NETWORK_PAIR,
    )
    videoHost.reset()
    run = clipper.run(["--markers-json", str(markers), *OFFLINE_ARGS, *args])
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    clips = [
        path
        for path in (clipper.cwd / "webms" / name).glob("*")
        if path.suffix in {".webm", ".mp4"}
    ]
    assert len(clips) == 1
    # Through the frame shown at the pair's end, as the clipper renders it
    length = clipperOutputDuration([{"x": start, "y": 1}, {"x": end, "y": 1}], "30000/1001")
    assert clipper.probeDuration(clips[0]) == pytest.approx(length, abs=LENGTH_TOLERANCE)
    # The pair is at 50% to 60% of the video, and a read starts at the keyframe before it.
    return videoHost.readsStartingIn("video.webm", 0.3, 0.7)


def test_a_clip_seeks_to_its_part_of_a_network_video(
    clipper: Clipper,
    videoHost: RangeHTTPServer,
) -> None:
    assert segmentReads(clipper, videoHost, "network-one-pass", []) == 1


# Both read their input twice, so they fetch the segment twice. A local copy of the segment would
# fix it, but costs memory or disk for an opt-in setting; --download-video covers users who mind.
FETCHED_TWICE = pytest.mark.xfail(reason="reads the network video twice", strict=True)


@pytest.mark.parametrize(
    "args",
    [
        pytest.param(["--two-pass"], id="two-pass", marks=FETCHED_TWICE),
        pytest.param(["--video-stabilization", "1"], id="stabilization", marks=FETCHED_TWICE),
    ],
)
def test_a_clip_fetches_its_part_of_a_network_video_once(
    clipper: Clipper,
    videoHost: RangeHTTPServer,
    args: list[str],
) -> None:
    assert segmentReads(clipper, videoHost, f"network-{args[0].strip('-')}", args) == 1


# A local page with several MP4 sources stands in for a video page with several formats, so the lower
# quality prompt runs end to end offline: the real yt-dlp probes each source over HTTP, and a source
# served as 404 cannot be downloaded. Each source has its own frame size, so the clip shows which one
# was downloaded.
PAGE_FORMATS = {"1080p": (192, 108), "720p": (128, 72), "480p": (96, 54)}


class PageServer(http.server.ThreadingHTTPServer):
    unavailable: set[str]


class PageHandler(http.server.SimpleHTTPRequestHandler):
    server: PageServer

    def isUnavailable(self) -> bool:
        return self.path.lstrip("/").removesuffix(".mp4") in self.server.unavailable

    def do_GET(self) -> None:
        if self.isUnavailable():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self.isUnavailable():
            self.send_error(404)
            return
        super().do_HEAD()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


@pytest.fixture(scope="module")
def pageServer(tmp_path_factory: pytest.TempPathFactory) -> Iterator[PageServer]:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg")
    root = tmp_path_factory.mktemp("page")
    sources = []
    for label, (width, height) in PAGE_FORMATS.items():
        subprocess.run(
            [ffmpeg, "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate=30:duration=4",
             "-f", "lavfi", "-i", "sine=duration=4", "-c:v", "libx264", "-c:a", "aac", "-shortest",
             "-movflags", "+faststart", str(root / f"{label}.mp4")],
            check=True,
        )  # fmt: skip
        sources.append(f'<source src="{label}.mp4" type="video/mp4" label="{label}">')
    (root / "index.html").write_text(
        f"<html><body><video>{''.join(sources)}</video></body></html>", encoding="utf-8"
    )
    server = PageServer(("127.0.0.1", 0), functools.partial(PageHandler, directory=str(root)))
    server.unavailable = set()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()


def pageMarkers(folder: pathlib.Path, url: str, name: str) -> pathlib.Path:
    """The test markers, one short full-frame pair, for a page whose URL the markers JSON gives (as
    Weverse markers do)."""
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    data.update(platform="weverse", videoUrl=url, videoID=name, titleSuffix=name, videoTag=name)
    data.update(cropRes="1920x1080", cropResWidth=1920, cropResHeight=1080)
    data["markerPairs"] = [{"number": 1, "start": 0.5, "end": 2.5, "speed": 1, "crop": "0:0:iw:ih", "enableZoomPan": False, "cropRes": "1920x1080", "overrides": {}}]  # fmt: skip
    path = folder / f"{name}.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


@dataclass(frozen=True)
class PromptCase:
    args: tuple[str, ...]
    unavailable: frozenset[str]
    answer: str | None
    exitCode: int
    clipFrom: str | None  # the page format the clip must come from; None: no clip
    printed: str | None = None


# The whole script once, through the prompt to a clip from the fallback format. The answers, formats
# and sorts are tested in test_ytdl.py, in process and with the real yt-dlp.
PROMPT_CASES = [
    pytest.param(PromptCase((), frozenset({"1080p"}), "y\n", 0, "720p", "Continuing with format 720p (720p)."), id="fallback, answer y"),
]  # fmt: skip


@pytest.mark.parametrize("case", PROMPT_CASES)
def test_lower_quality_prompt_end_to_end(
    clipper: Clipper,
    pageServer: PageServer,
    tmp_path: pathlib.Path,
    request: pytest.FixtureRequest,
    caplog: pytest.LogCaptureFixture,
    case: PromptCase,
) -> None:
    """The full clipper script with the user's --format and --format-sort, the real yt-dlp, the
    answer typed at the prompt, and the clip that comes out."""
    clipper.requireEncoder("libvpx-vp9")
    # pytest's own root handler makes the clipper's logging.basicConfig a no-op, so set the
    # clipper's default level (VERBOSE) here, as a real run has it.
    caplog.set_level(15)
    pageServer.unavailable = set(case.unavailable)
    url = f"http://127.0.0.1:{pageServer.server_address[1]}/index.html"
    name = "page-" + re.sub(r"[^a-z0-9]+", "-", request.node.callspec.id.lower()).strip("-")
    output = clipper.cwd / "webms" / name
    try:
        markers = pageMarkers(tmp_path, url, name)
        run = clipper.run(
            ["--markers-json", str(markers), *OFFLINE_ARGS, *case.args],
            answer=(case.answer or "").strip() or None,
        )
        logs = "".join(log.read_text(encoding="utf-8") for log in output.glob("logs/*.log"))
        print(run.stdout, run.stderr, logs)
        # In process the log file may not be flushed yet, so the captured records count too.
        # Compared without whitespace: the log wraps long lines, even inside an option name.
        everything = re.sub(r"\s+", "", run.stdout + run.stderr + logs + caplog.text)
        assert run.returncode == case.exitCode
        if case.printed:
            assert re.sub(r"\s+", "", case.printed) in everything
        # The run asks exactly when a format fell back and --accept-lower-quality is not set.
        asked = "Cannotdownloadformat" in everything and "--accept-lower-quality" not in case.args
        assert asked == (case.answer is not None)
        clips = list(output.glob("*.webm"))
        if case.clipFrom is None:
            assert not clips
            return
        (clip,) = clips
        ffprobe = clipper.toolPath("ffprobe")
        assert ffprobe is not None
        stream = json.loads(subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(clip)],
            capture_output=True, text=True, check=True,
        ).stdout)["streams"][0]  # fmt: skip
        assert (stream["width"], stream["height"]) == PAGE_FORMATS[case.clipFrom]
    finally:
        pageServer.unavailable = set()
        # A built clipper writes into its install folder, which must stay clean (see smoke_test.py).
        shutil.rmtree(output, ignore_errors=True)
