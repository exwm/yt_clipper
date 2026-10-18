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
from collections.abc import Iterator
from dataclasses import dataclass
from fractions import Fraction

import pytest

from clipper import clip_maker
from clipper.ffmpeg_filter import getSpeedFilterAndDuration
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
        # A built clipper finds its bin/ tools and default_args.txt (e.g. YouTube cookies) in the
        # working folder, so it runs from its own, as the release's .bat helpers do.
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
            result = subprocess.run(
                [str(self.exe), *args],
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
    """The clip length the test marker pair's speed map asks for."""
    speedMap = json.loads(MARKERS.read_text(encoding="utf-8"))["markerPairs"][0]["speedMap"]
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


@pytest.mark.parametrize(
    ("crops", "size"),
    [
        pytest.param(("0:0:480:360", "480:0:480:360", "960:360:480:360"), "48x36", id="pan"),
        pytest.param(("0:0:480:360", "240:180:720:540", "0:0:960:720"), "96x72", id="zoom"),
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
    markers = tmp_path / f"cinematic-{size}.json"
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


def test_cinematic_set_globally_renders_like_a_pair_override(
    clipper: Clipper,
    tmp_path: pathlib.Path,
) -> None:
    # The markup saves a pair's easing only when it overrides the global setting. Frame sizes cannot
    # tell the modes apart, so this compares the crop filters in the runs' logs.
    clipper.requireEncoder("libvpx-vp9")
    crops = ("0:0:480:360", "240:180:720:540", "0:0:960:720")
    filters = {}
    for name, globalEasing, pairEasing in [
        ("pair", None, "cinematic"),
        ("global", "cinematic", None),
        ("none", None, None),
    ]:
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
        pair["overrides"] = {"cropPointEasing": pairEasing} if pairEasing else {}
        if globalEasing:
            data["cropPointEasing"] = globalEasing
        markers = tmp_path / f"cinematic-{name}.json"
        markers.write_text(json.dumps(data), encoding="utf-8")
        output = clipper.cwd / "webms" / markers.stem
        try:
            args = [
                "--markers-json",
                str(markers),
                "--input-video",
                str(LOCAL_VIDEO),
                *OFFLINE_ARGS,
            ]
            assert runInItsOwnProcess(clipper, args) == 0
            filters[name] = loggedVideoFilter(output)
        finally:
            # A built clipper writes into its install folder, which must stay clean (see smoke_test.py).
            shutil.rmtree(output, ignore_errors=True)
    assert filters["global"] == filters["pair"]
    assert filters["none"] != filters["pair"]


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
