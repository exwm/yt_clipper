"""End-to-end clipper runs on the test markers JSON.

The clipper runs in-process with ffmpeg from PATH, or with `--clipper-exe PATH` as that built
executable with its bundled tools. The local input video cases run offline. The rest download from
YouTube and are marked slow.
"""

import functools
import http.server
import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from fractions import Fraction

import pytest

from clipper import clip_maker
from clipper.ffmpeg_filter import getSpeedFilterAndDuration
from clipper.frame_grid import FrameGrid, frameSpan
from clipper.yt_clipper import main

TESTDATA = pathlib.Path(__file__).parent.resolve() / "testdata"
MARKERS = TESTDATA / "test-with-dynamic.json"
LOCAL_VIDEO = TESTDATA / "test-with-dynamic.mp4"
SOURCE_FPS = Fraction(30000, 1001)
# A clip may end up to a frame early or late of the speed map's length.
LENGTH_TOLERANCE = float(1 / SOURCE_FPS) + 0.001
EXE = ".exe" if sys.platform == "win32" else ""
# Without it a frozen clipper updates its bundled yt-dlp first.
OFFLINE_ARGS = ("--no-ytdl-auto-update", "--overwrite")


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
        self.monkeypatch = monkeypatch
        self.capsys = capsys

    def toolPath(self, name: str) -> str | None:
        if self.exe:
            return str(self.exe.parent / "bin" / "video-tools" / f"{name}{EXE}")
        return shutil.which(name)

    def requireEncoder(self, encoder: str) -> None:
        ffmpeg = self.toolPath("ffmpeg")
        encoders = ""
        if ffmpeg and pathlib.Path(ffmpeg).is_file():
            encoders = subprocess.run(
                [ffmpeg, "-hide_banner", "-encoders"],
                capture_output=True,
                text=True,
                check=False,
            ).stdout
        if encoder not in encoders:
            pytest.skip(f"needs an ffmpeg with {encoder}")

    def run(self, args: list[str], stdin: str | None = None) -> ClipperRun:
        if self.exe:
            # Only the install's own settings: a shared yt_clipper_default_args.txt next to the
            # installs would change the clips.
            argFiles = ["--arg-files", str(self.exe.parent / "default_args.txt")]
            result = subprocess.run(
                [str(self.exe), *argFiles, *args],
                cwd=self.cwd,
                input=stdin,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            return ClipperRun(result.returncode, result.stdout, result.stderr)
        self.monkeypatch.chdir(self.cwd)
        self.monkeypatch.setattr(sys, "argv", ["yt_clipper.py", *args])
        if stdin is not None:
            self.monkeypatch.setattr(sys, "stdin", io.StringIO(stdin))
        try:
            main()
            returncode = 0
        except SystemExit as systemExit:
            code = systemExit.code
            returncode = code if isinstance(code, int) else int(code is not None)
        out, err = self.capsys.readouterr()
        return ClipperRun(returncode, out, err)

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
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(clip)],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(probe.stdout.strip())


def markerPairLength() -> float:
    """The clip length the test marker pair's speed map asks for, over the frames from the one shown at
    its start marker through the one shown at its end marker."""
    pair = json.loads(MARKERS.read_text(encoding="utf-8"))["markerPairs"][0]
    span = frameSpan(FrameGrid(origin=0, rate=SOURCE_FPS), pair["start"], pair["end"])
    speedMap = pair["speedMap"]
    speedMap[0]["x"], speedMap[-1]["x"] = span.start, span.end
    _, length, _ = getSpeedFilterAndDuration(speedMap, {"isVariableSpeed": True}, SOURCE_FPS)
    return float(length)


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


def clipCase(
    name: str,
    args: tuple[str, ...],
    encoder: str,
    codec: str | None,
    *,
    localVideo: bool,
    slow: bool = False,
) -> object:
    marks = [pytest.mark.slow] if slow or not localVideo else []
    return pytest.param(ClipCase(args, encoder, codec, localVideo), id=name, marks=marks)


CLIP_CASES = [
    clipCase("vp9", (), "libvpx-vp9", "vp9", localVideo=True),
    clipCase("av1", ("--video-codec", "av1"), "libsvtav1", "av1", localVideo=True),
    clipCase(
        "nvenc",
        ("--video-codec", "h264_nvenc"),
        "h264_nvenc",
        "h264",
        localVideo=True,
        slow=True,
    ),
    clipCase("youtube-vp9", (), "libvpx-vp9", "vp9", localVideo=False),
    clipCase(
        "youtube-vulkan",
        ("--video-codec", "h264_vulkan"),
        "h264_vulkan",
        "h264",
        localVideo=False,
    ),
    clipCase("youtube-fast-trim", ("--fast-trim",), "libvpx-vp9", None, localVideo=False),
]


@pytest.mark.slow
def test_get_version_info(clipper: Clipper) -> None:
    run = clipper.run(["--version"])
    print(run.stdout, run.stderr)
    assert run.returncode == 0
    assert re.search(r"yt_clipper\S* v\d", run.stdout)


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
        run = clipper.run(["--markers-json", str(markers), "--input-video", str(broken), *OFFLINE_ARGS])
        assert run.returncode == 1
        log = "".join(path.read_text(encoding="utf-8") for path in output.glob("logs/*"))
        assert "ffprobe could not read the input video" in log
        assert "Unexpected error" not in log
    finally:
        shutil.rmtree(output, ignore_errors=True)


@pytest.mark.parametrize(
    ("crops", "size"),
    [
        pytest.param(("0:0:480:360", "480:0:480:360", "960:360:480:360"), "48x36", id="pan"),
        pytest.param(("0:0:480:360", "240:180:720:540", "0:0:960:720"), "96x72", id="zoom"),
        # Its filter is longer than ffmpeg's command line takes, so it is read from a file.
        pytest.param(("0:0:480:360", "240:180:720:540", "0:0:960:720") * 4, "96x72", id="long zoom"),
    ],
)
def test_cinematic_pair_renders_the_path_solved_from_its_crop_points(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    crops: tuple[str, ...],
    size: str,
) -> None:
    # The local video is a tenth of the markers' crop resolution, so the clip is a tenth of the
    # crops: a pan holds their size, a zoom the largest one.
    clipper.requireEncoder("libvpx-vp9")
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
    pair["overrides"] = {**pair.get("overrides", {}), "cropPointEasing": "cinematic"}
    markers = tmp_path / f"cinematic-{len(crops)}-{size}.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        run = clipper.run(
            ["--markers-json", str(markers), "--input-video", str(LOCAL_VIDEO), *OFFLINE_ARGS]
        )
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        # A failed solve falls back to Smooth Track, which renders at the same size.
        log = "".join(path.read_text(encoding="utf-8") for path in output.glob("logs/*"))
        assert "Could not solve the Cinematic crop path" not in log
        # The long case is there to read its filter from a file.
        assert (output / "temp" / "vfilter-1-pass1.txt").is_file() == (len(crops) > 3)
        clip = next(output.glob("*.webm"))
        ffprobe = clipper.toolPath("ffprobe")
        assert ffprobe is not None
        frames = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=width,height", "-of", "csv=p=0", str(clip)],
            capture_output=True, text=True, check=True,
        ).stdout.split()  # fmt: skip
        assert {frame.replace(",", "x") for frame in frames} == {size}
    finally:
        # A built clipper writes into its install folder, which must stay clean (see smoke_test.py).
        shutil.rmtree(output, ignore_errors=True)


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
        run = clipper.run(["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS])
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        first = frameThumbnails(ffmpeg, next(output.glob("*.webm")), 1)[0]
        sourceFrames = frameThumbnails(ffmpeg, source, 40)
        difference = [sum(abs(a - b) for a, b in zip(first, frame, strict=True)) for frame in sourceFrames]
        assert difference.index(min(difference)) == 30
    finally:
        shutil.rmtree(output, ignore_errors=True)


def numberedVideo(ffmpeg: str, folder: pathlib.Path) -> pathlib.Path:
    """A 4 s, 30 fps lossless video whose frame n has brightness 2n, so a clip's frame names its source
    frame exactly."""
    source = folder / "numbered.mkv"
    subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=gray:size=320x180:rate=30:duration=4",
         "-vf", "geq=lum='2*N':cb=128:cr=128", "-c:v", "libx264", "-qp", "0", str(source)],
        check=True,
    )  # fmt: skip
    return source


def sourceFrames(ffprobe: str, clip: pathlib.Path) -> list[int]:
    """The numbered source frame of each of the clip's frames."""
    movie = clip.as_posix().replace(":", "\\\\:")
    probe = subprocess.run(
        [ffprobe, "-v", "error", "-f", "lavfi", "-i", f"movie={movie},signalstats",
         "-show_entries", "frame_tags=lavfi.signalstats.YAVG", "-of", "csv=p=0"],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    return [round(float(value.strip(",")) / 2) for value in probe.stdout.split()]


@pytest.mark.parametrize(
    ("start", "end", "frames"),
    [
        pytest.param(30 / 30, 50 / 30, (30, 50), id="markers on frame starts"),
        pytest.param(30.5 / 30, 50.5 / 30, (30, 50), id="markers mid-frame"),
        # 6 decimals is how markers are saved; both round a hair below their frame's start.
        pytest.param(round(31 / 30, 6), round(52 / 30, 6), (31, 52), id="markers saved to 6 decimals"),
        pytest.param(30.9 / 30, 50.9 / 30, (30, 50), id="markers late in their frames"),
    ],
)
def test_a_clip_runs_from_the_frame_shown_at_its_start_marker_through_the_one_at_its_end_marker(
    clipper: Clipper,
    tmp_path: pathlib.Path,
    start: float,
    end: float,
    frames: tuple[int, int],
) -> None:
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg, ffprobe = clipper.toolPath("ffmpeg"), clipper.toolPath("ffprobe")
    assert ffmpeg is not None
    assert ffprobe is not None
    source = numberedVideo(ffmpeg, tmp_path)
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    data.update(cropRes="320x180", cropResWidth=320, cropResHeight=180, titleSuffix="numbered")
    data["markerPairs"] = [{"number": 1, "start": start, "end": end, "speed": 1, "crop": "0:0:iw:ih", "enableZoomPan": False, "cropRes": "320x180", "overrides": {}}]  # fmt: skip
    markers = tmp_path / "numbered.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        run = clipper.run(["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS])
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        shown = sourceFrames(ffprobe, next(output.glob("*.webm")))
        assert (shown[0], shown[-1], len(shown)) == (*frames, frames[1] - frames[0] + 1)
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
    "start",
    [pytest.param(30 / 30, id="start marker on a frame start"), pytest.param(30.5 / 30, id="mid-frame")],
)
def test_a_clips_audio_starts_with_its_first_frame(
    clipper: Clipper, tmp_path: pathlib.Path, start: float
) -> None:
    # The source's click starts exactly with frame 40, so in the clip it starts with frame 40 too.
    clipper.requireEncoder("libvpx-vp9")
    ffmpeg, ffprobe = clipper.toolPath("ffmpeg"), clipper.toolPath("ffprobe")
    assert ffmpeg is not None
    assert ffprobe is not None
    video = numberedVideo(ffmpeg, tmp_path)
    source = tmp_path / "numbered-click.mkv"
    subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(video), "-f", "lavfi", "-i",
         "aevalsrc='if(between(t,40/30,40/30+0.01),0.9*sin(2*PI*1000*t),0)':s=48000:d=4",
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
        run = clipper.run(["--markers-json", str(markers), "--input-video", str(source), *OFFLINE_ARGS])
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
        pytest.param(["--video-stabilization", "1"], id="video stabilization's two passes"),
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
        args = ["--markers-json", str(markers), "--input-video", str(source), "--subs-file", str(subs)]
        run = clipper.run([*args, *extraArgs, *OFFLINE_ARGS])
        print(run.stdout, run.stderr)
        assert run.returncode == 0
        assert len(list(output.glob("*.webm"))) == 1
    finally:
        shutil.rmtree(output, ignore_errors=True)


@pytest.mark.parametrize(
    ("makeVideo", "seek"),
    [
        # The pair starts at 1.0 s, and ffplay half a 30 fps frame before. The file starts at
        # -0.1065 s: the audio's 0.1 s lead plus the Opus encoder's 6.5 ms pre-skip.
        pytest.param(audioFirstVideo, 1.1065 - 1 / 60, id="audio first: the file starting before 0"),
        # The pair starts at 11.0 s, the file at 10 s.
        pytest.param(lateStartVideo, 1.0 - 1 / 60, id="late start: the file starting at 10 s"),
    ],
)
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
    monkeypatch.setattr(clip_maker, "input", lambda _prompt="": next(pairPromptAnswers), raising=False)
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
    pair.update(crop=crops[0], cropMap=[{"x": t, "y": 0, "crop": c} for t, c in zip(times, crops, strict=True)])
    pair["overrides"] = {**pair.get("overrides", {}), "cropPointEasing": "cinematic"}
    markers = tmp_path / "cinematic-fallback.json"
    markers.write_text(json.dumps(data), encoding="utf-8")
    output = clipper.cwd / "webms" / markers.stem
    try:
        # In process, so the patched solver is the one that runs.
        run = clipper.run(["--markers-json", str(markers), "--input-video", str(LOCAL_VIDEO), *OFFLINE_ARGS])
        assert run.returncode == 0
        assert len(list(output.glob("*.webm"))) == 1
        assert "Could not solve the Cinematic crop path" in caplog.text
    finally:
        shutil.rmtree(output, ignore_errors=True)


def markersWithCropMap(crops: tuple[str, ...]) -> dict:
    """The test markers with the first pair's crop points spread evenly over it."""
    data = json.loads(MARKERS.read_text(encoding="utf-8"))
    pair = data["markerPairs"][0]
    times = [pair["start"] + (pair["end"] - pair["start"]) * i / (len(crops) - 1) for i in range(len(crops))]
    pair.update(crop=crops[0], cropMap=[{"x": t, "y": 0, "crop": crop} for t, crop in zip(times, crops, strict=True)])
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
        data = markersWithCropMap(("0:0:480:360", "120:0:480:360", "120:0:480:360", "240:120:480:360"))
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
    assert len({filters["default"], filters["pair firm"], filters["pair loose under a global firm"]}) == 3


@pytest.mark.parametrize("case", CLIP_CASES)
def test_make_clip(case: ClipCase, clipper: Clipper) -> None:
    clipper.requireEncoder(case.encoder)
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
        assert clipper.probeDuration(clips[0]) == pytest.approx(markerPairLength(), abs=LENGTH_TOLERANCE)
    log = max((output / "logs").glob("*.log"), key=lambda path: path.stat().st_mtime)
    assert not re.findall(r"\b(?:ERROR|CRITICAL)\b", log.read_text(encoding="utf-8"))


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
    (root / "index.html").write_text(f"<html><body><video>{''.join(sources)}</video></body></html>", encoding="utf-8")
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


PROMPT_CASES = [
    pytest.param(PromptCase((), frozenset(), None, 0, "1080p"), id="all downloadable, no prompt"),
    pytest.param(PromptCase((), frozenset({"1080p"}), "y\n", 0, "720p", "Continuing with format 720p (720p)."), id="fallback, answer y"),
    pytest.param(PromptCase((), frozenset({"1080p"}), "n\n", 1, None, "Stopped without making clips"), id="fallback, answer n"),
    pytest.param(PromptCase((), frozenset({"1080p"}), "", 1, None, "No answer to the prompt"), id="fallback, no one to answer"),
    pytest.param(PromptCase(("--accept-lower-quality",), frozenset({"1080p"}), None, 0, "720p", "as --accept-lower-quality is set"), id="fallback, accept lower quality"),
    pytest.param(PromptCase(("--format", "1080p/480p"), frozenset({"1080p"}), "y\n", 0, "480p", "Continuing with format 480p (480p)."), id="format chain"),
    pytest.param(PromptCase(("--format-sort", "+res"), frozenset({"480p"}), "y\n", 0, "720p", "Continuing with format 720p (720p)."), id="own sort preferring the lowest"),
    pytest.param(PromptCase(("--format", "720p,480p"), frozenset(), None, 1, None, "several files"), id="comma format"),
    pytest.param(PromptCase(("--format", "1080p"), frozenset({"1080p"}), None, 1, None, "failed with exit code"), id="only an unavailable format"),
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
        run = clipper.run(["--markers-json", str(markers), *OFFLINE_ARGS, *case.args], stdin=case.answer)
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
