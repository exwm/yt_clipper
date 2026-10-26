import json
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, List

import pytest

from clipper import ytdl
from clipper.clipper_types import ClipperState


def buildArgs(**cookieSettings: str) -> List[str]:
    settings = {
        "format": "bv*+ba/b",
        "formatSort": ["res"],
        "downloadVideoPath": "out",
        "cookiefile": "",
        "cookiesFromBrowser": "",
        "username": "",
        "password": "",
        **cookieSettings,
    }
    return ytdl.ytdl_bin_get_args_base(ClipperState(settings=settings))


def assertFollows(args: List[str], flag: str, value: str) -> None:
    """Assert ``flag`` appears immediately followed by ``value``."""
    assert flag in args
    assert args[args.index(flag) + 1] == value


def test_a_release_passes_yt_dlp_its_ffmpeg_path_unquoted(monkeypatch: pytest.MonkeyPatch) -> None:
    # The clipper keeps tool paths shell-quoted; yt-dlp gets an argument list, so quotes would be
    # part of the path, and the mkv remux of every download needs ffmpeg.
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    cs = ClipperState(
        settings={
            "format": "bv*+ba/b", "formatSort": ["res"], "downloadVideoPath": "out",
            "cookiefile": "", "cookiesFromBrowser": "", "username": "", "password": "",
        },
    )  # fmt: skip
    cs.clipper_paths.ffmpegPath = shlex.quote("C:\\Users\\example\\My Tools\\ffmpeg.exe")
    assertFollows(ytdl.ytdl_bin_get_args_base(cs), "--ffmpeg-location", "C:\\Users\\example\\My Tools\\ffmpeg.exe")


def test_cookiefile_passed_as_cookies() -> None:
    args = buildArgs(cookiefile="cookies.txt")
    assertFollows(args, "--cookies", "cookies.txt")
    assert "--cookies-from-browser" not in args


def test_cookies_from_browser_passed_through() -> None:
    args = buildArgs(cookiesFromBrowser="firefox:Default")
    assertFollows(args, "--cookies-from-browser", "firefox:Default")
    assert "--cookies" not in args


def test_neither_cookie_source_adds_no_cookie_flags() -> None:
    args = buildArgs()
    assert "--cookies" not in args
    assert "--cookies-from-browser" not in args


def test_both_cookie_sources_is_a_fatal_error() -> None:
    # yt-dlp rejects the combination, so we exit before invoking it.
    with pytest.raises(SystemExit):
        buildArgs(cookiefile="cookies.txt", cookiesFromBrowser="firefox")


@pytest.mark.parametrize(
    ("preferred", "selected", "skipped"),
    [
        pytest.param(["137", "251"], ["137", "251"], [], id="preferred formats downloadable"),
        pytest.param(["137", "251"], ["248", "251"], ["137"], id="video skipped"),
        pytest.param(["22"], ["18"], ["22"], id="single combined format"),
    ],
)
def test_find_skipped_format_ids(
    preferred: List[str],
    selected: List[str],
    skipped: List[str],
) -> None:
    assert ytdl.find_skipped_format_ids(preferred, selected) == skipped


@pytest.mark.parametrize(
    ("info", "ids"),
    [
        pytest.param(
            {"requested_formats": [{"format_id": "137"}, {"format_id": "251"}]},
            ["137", "251"],
            id="merged",
        ),
        pytest.param({"format_id": "18"}, ["18"], id="single combined format"),
        pytest.param(
            {"_type": "multi_video", "entries": [{"format_id": "18"}]}, [], id="multi-part video"
        ),
    ],
)
def test_selected_format_ids(info: dict, ids: List[str]) -> None:
    assert ytdl.selected_format_ids(info) == ids


def test_parse_preferred_formats_output() -> None:
    stdout = "137+251\nID  EXT   RESOLUTION\n----------------\n137 mp4   1920x1080\n"
    assert ytdl.parse_preferred_formats_output(stdout) == (
        ["137", "251"],
        "ID  EXT   RESOLUTION\n----------------\n137 mp4   1920x1080",
    )


TABLE = "ID  EXT   RESOLUTION\n----------------\n137 mp4   1920x1080\n"


@pytest.mark.parametrize(
    ("stdout", "downloads"),
    [
        pytest.param(f"137+251\n{TABLE}", 1, id="one merged download"),
        pytest.param(f"137\n{TABLE}251\n{TABLE}", 2, id="comma format: one table per download"),
        pytest.param("", 0, id="no output"),
    ],
)
def test_count_preferred_downloads(stdout: str, downloads: int) -> None:
    assert ytdl.count_preferred_downloads(stdout) == downloads


def videoFormat(
    formatId: str,
    height: int,
    fps: float | None = None,
    dynamicRange: str | None = None,
    vbr: float | None = None,
    vcodec: str = "vp9",
) -> dict:
    return {
        "format_id": formatId,
        "vcodec": vcodec,
        "acodec": "none",
        "height": height,
        "fps": fps,
        "dynamic_range": dynamicRange,
        "vbr": vbr,
    }


def audioFormat(formatId: str, abr: float) -> dict:
    return {"format_id": formatId, "vcodec": "none", "acodec": "opus", "abr": abr}


def ytdlInfo(selected: List[dict], others: List[dict]) -> dict:
    return {"formats": [*others, *selected], "requested_formats": selected}


@pytest.mark.parametrize(
    ("info", "skippedFormatIds", "expectedDrops"),
    [
        pytest.param(
            ytdlInfo([videoFormat("248", 1080)], [videoFormat("313", 2160)]),
            ["313"],
            ["Cannot download format 313 (2160p). The best downloadable format is 248 (1080p)."],
            id="lower resolution video",
        ),
        pytest.param(
            ytdlInfo([videoFormat("401", 2160)], [videoFormat("313", 2160)]),
            ["313"],
            [],
            id="same resolution in another codec",
        ),
        pytest.param(
            ytdlInfo(
                [videoFormat("248", 1080), audioFormat("140", 129)],
                [videoFormat("137", 1080), audioFormat("251", 160)],
            ),
            ["137", "251"],
            ["Cannot download format 251 (160k). The best downloadable format is 140 (129k)."],
            id="audio drop compared only with audio",
        ),
        pytest.param(
            ytdlInfo([videoFormat("248", 1080)], []),
            ["999"],
            [],
            id="skipped id missing from formats",
        ),
        pytest.param(
            {**videoFormat("18", 360), "formats": [videoFormat("22", 720), videoFormat("18", 360)]},
            ["22"],
            ["Cannot download format 22 (720p). The best downloadable format is 18 (360p)."],
            id="single combined format without requested_formats",
        ),
        pytest.param(
            ytdlInfo([videoFormat("248", 1080, 30)], [videoFormat("303", 1080, 60)]),
            ["303"],
            [
                "Cannot download format 303 (1080p60). The best downloadable format is 248 (1080p30)."
            ],
            id="lower frame rate at the same height",
        ),
        pytest.param(
            ytdlInfo(
                [videoFormat("248", 1080, 60, "SDR")],
                [videoFormat("337", 1080, 60, "HDR10")],
            ),
            ["337"],
            [
                "Cannot download format 337 (1080p60 HDR). The best downloadable format is 248 (1080p60)."
            ],
            id="SDR instead of HDR",
        ),
        pytest.param(
            ytdlInfo([videoFormat("299", 1080, 60)], [videoFormat("313", 2160, 30)]),
            ["313"],
            [
                "Cannot download format 313 (2160p30). The best downloadable format is 299 (1080p60)."
            ],
            id="height outranks frame rate",
        ),
        pytest.param(
            ytdlInfo(
                [videoFormat("248", 1080, 30, vbr=1500, vcodec="vp09.00.40.08")],
                [videoFormat("616", 1080, 30, vbr=4000, vcodec="vp9")],
            ),
            ["616"],
            [
                "Cannot download format 616 (1080p30 4000k). The best downloadable format is 248 (1080p30 1500k)."
            ],
            id="lower bitrate in the same codec",
        ),
        pytest.param(
            ytdlInfo(
                [videoFormat("399", 1080, 30, vbr=1500, vcodec="av01.0.08M.08")],
                [videoFormat("248", 1080, 30, vbr=2500, vcodec="vp9")],
            ),
            ["248"],
            [],
            id="lower bitrate in another codec is not a drop",
        ),
        pytest.param(
            ytdlInfo(
                [videoFormat("337", 1080, 30, "HDR10", vbr=1500)],
                [videoFormat("616", 1080, 30, "SDR", vbr=4000)],
            ),
            ["616"],
            [
                "Cannot download format 616 (1080p30 4000k). The best downloadable format is 337 (1080p30 1500k HDR).",
            ],
            id="bitrate outranks HDR",
        ),
    ],
)
def test_find_quality_drops(
    info: dict,
    skippedFormatIds: List[str],
    expectedDrops: List[str],
) -> None:
    drops = ytdl.find_quality_drops(info, skippedFormatIds)
    assert [ytdl.describe_quality_drop(drop) for drop in drops] == expectedDrops


DROP = [(videoFormat("313", 2160), videoFormat("248", 1080))]

PREFERRED_4K = f"313+251\n{TABLE}"
INFO_1080 = ytdlInfo([videoFormat("248", 1080), audioFormat("251", 160)], [videoFormat("313", 2160)])
INFO_4K = ytdlInfo([videoFormat("313", 2160), audioFormat("251", 160)], [])


@pytest.mark.parametrize(
    ("preferredOutput", "info", "severalDownloads", "drops"),
    [
        pytest.param(PREFERRED_4K, INFO_4K, False, [], id="the preferred formats downloaded"),
        pytest.param(PREFERRED_4K, INFO_1080, False, [("313", "248")], id="a fallback to 1080p"),
        pytest.param(f"313\n{TABLE}251\n{TABLE}", INFO_4K, True, [], id="a comma format"),
    ],
)
def test_plan_format_check(
    preferredOutput: str, info: dict, severalDownloads: bool, drops: List[tuple]
) -> None:
    plan = ytdl.plan_format_check(preferredOutput, info, followFormatOrder=False)
    assert plan.severalDownloads == severalDownloads
    dropIds = [(skipped["format_id"], selected["format_id"]) for skipped, selected in plan.drops]
    assert dropIds == drops


@pytest.mark.parametrize(
    ("formatOrder", "drops"),
    [
        pytest.param(["720p60", "1080"], 0, id="selected sorts after the skipped format: no drop"),
        pytest.param(["1080", "720p60"], 1, id="selected sorts before it: a drop"),
    ],
)
def test_find_quality_drops_follows_the_format_order(formatOrder: List[str], drops: int) -> None:
    # With the user's own --format-sort, yt-dlp's sorted format list is the measure of quality.
    byId = {"1080": videoFormat("1080", 1080, 30), "720p60": videoFormat("720p60", 720, 60)}
    info = {"formats": [byId[i] for i in formatOrder], "requested_formats": [byId["1080"]]}
    assert len(ytdl.find_quality_drops(info, ["720p60"], followFormatOrder=True)) == drops


class RecordingLogger:
    def __init__(self, lines: List[str]) -> None:
        self.lines = lines

    def __getattr__(self, level: str) -> Callable[..., None]:
        return lambda message, *_args, **_kwargs: self.lines.append(f"{level}: {message}")


@pytest.mark.parametrize(
    ("drops", "accept", "answer", "exits"),
    [
        pytest.param([], False, None, False, id="no drop: no prompt"),
        pytest.param(DROP, False, "y", False, id="y"),
        pytest.param(DROP, False, "  Yes  ", False, id="yes with spaces"),
        pytest.param(DROP, False, "n", True, id="n"),
        pytest.param(DROP, False, "", True, id="empty answer"),
        pytest.param(DROP, False, EOFError, True, id="no one to answer"),
        pytest.param(DROP, True, None, False, id="--accept-lower-quality: no prompt"),
    ],
)
def test_prompt_to_continue_on_quality_drop(
    monkeypatch: pytest.MonkeyPatch,
    drops: List[tuple],
    accept: bool,
    answer: object,
    exits: bool,
) -> None:
    # Record the messages directly: other tests set up the real logger, which caplog then misses.
    logged: List[str] = []
    monkeypatch.setattr(ytdl, "logger", RecordingLogger(logged))

    def fakeInput(prompt: str) -> str:
        if answer is None:
            raise AssertionError("should not prompt")
        assert "format 248 (1080p)" in prompt
        if answer is EOFError:
            raise EOFError
        return str(answer)

    monkeypatch.setattr("builtins.input", fakeInput)
    if exits:
        with pytest.raises(SystemExit):
            ytdl.prompt_to_continue_on_quality_drop(drops, acceptLowerQuality=accept)
    else:
        ytdl.prompt_to_continue_on_quality_drop(drops, acceptLowerQuality=accept)
        if drops:
            # The run says which format it continues with.
            assert any("Continuing with format 248 (1080p)" in line for line in logged)


LOG_A_QUALITY_DROP = """
import sys
from clipper import ytc_logger, ytdl
from clipper.clipper_types import ClipperState
ytc_logger.setUpLogger(ClipperState(settings={"noRichLogs": False, "logLevel": None, "preview": True}))
skipped = {"format_id": sys.argv[1], "height": 1080, "vcodec": "vp9", "acodec": "none"}
selected = {"format_id": "136", "height": 720, "vcodec": "avc1", "acodec": "none"}
ytdl.prompt_to_continue_on_quality_drop([(skipped, selected)], acceptLowerQuality=True)
"""


@pytest.mark.parametrize("formatId", ["[/red]", "[link=https://example.com]x[/link]"])
def test_a_format_id_with_square_brackets_is_logged_as_text(formatId: str) -> None:
    # Format ids come from the site's metadata through yt-dlp, and the run's Rich log reads every
    # message as markup. In a subprocess, as the real logger set-up is global.
    run = subprocess.run(
        [sys.executable, "-c", LOG_A_QUALITY_DROP, formatId],
        capture_output=True,
        text=True,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    assert formatId in run.stdout + run.stderr


# A trimmed yt-dlp -F table (plain text, as captured from a pipe) for highlight tests.
FORMATS_TABLE = "\n".join(
    [
        "ID  EXT   RESOLUTION FPS CH |   FILESIZE    TBR PROTO | VCODEC      VBR ACODEC      ABR",
        "-------------------------------------------------------------------------------------",
        "139 m4a   audio only      2 |    3.69MiB    49k https | audio only      mp4a.40.5   49k",
        "251 webm  audio only      2 |    9.73MiB   129k https | audio only      opus       129k",
        "315 webm  3840x2160   60    |    1.27GiB 17174k https | vp9       17174k video only",
        "399 mp4   1920x1080   60    |  118.62MiB  1568k https | av01       1568k video only",
    ],
)


def test_highlight_formats_table_colors_selected_and_unavailable_rows() -> None:
    highlighted = ytdl.highlight_formats_table(
        FORMATS_TABLE,
        selectedFormatIds={"399", "251"},
        unavailableFormatIds=["315"],
    )
    lines = highlighted.splitlines()

    def rowContaining(token: str) -> str:
        return next(line for line in lines if token in line)

    assert rowContaining("399 mp4").startswith(ytdl._FORMAT_ROW_AVAILABLE_STYLE)
    assert rowContaining("251 webm").startswith(ytdl._FORMAT_ROW_AVAILABLE_STYLE)
    assert rowContaining("315 webm").startswith(ytdl._FORMAT_ROW_UNAVAILABLE_STYLE)
    # An untested format keeps its plain row.
    assert (
        rowContaining("139 m4a")
        == "139 m4a   audio only      2 |    3.69MiB    49k https | audio only      mp4a.40.5   49k"
    )


def test_highlight_formats_table_leaves_header_and_separator_uncolored() -> None:
    highlighted = ytdl.highlight_formats_table(
        FORMATS_TABLE,
        selectedFormatIds={"399"},
        unavailableFormatIds=[],
    )
    headerLine, separatorLine = highlighted.splitlines()[:2]
    assert "\x1b[" not in headerLine
    assert "\x1b[" not in separatorLine


def test_highlight_formats_table_no_ids_returns_input_unchanged() -> None:
    assert ytdl.highlight_formats_table(FORMATS_TABLE, set(), []) == FORMATS_TABLE


@pytest.fixture(scope="module")
def localMedia(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A one-second 720p video and an audio track, which yt-dlp reads through file:// URLs."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg")
    folder = tmp_path_factory.mktemp("local-media")
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:duration=1", "-c:v", "libx264", str(folder / "720.mp4")], check=True)  # fmt: skip
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", str(folder / "audio.m4a")], check=True)  # fmt: skip
    return folder


def localVideoInfo(media: Path, folder: Path, hdDownloadable: bool) -> Path:
    """A yt-dlp info JSON with audio, 720p and a preferred 1080p, which points at a missing file
    unless hdDownloadable."""

    def fileFormat(formatId: str, path: Path, **traits: object) -> dict:
        return {
            "format_id": formatId,
            "url": path.as_uri(),
            "protocol": "file",
            "ext": path.suffix[1:],
            **traits,
        }

    hd = media / "720.mp4" if hdDownloadable else folder / "missing.mp4"
    info = {
        "id": "local", "title": "local", "extractor": "generic", "extractor_key": "Generic",
        "webpage_url": (media / "720.mp4").as_uri(),
        "formats": [
            fileFormat("audio", media / "audio.m4a", vcodec="none", acodec="mp4a", abr=128),
            fileFormat("720", media / "720.mp4", vcodec="avc1", acodec="none", height=720, fps=30),
            fileFormat("1080", hd, vcodec="avc1", acodec="none", height=1080, fps=30),
        ],
    }  # fmt: skip
    path = folder / "info.json"
    path.write_text(json.dumps(info), encoding="utf-8")
    return path


def readLocalInfo(monkeypatch: pytest.MonkeyPatch, infoPath: Path) -> None:
    """Every yt-dlp call the clipper makes runs the real yt-dlp on infoPath instead of the video
    page, offline."""
    runYtdlp = subprocess.run

    def runLocally(args: List[str], **kwargs: object) -> subprocess.CompletedProcess:
        localArgs = [sys.executable, "-m", "yt_dlp", *args[1:-1]]
        return runYtdlp(
            [*localArgs, "--enable-file-urls", "--load-info-json", str(infoPath)], **kwargs
        )  # type: ignore[arg-type]

    monkeypatch.setattr(ytdl.subprocess, "run", runLocally)


@pytest.mark.parametrize(
    ("hdDownloadable", "accept", "answer", "selected"),
    [
        pytest.param(
            True,
            False,
            None,
            ["1080", "audio"],
            id="preferred format downloadable: no prompt",
        ),
        pytest.param(False, False, "n", None, id="fallback, answer n: stops"),
        pytest.param(False, False, EOFError, None, id="fallback, no one to answer: stops"),
        pytest.param(False, False, "y", ["720", "audio"], id="fallback, answer y: continues"),
        pytest.param(
            False,
            True,
            None,
            ["720", "audio"],
            id="fallback, --accept-lower-quality: continues",
        ),
    ],
)
def test_video_info_from_real_ytdlp_asks_before_a_lower_quality_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    localMedia: Path,
    hdDownloadable: bool,
    accept: bool,
    answer: object,
    selected: List[str] | None,
) -> None:
    """ytdl_bin_get_video_info with the yt-dlp the clipper depends on, offline: each yt-dlp call
    reads a local info JSON instead of the video page."""
    readLocalInfo(monkeypatch, localVideoInfo(localMedia, tmp_path, hdDownloadable))
    shownBeforeQuestion = []

    def fakeInput(_: str) -> str:
        if answer is None:
            raise AssertionError("should not prompt")
        shownBeforeQuestion.append(capsys.readouterr().out)
        if answer is EOFError:
            raise EOFError
        return str(answer)

    def tableRows(output: str) -> dict[str, str]:
        """Each printed table row by its format id, which follows the row's color code."""
        rows = {}
        for line in output.splitlines():
            plain = line.removeprefix(ytdl._FORMAT_ROW_AVAILABLE_STYLE).removeprefix(
                ytdl._FORMAT_ROW_UNAVAILABLE_STYLE,
            )
            rows.setdefault(plain.split(" ", 1)[0], line)
        return rows

    monkeypatch.setattr("builtins.input", fakeInput)
    cs = ClipperState(
        settings={
            "format": "bv*+ba/b", "formatSort": ["res"], "downloadVideoPath": str(tmp_path / "out"),
            "cookiefile": "", "cookiesFromBrowser": "", "username": "", "password": "",
            "videoPageURL": "https://example.com/watch", "downloadVideo": False, "acceptLowerQuality": accept,
        },
    )  # fmt: skip

    if selected is None:
        with pytest.raises(SystemExit):
            ytdl.ytdl_bin_get_video_info(cs)
    else:
        info = ytdl.ytdl_bin_get_video_info(cs)
        assert ytdl.selected_format_ids(info) == selected
    rows = tableRows("".join(shownBeforeQuestion) + capsys.readouterr().out)
    assert rows[selected[0] if selected else "720"].startswith(ytdl._FORMAT_ROW_AVAILABLE_STYLE)
    if not hdDownloadable:
        assert rows["1080"].startswith(ytdl._FORMAT_ROW_UNAVAILABLE_STYLE)
    if shownBeforeQuestion:
        # The table comes before the question, so the user sees what could not be downloaded.
        assert "1080" in tableRows(shownBeforeQuestion[0])


# A ladder of formats, to test the prompt with the format and sort the user passes to yt-dlp.
LADDER = {
    "audio": {"vcodec": "none", "acodec": "mp4a", "abr": 128},
    "480": {"vcodec": "avc1", "acodec": "none", "height": 480, "fps": 30},
    "720": {"vcodec": "avc1", "acodec": "none", "height": 720, "fps": 30},
    "720p60": {"vcodec": "avc1", "acodec": "none", "height": 720, "fps": 60},
    "1080": {"vcodec": "avc1", "acodec": "none", "height": 1080, "fps": 30},
}
DEFAULT_FORMAT = "(bestvideo+(bestaudio[acodec=opus]/bestaudio))/best"
DEFAULT_SORT = [
    "hasvid,ie_pref,lang,quality,res,fps,br,size,hdr:1,vcodec:vp9.2,vcodec:vp9,asr,proto,ext,hasaud,source,id",
]


def ladderInfo(media: Path, folder: Path, unavailable: set[str], extra: dict | None = None) -> Path:
    """A yt-dlp info JSON of LADDER (and any extra formats) whose unavailable formats point at
    missing files."""
    formats = []
    for formatId, traits in {**LADDER, **(extra or {})}.items():
        path = media / ("audio.m4a" if formatId == "audio" else "720.mp4")
        if formatId in unavailable:
            path = folder / f"missing-{formatId}{path.suffix}"
        formats.append(
            {
                "format_id": formatId,
                "url": path.as_uri(),
                "protocol": "file",
                "ext": path.suffix[1:],
                **traits,
            }
        )
    info = {
        "id": "local", "title": "local", "extractor": "generic", "extractor_key": "Generic",
        "webpage_url": (media / "720.mp4").as_uri(), "formats": formats,
    }  # fmt: skip
    path = folder / "info.json"
    path.write_text(json.dumps(info), encoding="utf-8")
    return path


def localClipperState(tmp_path: Path, formatString: str, formatSort: List[str]) -> ClipperState:
    return ClipperState(
        settings={
            "format": formatString, "formatSort": formatSort, "downloadVideoPath": str(tmp_path / "out"),
            "cookiefile": "", "cookiesFromBrowser": "", "username": "", "password": "",
            "videoPageURL": "https://example.com/watch", "downloadVideo": False, "acceptLowerQuality": False,
        },
    )  # fmt: skip


@pytest.mark.parametrize(
    ("formatString", "formatSort", "unavailable", "prompt", "selected"),
    [
        pytest.param(
            DEFAULT_FORMAT, DEFAULT_SORT, {"1080"}, "format 720p60 (720p60)", ["720p60", "audio"],
            id="default format and sort: asks about the next best",
        ),
        pytest.param(
            "1080+audio/720+audio", ["res"], {"1080"}, "format 720 (720p30)", ["720", "audio"],
            id="format chain: asks about the next format in the chain",
        ),
        pytest.param(
            # The user's sort decides: it ranks the higher resolution fallback lower.
            "bv*+ba/b", ["+res"], {"480"}, "format 720p60 (720p60)", ["720p60", "audio"],
            id="sort preferring the lowest: asks about the higher resolution",
        ),
        pytest.param(
            "bv*+ba/b", ["fps,res"], {"720p60"}, "format 1080 (1080p30)", ["1080", "audio"],
            id="sort preferring frame rate: asks about 1080p30",
        ),
        pytest.param(
            "bv*+ba/b", ["+res"], set(), None, ["480", "audio"],
            id="sort preferring the lowest, all downloadable: no prompt",
        ),
    ],
)  # fmt: skip
def test_lower_quality_prompt_follows_the_users_format_and_sort(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    localMedia: Path,
    formatString: str,
    formatSort: List[str],
    unavailable: set[str],
    prompt: str | None,
    selected: List[str],
) -> None:
    readLocalInfo(monkeypatch, ladderInfo(localMedia, tmp_path, unavailable))
    asked: List[str] = []

    def fakeInput(question: str) -> str:
        asked.append(question)
        return "y"

    monkeypatch.setattr("builtins.input", fakeInput)
    info = ytdl.ytdl_bin_get_video_info(localClipperState(tmp_path, formatString, formatSort))

    assert ytdl.selected_format_ids(info) == selected
    assert len(asked) == (prompt is not None)
    if prompt:
        assert prompt in asked[0]


def test_lower_quality_prompt_custom_sort_asks_about_a_near_equivalent_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    localMedia: Path,
) -> None:
    # The user's sort prefers avc1, so another codec at the same 720p30 is lower to them. The
    # default sort would not ask here (see test_find_quality_drops).
    extra = {"720vp9": {"vcodec": "vp9", "acodec": "none", "height": 720, "fps": 30}}
    readLocalInfo(monkeypatch, ladderInfo(localMedia, tmp_path, {"720", "720p60", "1080"}, extra))
    asked: List[str] = []
    monkeypatch.setattr("builtins.input", lambda question: asked.append(question) or "y")
    info = ytdl.ytdl_bin_get_video_info(
        localClipperState(tmp_path, "bv*+ba/b", ["res:720,fps:30,vcodec:avc1"])
    )
    assert ytdl.selected_format_ids(info) == ["720vp9", "audio"]
    assert len(asked) == 1
    assert "format 720vp9 (720p30)" in asked[0]


def test_lower_quality_prompt_unavailable_only_format_ends_with_the_ytdlp_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    localMedia: Path,
) -> None:
    # With nothing to fall back to, yt-dlp fails, and the run ends with its error (see main).
    readLocalInfo(monkeypatch, ladderInfo(localMedia, tmp_path, {"1080"}))
    with pytest.raises(subprocess.CalledProcessError):
        ytdl.ytdl_bin_get_video_info(localClipperState(tmp_path, "1080+audio", ["res"]))


@pytest.mark.parametrize(
    "unavailable",
    [pytest.param(set(), id="all downloadable"), pytest.param({"720"}, id="video unavailable")],
)
def test_lower_quality_prompt_comma_format_stops_with_a_clear_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    localMedia: Path,
    unavailable: set[str],
) -> None:
    # A comma asks for separate downloads. With the video unavailable, the probe alone would
    # quietly leave only the audio.
    readLocalInfo(monkeypatch, ladderInfo(localMedia, tmp_path, unavailable))
    logged: List[str] = []
    monkeypatch.setattr(ytdl, "logger", RecordingLogger(logged))
    with pytest.raises(SystemExit):
        ytdl.ytdl_bin_get_video_info(localClipperState(tmp_path, "720,audio", ["res"]))
    assert any("several files" in line for line in logged)


def failingPreferredCall(args: List[str]) -> subprocess.CompletedProcess:
    raise subprocess.CalledProcessError(1, args)


def unexpectedPreferredOutput(args: List[str]) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args, 0, stdout=b"not a format list")


@pytest.mark.parametrize(
    ("preferredCall", "breakComparison", "warning"),
    [
        pytest.param(
            failingPreferredCall,
            False,
            "(yt-dlp failed with exit code 1)",
            id="the preferred formats call fails",
        ),
        pytest.param(unexpectedPreferredOutput, False, None, id="it prints something unexpected"),
        pytest.param(None, True, "('format_id')", id="comparing the formats raises"),
    ],
)
def test_lower_quality_check_failing_never_stops_the_clip(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    localMedia: Path,
    preferredCall: Callable[[List[str]], subprocess.CompletedProcess] | None,
    breakComparison: bool,
    warning: str | None,
) -> None:
    readLocalInfo(monkeypatch, ladderInfo(localMedia, tmp_path, {"1080"}))
    runLocally = ytdl.subprocess.run

    def run(args: List[str], **kwargs: object) -> subprocess.CompletedProcess:
        if preferredCall and "--print" in args:
            return preferredCall(args)
        return runLocally(args, **kwargs)

    def brokenComparison(*_args: object, **_kwargs: object) -> None:
        raise KeyError("format_id")

    monkeypatch.setattr(ytdl.subprocess, "run", run)
    if breakComparison:
        monkeypatch.setattr(ytdl, "find_quality_drops", brokenComparison)
    monkeypatch.setattr("builtins.input", lambda _question: pytest.fail("should not ask"))
    logged: List[str] = []
    monkeypatch.setattr(ytdl, "logger", RecordingLogger(logged))

    info = ytdl.ytdl_bin_get_video_info(localClipperState(tmp_path, "bv*+ba/b", ["res"]))

    # The clip goes ahead with what yt-dlp picked after probing.
    assert ytdl.selected_format_ids(info) == ["720p60", "audio"]
    warnings = [line for line in logged if line.startswith("warning: Could not check")]
    assert len(warnings) == (warning is not None)
    if warning:
        assert warning in warnings[0]


def test_no_video_from_ytdlp_stops_with_a_clear_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # yt-dlp can succeed and print nothing, for example for an empty playlist.
    monkeypatch.setattr(
        ytdl.subprocess, "run", lambda args, **_kwargs: subprocess.CompletedProcess(args, 0, stdout=b"\n")
    )
    logged: List[str] = []
    monkeypatch.setattr(ytdl, "logger", RecordingLogger(logged))
    with pytest.raises(SystemExit):
        ytdl.ytdl_bin_get_video_info(localClipperState(tmp_path, "bv*+ba/b", ["res"]))
    assert any("yt-dlp found no video at https://example.com/watch" in line for line in logged)


def test_a_downloaded_single_file_format_is_an_mkv_like_a_merged_one(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    localMedia: Path,
) -> None:
    # yt-dlp merges into mkv only when it merges separate video and audio: --download-video then
    # probed an .mkv that a single-file (e.g. mp4) download never wrote.
    info = {
        "id": "local", "title": "local", "extractor": "generic", "extractor_key": "Generic",
        "webpage_url": (localMedia / "720.mp4").as_uri(),
        "formats": [{
            "format_id": "combined", "url": (localMedia / "720.mp4").as_uri(), "protocol": "file",
            "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a", "height": 720, "fps": 30,
        }],
    }  # fmt: skip
    infoPath = tmp_path / "info.json"
    infoPath.write_text(json.dumps(info), encoding="utf-8")
    readLocalInfo(monkeypatch, infoPath)
    cs = ClipperState(
        settings={
            "format": "bv*+ba/b", "formatSort": ["res"], "downloadVideoPath": str(tmp_path / "out"),
            "cookiefile": "", "cookiesFromBrowser": "", "username": "", "password": "",
            "videoPageURL": "https://example.com/watch", "downloadVideo": True, "acceptLowerQuality": False,
        },
    )  # fmt: skip
    ytdl.ytdl_bin_get_video_info(cs)
    assert cs.settings["downloadVideoPath"] == str(tmp_path / "out.mkv")
    assert (tmp_path / "out.mkv").is_file()
