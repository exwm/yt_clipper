import copy
import json
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from clipper import clip_maker, markers_schema, util, ytc_settings
from clipper.clipper_types import INVALID_MARKER_PAIR_KEY, ClipperState

EXAMPLES_DIR = Path(__file__).resolve().parents[2] / "schema" / "examples"
TESTDATA_DIR = Path(__file__).resolve().parent / "testdata"
VALID_FILES = [*sorted(EXAMPLES_DIR.glob("*.json")), *sorted(TESTDATA_DIR.glob("*.json"))]


def kitchenSink() -> dict[str, Any]:
    return json.loads((EXAMPLES_DIR / "kitchen-sink.json").read_text(encoding="utf-8"))


def validate(markers: dict[str, Any]) -> markers_schema.MarkersValidation:
    markers_schema.normalizeLegacyFormat(markers)
    return markers_schema.validateMarkers(markers)


@pytest.mark.parametrize("path", VALID_FILES, ids=lambda path: path.name)
def test_markup_saved_files_are_valid(path: Path) -> None:
    validation = validate(json.loads(path.read_text(encoding="utf-8")))
    assert validation == markers_schema.MarkersValidation()


@pytest.mark.parametrize("crop", ["0:0:960:540", "0:0:0960:0540", "0:0:1.5:1.25", "10.5:0:iw:ih", "0:0:1:1"])
def test_crops_with_a_width_and_height_above_zero_are_valid(crop: str) -> None:
    markers = kitchenSink()
    markers["markerPairs"][0]["crop"] = crop
    assert validate(markers) == markers_schema.MarkersValidation()


def test_legacy_format_is_normalized() -> None:
    markers = json.loads((EXAMPLES_DIR / "legacy-markers-key.json").read_text(encoding="utf-8"))
    validate(markers)
    assert "markers" not in markers
    assert markers["markerPairs"][0]["speed"] == 0.5


@pytest.mark.parametrize(
    ("path", "key"),
    [
        pytest.param([], "extraFfmpegArgs", id="extra ffmpeg args"),
        pytest.param([], "ffmpegToolsDir", id="ffmpeg tools dir"),
        pytest.param([], "ytdlDir", id="yt-dlp dir"),
        pytest.param([], "inputVideo", id="input video"),
        pytest.param([], "cookiesFromBrowser", id="browser cookies"),
        pytest.param(["markerPairs", 0, "overrides"], "extraVideoFilters", id="override filter"),
        pytest.param(["markerPairs", 0, "cropMap", 1], "crop2", id="crop point key"),
        pytest.param(["denoise"], "extra", id="nested preset key"),
        # Saved by 5.49 dev builds; the clipper solves the path itself now
        pytest.param(["markerPairs", 1], "cropPath", id="saved crop path"),
    ],
)
def test_unknown_keys_are_dropped(path: list[Any], key: str) -> None:
    markers = kitchenSink()
    target = markers
    for part in path:
        target = target[part]
    target[key] = "-y C:/Users/me/AppData/evil.bat"

    validation = validate(markers)

    assert key not in target
    assert validation.droppedKeys == [markers_schema.formatPath([*path, key])]
    assert not validation.globalErrors
    assert not validation.pairErrors


@pytest.mark.parametrize(
    ("key", "value"),
    [
        pytest.param("crf", "30 -y", id="number with arguments"),
        pytest.param("rotate", "clock,movie=x", id="rotate not in enum"),
        pytest.param("videoUrl", "-o evil.exe", id="url as option"),
        pytest.param("videoID", 'id" -y', id="id with quote"),
        pytest.param("markerPairMergeList", "1-2; -i x", id="merge list"),
        pytest.param("cropRes", "1920x1080:x", id="crop res"),
        pytest.param("cropRes", "0x1080", id="zero crop res"),
        pytest.param("markerPairMergeList", "1--2", id="malformed merge list"),
        pytest.param("denoise", {"enabled": True, "lumaSpatial": "4:x"}, id="preset value"),
        pytest.param("markerPairs", {}, id="pairs not a list"),
        pytest.param("cropPointEasingCinematicMargin", "40 -y", id="cinematic margin with arguments"),
        pytest.param("cropPointEasingCinematicMargin", 51, id="cinematic margin above 50%"),
        pytest.param("cropPointEasingCinematicZoomMargin", 101, id="cinematic zoom margin above 100%"),
        pytest.param("cropPointEasingCinematicHolds", "Firm", id="unknown hold points option"),
    ],
)
def test_invalid_global_settings_are_reported(key: str, value: object) -> None:
    markers = kitchenSink()
    markers[key] = value
    validation = validate(markers)
    assert validation.globalErrors
    assert not validation.pairErrors


@pytest.mark.parametrize(
    ("key", "value"),
    [
        pytest.param("newMarkerCrop", "0:NaN:iw:ih", id="NaN new marker crop"),
        pytest.param("version", 5, id="numeric version"),
        # It only decides whether to warn that Cinematic crops may move differently.
        pytest.param("cropPointEasingCinematicSolverVersion", "1", id="Cinematic solver version string"),
    ],
)
def test_invalid_markup_only_settings_are_dropped(key: str, value: object) -> None:
    markers = kitchenSink()
    markers[key] = value
    validation = validate(markers)
    assert key not in markers
    assert len(validation.droppedInvalidSettings) == 1
    assert not validation.globalErrors


def test_missing_required_setting_is_reported() -> None:
    markers = kitchenSink()
    del markers["videoTitle"]
    assert validate(markers).globalErrors


@pytest.mark.parametrize(
    ("path", "value"),
    [
        pytest.param(["crop"], "0:0:iw:ih,movie=C\\:/secret", id="crop filter injection"),
        pytest.param(["crop"], "0:NaN:1:NaN", id="NaN crop"),
        pytest.param(["crop"], "0:0:0:540", id="zero crop width"),
        pytest.param(["crop"], "0:0:960:0.0", id="zero crop height"),
        pytest.param(["crop"], "0:0:0.4:1", id="crop width that rounds to zero"),
        # Python's $ also matches before a final newline.
        pytest.param(["crop"], "0:0:iw:ih\n", id="crop with a trailing newline"),
        pytest.param(["start"], None, id="NaN start"),
        pytest.param(["speed"], "1 -an", id="non-numeric speed"),
        pytest.param(["speed"], 0, id="zero speed"),
        pytest.param(["overrides", "gamma"], "1.0 -y", id="override value"),
        pytest.param(["cropMap", 1, "crop"], "1:1:1:1;", id="crop point"),
        pytest.param(["cropMap", 2, "hold"], "yes", id="hold that is not a boolean"),
        pytest.param(["cropMap", 2, "hold"], False, id="hold that is false"),
        pytest.param(["speedMap", 0, "y"], -1, id="speed point"),
        pytest.param(["overrides", "cropPointEasing"], "linear", id="unknown crop easing"),
        pytest.param(["overrides", "cropPointEasingCinematicHolds"], "Firm", id="unknown hold points option"),
    ],
)
def test_invalid_pair_values_only_fail_that_pair(path: list[Any], value: object) -> None:
    markers = kitchenSink()
    target = markers["markerPairs"][0]
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = value

    validation = validate(markers)

    assert not validation.globalErrors
    assert list(validation.pairErrors) == [0]


def test_missing_pair_field_fails_that_pair() -> None:
    markers = kitchenSink()
    del markers["markerPairs"][2]["end"]
    assert list(validate(markers).pairErrors) == [2]


def writeMarkers(tmp_path: Path, text: str) -> dict[str, Any]:
    markers_json = tmp_path / "markers.json"
    markers_json.write_text(text, encoding="utf-8")
    return {"json": str(markers_json), "inputVideo": ""}


def test_loader_marks_invalid_pairs_and_keeps_numbering(tmp_path: Path) -> None:
    markers = kitchenSink()
    markers["markerPairs"][1]["crop"] = "0:0:iw:ih,movie=x"
    markers["markerPairs"][2]["start"] = float("nan")  # written as a bare NaN literal
    settings = writeMarkers(tmp_path, json.dumps(markers))

    ytc_settings.loadSettingsFromMarkersJson(settings)

    pairs = settings["markerPairs"]
    assert len(pairs) == 3
    assert INVALID_MARKER_PAIR_KEY not in pairs[0]
    assert INVALID_MARKER_PAIR_KEY in pairs[1]
    assert INVALID_MARKER_PAIR_KEY in pairs[2]


@pytest.mark.parametrize(
    "number",
    [
        # Python reads 1e400 as infinity, which would pass a minimum.
        pytest.param("1e400", id="too large for a float"),
        # It reads a long integer exactly, which overflows later in float math.
        pytest.param("9" * 401, id="too large for an int64"),
    ],
)
def test_loader_marks_a_number_too_large_invalid(tmp_path: Path, number: str) -> None:
    markers = kitchenSink()
    markers["markerPairs"][0]["end"] = 99999
    text = json.dumps(markers).replace('"end": 99999', f'"end": {number}', 1)
    settings = writeMarkers(tmp_path, text)
    ytc_settings.loadSettingsFromMarkersJson(settings)
    assert INVALID_MARKER_PAIR_KEY in settings["markerPairs"][0]


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(b'{"markerPairs": [], "crf": 1', id="invalid JSON"),
        pytest.param('{"titleSuffix": "José"}'.encode("cp1252"), id="not UTF-8"),
        # Python refuses to convert an integer this long.
        pytest.param(('{"crf": ' + "9" * 5000 + "}").encode(), id="integer too long to read"),
    ],
)
def test_loader_stops_with_a_clear_error_on_an_unreadable_file(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    content: bytes,
) -> None:
    markers_json = tmp_path / "markers.json"
    markers_json.write_bytes(content)
    with pytest.raises(SystemExit):
        ytc_settings.loadSettingsFromMarkersJson({"json": str(markers_json), "inputVideo": ""})
    assert "Markers JSON file is invalid" in caplog.text


def test_loader_keeps_every_valid_value(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    markers = kitchenSink()
    hostile = {**markers, "extraFfmpegArgs": "-y evil.bat", "newMarkerCrop": "0:NaN:iw:ih"}
    settings = writeMarkers(tmp_path, json.dumps(hostile))

    ytc_settings.loadSettingsFromMarkersJson(settings)

    assert "extraFfmpegArgs" in caplog.text
    assert "newMarkerCrop" in caplog.text
    assert "extraFfmpegArgs" not in settings
    assert "newMarkerCrop" not in settings
    # titleSuffix comes from the file name.
    for key in markers.keys() - {"newMarkerCrop", "titleSuffix"}:
        assert settings[key] == markers[key], key
    assert settings["titleSuffix"] == "markers"


@pytest.mark.parametrize(
    ("saved", "warns"),
    [
        pytest.param({}, False, id="no cinematic pairs"),
        pytest.param({"cropPointEasingCinematicSolverVersion": 1}, False, id="same version"),
        pytest.param({"cropPointEasingCinematicSolverVersion": 2}, True, id="other version"),
    ],
)
def test_loader_warns_when_the_cinematic_version_differs(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    saved: dict[str, int],
    warns: bool,
) -> None:
    markers = kitchenSink()
    markers.pop("cropPointEasingCinematicSolverVersion")
    settings = writeMarkers(tmp_path, json.dumps({**markers, **saved}))

    ytc_settings.loadSettingsFromMarkersJson(settings)

    assert ("Cinematic crop easing version" in caplog.text) == warns


@pytest.mark.parametrize(
    "text",
    [
        pytest.param(json.dumps({**kitchenSink(), "crf": "30 -y"}), id="invalid setting"),
        pytest.param("[]", id="not an object"),
    ],
)
def test_loader_exits_on_invalid_file(tmp_path: Path, text: str) -> None:
    with pytest.raises(SystemExit):
        ytc_settings.loadSettingsFromMarkersJson(writeMarkers(tmp_path, text))


def test_file_name_with_trailing_whitespace_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        ytc_settings.setMarkersFileNames({"json": str(tmp_path / "markers .json")})


@pytest.mark.parametrize(
    "name",
    [
        pytest.param('x" -y "z.json', id="a double quote"),
        pytest.param(
            "x\\.json",
            id="a backslash",
            marks=pytest.mark.skipif(sys.platform == "win32", reason="a folder separator on Windows"),
        ),
    ],
)
def test_a_file_name_with_quotes_names_clips_as_one_argument(tmp_path: Path, name: str) -> None:
    # The name becomes part of each clip's file name, inside a quoted ffmpeg argument.
    settings = {"json": str(tmp_path / name)}
    ytc_settings.setMarkersFileNames(settings)
    clip = f"{settings['titleSuffix']}-1.webm"
    assert shlex.split(f'ffmpeg -i in.mp4 "{clip}"') == ["ffmpeg", "-i", "in.mp4", clip]

def test_loader_strips_quotes_and_backslashes_from_title(tmp_path: Path) -> None:
    settings = writeMarkers(tmp_path, json.dumps({**kitchenSink(), "videoTitle": 'a "b" c\\'}))
    ytc_settings.loadSettingsFromMarkersJson(settings)
    assert settings["videoTitle"] == "a b c"


def test_make_clips_skips_invalid_pairs(monkeypatch: pytest.MonkeyPatch) -> None:
    validPair = copy.deepcopy(kitchenSink()["markerPairs"][2])
    invalidPair = {INVALID_MARKER_PAIR_KEY: ["crop: invalid"], "overrides": {}}
    cs = ClipperState(
        settings={
            "markerPairs": [validPair, invalidPair],
            "only": "",
            "except": "",
            "previewFormat": "none",
            "markerPairMergeList": "",
        },
    )
    encoded: list[int] = []

    def fakeMakeClip(_cs: ClipperState, markerPairIndex: int) -> dict[str, Any]:
        encoded.append(markerPairIndex)
        return {**cs.settings["markerPairs"][markerPairIndex], "returncode": 0}

    monkeypatch.setattr(clip_maker, "makeClip", fakeMakeClip)

    clip_maker.makeClips(cs)

    assert encoded == [0]
    assert cs.settings["markerPairs"][1]["returncode"] == 1


def test_preview_refuses_invalid_pairs(monkeypatch: pytest.MonkeyPatch) -> None:
    validPair = copy.deepcopy(kitchenSink()["markerPairs"][2])
    invalidPair = {INVALID_MARKER_PAIR_KEY: ["crop: invalid"], "overrides": {}}
    cs = ClipperState(settings={"markerPairs": [validPair, invalidPair]})
    answers = iter(["3", "2", "1", "q"])  # out of range, invalid, valid, quit
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))
    previewed: list[int] = []
    monkeypatch.setattr(
        clip_maker,
        "makeClip",
        lambda _cs, markerPairIndex: previewed.append(markerPairIndex),
    )

    clip_maker.previewClips(cs)

    assert previewed == [0]


def test_merge_with_an_invalid_pair_is_skipped_when_declined(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clip = tmp_path / "clip-1.webm"
    clip.touch()
    validPair = {"returncode": 0, "fileName": clip.name, "filePath": str(clip), "overrides": {}}
    invalidPair = {INVALID_MARKER_PAIR_KEY: ["crop: invalid"], "overrides": {}, "returncode": 1}
    cs = ClipperState(
        settings={"markerPairs": [validPair, invalidPair], "markerPairMergeList": "1-2"},
    )
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    monkeypatch.setattr(
        clip_maker.subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("merged with an invalid pair"),
    )

    clip_maker.mergeClips(cs)


def test_a_merged_clip_named_from_a_quoted_title_prefix_stays_one_argument(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pairs = []
    for number in (1, 2):
        clip = tmp_path / f"clip-{number}.webm"
        clip.touch()
        overrides = {"titlePrefix": 'x" -f mp4 "y'}
        pairs.append({"returncode": 0, "fileName": clip.name, "filePath": str(clip), "overrides": overrides})
    cs = ClipperState(
        settings={
            "markerPairs": pairs,
            "markerPairMergeList": "1-2",
            "titleSuffix": "suffix",
            "videoCodec": "vp9",
            "overwrite": True,
        },
    )
    cs.clipper_paths.clipsPath = str(tmp_path)
    commands: list[list[str]] = []
    monkeypatch.setattr(
        clip_maker.subprocess,
        "run",
        lambda args, **_kwargs: commands.append(args) or subprocess.CompletedProcess(args, 1),
    )

    clip_maker.mergeClips(cs)

    assert len(commands) == 1
    assert commands[0][-1] == f"{tmp_path}/x -f mp4 y-suffix-(1-2).webm"


@pytest.mark.parametrize("platform", ["win32", "darwin", "linux"])
def test_title_prefix_cannot_leave_the_output_folder(
    monkeypatch: pytest.MonkeyPatch,
    platform: str,
) -> None:
    monkeypatch.setattr("sys.platform", platform)
    assert "/" not in clip_maker.cleanFileName("../../Library/x")


@pytest.mark.parametrize("platform", ["win32", "darwin", "linux"])
@pytest.mark.parametrize("name", ['x" -y -f mp4 "z', "x\\", 'a\\"b'], ids=["quotes", "trailing backslash", "escaped quote"])
def test_a_cleaned_file_name_stays_one_argument_of_a_quoted_command(
    monkeypatch: pytest.MonkeyPatch,
    platform: str,
    name: str,
) -> None:
    # Commands splice output paths as "{path}" and run through shlex.split.
    monkeypatch.setattr("sys.platform", platform)
    cleaned = clip_maker.cleanFileName(name)
    assert shlex.split(f'ffmpeg -i in.mp4 "{cleaned}"') == ["ffmpeg", "-i", "in.mp4", cleaned]


@pytest.mark.parametrize("platform", ["win32", "darwin", "linux"])
def test_a_title_prefix_with_quotes_keeps_its_5_48_clip_name(
    monkeypatch: pytest.MonkeyPatch,
    platform: str,
) -> None:
    # Clips made by 5.48 are found again on a rerun or merge.
    monkeypatch.setattr("sys.platform", platform)
    assert clip_maker.cleanFileName('Song "Live"') == "Song Live"


@pytest.mark.parametrize("platform", ["win32", "darwin", "linux"])
@pytest.mark.parametrize(
    "name",
    ["a-x-2.webm\nfile /example/private.webm\n#", "a\rb"],
    ids=["newline", "carriage return"],
)
def test_a_cleaned_file_name_stays_one_line_of_a_concat_list(
    monkeypatch: pytest.MonkeyPatch,
    platform: str,
    name: str,
) -> None:
    # A merge writes a "file '<name>'" line per clip, and the concat demuxer reads a directive per line.
    monkeypatch.setattr("sys.platform", platform)
    line = f"file '{util.escapeSingleQuotesFFmpeg(clip_maker.cleanFileName(name))}'"
    assert line.splitlines() == [line]
