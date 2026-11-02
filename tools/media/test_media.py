import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from media_cases import Case, CaseError, build, flagged_licenses
from media_coverage import Clip, Coverage, levelers, levels_of, pick
from media_datasets import DatasetError, Item, cached_path, fetch, load_dataset
from media_steps import Steps
from media_survey import Source, read_frames, survey

from clipper.tests.range_http_server import RangeHTTPServer
from clipper.tests.synthetic_media import CLIPS, SyntheticClip

DATASET = """\
title = "Test set"
license = "CC BY 4.0"
items = [
  { id = "live-1", url = "URL", size = SIZE, sha256 = "SHA", category = "LiveMusic", mos = 3.5, labels = ["Concert"] },

  { id = "dance-news", url = "u2", size = 1, md5 = "ab", category = "NewsClip", labels = ["Dance"] },
  { id = "news", url = "u3", size = 1, md5 = "ab", category = "NewsClip" },
]

[priority]
LiveMusic = 3
NewsClip = 0.5

[label_priority]
Dance = 2
"""


@pytest.fixture(scope="module")
def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        pytest.skip("needs ffmpeg")
    return path


def lavfi(ffmpeg: str, graph: str, path: Path, seconds: float = 1) -> Path:
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", graph, "-t", str(seconds),
                    "-c:v", "ffv1", str(path)], check=True)  # fmt: skip
    return path


def frame_count(ffmpeg: str, path: Path) -> int:
    out = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(path), "-f", "framemd5", "-"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return sum(1 for line in out.splitlines() if line and not line.startswith("#"))


def test_a_dataset_file_gives_items_their_metadata_and_priority(tmp_path: Path) -> None:
    path = tmp_path / "set.toml"
    path.write_text(
        DATASET.replace("SIZE", "10").replace("URL", "http://x/a.mp4").replace("SHA", "ab"),
        encoding="utf-8",
    )
    dataset = load_dataset(path)
    item = dataset.items["live-1"]
    assert (item.ref, item.category, item.meta) == (
        "set:live-1",
        "LiveMusic",
        {"mos": 3.5, "labels": ["Concert"]},
    )
    weights = [dataset.weight(dataset.items[name]) for name in ("live-1", "dance-news", "news")]
    assert weights == [3, 2, 0.5]
    path.write_text(
        DATASET.replace(', sha256 = "SHA"', "").replace("SIZE", "10").replace("URL", "u"),
        encoding="utf-8",
    )
    with pytest.raises(DatasetError, match="md5 or sha256"):
        load_dataset(path)


@pytest.mark.parametrize("algorithm", ["sha256", "md5"])
def test_fetch_checks_the_hash_and_resumes_a_broken_download(
    tmp_path: Path,
    algorithm: str,
) -> None:
    served = tmp_path / "served"
    served.mkdir()
    data = bytes(range(256)) * 400
    (served / "clip.mp4").write_bytes(data)
    digest = {algorithm: hashlib.new(algorithm, data).hexdigest()}
    with RangeHTTPServer(served) as server:
        item = Item("set", "clip", server.url("clip.mp4"), len(data), **digest)
        part = tmp_path / "cache" / "datasets" / "set" / "clip.mp4.part"
        part.parent.mkdir(parents=True)
        part.write_bytes(data[:1000])
        path = fetch(item, tmp_path / "cache")
        assert path.read_bytes() == data
        assert server.served[0].start == 1000
        assert fetch(item, tmp_path / "cache") == path
        assert len(server.served) == 1
        wrong = Item("set", "other", server.url("clip.mp4"), len(data), **{algorithm: "0" * 32})
        with pytest.raises(DatasetError, match="does not match"):
            fetch(wrong, tmp_path / "wrong")
        assert not list((tmp_path / "wrong").rglob("*.mp4*"))


@pytest.mark.parametrize(
    ("url", "name"),
    [
        ("https://h/v.mp4", "clip.mp4"),
        ("https://h/v.webm?x=1", "clip.webm"),
        ("https://h/C:%5cx.mp4", "clip.mp4"),
        ("https://h/C:x.mp4", "clip.mp4"),
        ("https://h/a/..", "clip"),
        ("https://h/", "clip"),
        ("https://h/a/CON", "clip"),
        ("https://h/a.b/c", "clip"),
        ("https://h/v.mp4%00", "clip"),
        ("https://h/v.toolongsuffix", "clip"),
    ],
)
def test_a_cached_item_is_named_by_its_id_whatever_its_url(
    tmp_path: Path,
    url: str,
    name: str,
) -> None:
    item = Item("set", "clip", url, 1, md5="ab")
    assert cached_path(item, tmp_path) == tmp_path / "datasets" / "set" / name


@pytest.mark.parametrize(
    ("dataset", "item_id"),
    [
        ("set", "../x"),
        ("..", "x"),
        ("set", "a/../../x"),
        ("set", "/x"),
        pytest.param(
            "set", "OTHER_DRIVE:x", marks=pytest.mark.skipif(os.name != "nt", reason="drives")
        ),
    ],
)
def test_a_cached_path_outside_its_dataset_folder_is_refused(
    tmp_path: Path,
    dataset: str,
    item_id: str,
) -> None:
    # A drive-relative name escapes only on another drive
    other = "Q:" if tmp_path.drive.upper() != "Q:" else "R:"
    item = Item(dataset, item_id.replace("OTHER_DRIVE:", other), "https://h/v.mp4", 1, md5="ab")
    with pytest.raises(DatasetError, match="outside"):
        cached_path(item, tmp_path / "cache")


def write_items(path: Path, *ids: str) -> Path:
    rows = ",\n".join(f'  {{ id = "{i}", url = "u", size = 1, md5 = "ab" }}' for i in ids)
    path.write_text(f"items = [\n{rows}\n]\n", encoding="utf-8")
    return path


@pytest.mark.parametrize(
    "item_id",
    ["CON", "nul", "NUL.txt", "Com1", "lpt9.mp4", "aux", ".", "..", "", "a/b", "a\\b", "C:x", "a b",
     "x."],
)  # fmt: skip
def test_a_dataset_with_an_unsafe_item_id_is_refused(tmp_path: Path, item_id: str) -> None:
    with pytest.raises(DatasetError, match="item id"):
        load_dataset(write_items(tmp_path / "set.toml", "fine", item_id.replace("\\", "\\\\")))


def test_a_dataset_with_a_repeated_item_id_or_an_unsafe_name_is_refused(tmp_path: Path) -> None:
    with pytest.raises(DatasetError, match="twice"):
        load_dataset(write_items(tmp_path / "set.toml", "a", "b", "a"))
    with pytest.raises(DatasetError, match="dataset name"):
        load_dataset(write_items(tmp_path / "my set.toml", "a"))
    assert list(load_dataset(write_items(tmp_path / "set.v2.toml", "a-1", "b_2.x")).items) == [
        "a-1",
        "b_2.x",
    ]


@pytest.mark.parametrize(("legacy", "requests"), [(b"good", 0), (b"bad!", 1)])
def test_a_file_cached_under_its_url_name_is_renamed_to_its_id_if_it_matches(
    tmp_path: Path,
    legacy: bytes,
    requests: int,
) -> None:
    served = tmp_path / "served"
    served.mkdir()
    (served / "v.mp4").write_bytes(b"good")
    with RangeHTTPServer(served) as server:
        item = Item("set", "clip", server.url("v.mp4"), 4, md5=hashlib.md5(b"good").hexdigest())
        old = tmp_path / "cache" / "datasets" / "set" / "v.mp4"
        old.parent.mkdir(parents=True)
        old.write_bytes(legacy)
        path = fetch(item, tmp_path / "cache")
        assert (path.name, path.read_bytes(), len(server.served)) == ("clip.mp4", b"good", requests)
        assert old.exists() == (legacy != b"good")


def test_a_cached_item_of_the_wrong_size_is_downloaded_again(tmp_path: Path) -> None:
    served = tmp_path / "served"
    served.mkdir()
    (served / "v.mp4").write_bytes(b"whole")
    with RangeHTTPServer(served) as server:
        item = Item("set", "clip", server.url("v.mp4"), 5, md5=hashlib.md5(b"whole").hexdigest())
        cut_short = tmp_path / "cache" / "datasets" / "set" / "clip.mp4"
        cut_short.parent.mkdir(parents=True)
        cut_short.write_bytes(b"who")
        assert fetch(item, tmp_path / "cache").read_bytes() == b"whole"
        assert len(server.served) == 1


def test_a_case_is_built_again_when_its_synthetic_source_changes(
    ffmpeg: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = Case("tiny-case", "synthetic:tiny", 0, 0.5)
    monkeypatch.setitem(CLIPS, "tiny", SyntheticClip("tiny", "testsrc2=size=64x36:rate=10", "x264"))
    first = build(case, {}, ffmpeg, tmp_path)
    monkeypatch.setitem(CLIPS, "tiny", SyntheticClip("tiny", "testsrc2=size=64x36:rate=12", "x264"))
    assert build(case, {}, ffmpeg, tmp_path) != first


def test_a_case_is_built_again_when_its_file_source_changes(ffmpeg: str, tmp_path: Path) -> None:
    source = lavfi(ffmpeg, "testsrc2=s=64x36:r=10", tmp_path / "source.mkv")
    case = Case("file-case", f"file:{source}", 0, 0.5)
    first = build(case, {}, ffmpeg, tmp_path / "cache")
    lavfi(ffmpeg, "color=c=red:s=64x36:r=10", source)
    assert build(case, {}, ffmpeg, tmp_path / "cache") != first


@pytest.mark.parametrize("name", ["CON", "nul.txt", "../x", "a/b", "", "x."])
def test_a_case_with_an_unsafe_name_is_refused(name: str) -> None:
    with pytest.raises(CaseError, match="name"):
        Case(name, "file:x", 0, 2).check()


@pytest.mark.parametrize(
    "transforms",
    [
        ({"encode": "libx264"}, {"filter": "hflip"}),
        ({"filter": "hflip"}, {"splice": "file:x", "at": 0.5}),
        ({"encode": "libx264"}, {"encode": "libx264"}),
        ({"filter": "hflip", "encode": "libx264"},),
        ({"splice": "file:x", "at": 3},),
    ],
    ids=[
        "encode before a filter",
        "splice after a filter",
        "two encodes",
        "two kinds in one",
        "splice past the end",
    ],
)
def test_a_case_with_transforms_out_of_order_is_refused(transforms: tuple) -> None:
    with pytest.raises(CaseError):
        Case("bad", "file:x", 0, 2, transforms).check()


def test_a_case_builds_once_per_recipe(ffmpeg: str, tmp_path: Path) -> None:
    first = lavfi(ffmpeg, "testsrc2=s=160x90:r=10", tmp_path / "first.mkv", 2)
    # Another size and rate: spliced sources are fitted to the first
    second = lavfi(ffmpeg, "color=c=red:s=200x100:r=25", tmp_path / "second.mkv", 2)
    case = Case("cut", f"file:{first}", 0.5, 1.2, (
        {"splice": f"file:{second}", "at": 0.6},
        {"filter": "eq=brightness=-0.1"},
        {"encode": "libx264", "args": ["-crf", "30"]},
    ))  # fmt: skip
    case.check()
    built = build(case, {}, ffmpeg, tmp_path / "cache")
    assert built.suffix == ".mp4"
    assert frame_count(ffmpeg, built) == 12
    stamp = built.stat().st_mtime_ns
    assert build(case, {}, ffmpeg, tmp_path / "cache").stat().st_mtime_ns == stamp
    vod = {
        "encode": "libvpx-vp9",
        "kbps": 200,
        "passes": 2,
        "args": ["-deadline", "good", "-cpu-used", "5"],
    }
    two_pass = build(
        Case("vod", case.source, case.start, case.seconds, (vod,)),
        {},
        ffmpeg,
        tmp_path / "cache",
    )
    assert (two_pass.suffix, frame_count(ffmpeg, two_pass)) == (".webm", 12)
    assert not list(two_pass.parent.glob("*.log"))
    changed = Case(
        "cut",
        case.source,
        case.start,
        case.seconds,
        (*case.transforms[:1], {"filter": "hflip"}),
    )
    assert build(changed, {}, ffmpeg, tmp_path / "cache") != built


def test_a_derivative_of_a_no_derivatives_source_is_flagged(tmp_path: Path) -> None:
    path = tmp_path / "set.toml"
    path.write_text(DATASET.replace("SIZE", "1").replace("URL", "u").replace("SHA", "ab").replace(
        'category = "LiveMusic"', 'category = "LiveMusic", license = "CC BY-NC-ND 4.0"'), encoding="utf-8")  # fmt: skip
    datasets = {"set": load_dataset(path)}
    assert flagged_licenses(Case("c", "set:live-1", 0, 1), datasets) == [
        "set:live-1 (CC BY-NC-ND 4.0)",
    ]
    assert flagged_licenses(Case("c", "file:x", 0, 1), datasets) == []


def test_the_survey_reads_each_clip_once_and_measures_both_families(
    ffmpeg: str,
    tmp_path: Path,
) -> None:
    moving = lavfi(ffmpeg, "testsrc2=s=320x180:r=10", tmp_path / "moving.mkv")
    dark = lavfi(ffmpeg, "color=c=0x101010:s=320x180:r=10", tmp_path / "dark.mkv")
    read = read_frames(ffmpeg, str(moving), 1)
    assert (read.frames.shape, read.fps) == ((10, 270, 480), 10)
    out, steps = tmp_path / "survey.jsonl", Steps()
    sources = [Source("moving", str(moving), "a"), Source("dark", str(dark), "b", {"mos": 4})]
    assert survey(ffmpeg, sources, out, ["encoding", "stabilization"], 1, 2, steps) == 2
    rows = {row["ref"]: row for row in map(json.loads, out.read_text().splitlines())}
    assert rows["moving"]["traits"]["ti"] > 1
    assert rows["dark"]["traits"]["ti"] == 0
    assert rows["dark"]["traits"]["dark_flat"] > 0.99
    assert rows["moving"]["traits"]["dark_flat"] < 0.5
    assert "grain" in rows["moving"]["traits"]
    assert rows["dark"]["meta"] == {"mos": 4}
    assert survey(ffmpeg, sources, out, ["encoding", "stabilization"], 1, 2, steps) == 0
    assert set(steps.seconds) == {"decode", "encoding", "stabilization"}


def test_levels_are_none_some_lots_for_traits_often_zero_and_thirds_otherwise() -> None:
    target = [{"cuts": c, "motion": m} for c, m in [(0, 1), (0, 2), (0, 3), (1, 4), (5, 5), (9, 6)]]
    level = levelers(target, ["cuts", "motion"])
    assert [levels_of(t, level)["cuts"] for t in target] == [
        "none",
        "none",
        "none",
        "some",
        "some",
        "lots",
    ]
    assert [levels_of(t, level)["motion"] for t in target] == [
        "low",
        "low",
        "mid",
        "mid",
        "high",
        "high",
    ]


def clip(ref: str, group: str, value: float, priority: float = 1.0) -> Clip:
    return Clip(ref, group, {"a": value, "b": value}, priority)


def test_pick_covers_the_target_once_per_source_favoring_higher_priority() -> None:
    # Low, mid and high, two target clips each
    target = [clip(f"t{v}", f"t{v}", v) for v in (1, 2, 5, 6, 9, 10)]
    coverage = Coverage.of(target, ["a", "b"])
    candidates = [
        clip("gaming", "g", 9.5, 0.5),
        clip("concert", "c", 9.5, 3),
        clip("concert-again", "c", 1.5, 3),
        clip("vr", "v", 5.5, 0),
        clip("vlog", "l", 5.5, 2),
        clip("news", "n", 1.5),
    ]
    picks = pick(coverage, candidates, [], 6)
    assert [(ref, round(pairs, 2)) for ref, pairs, _ in picks] == [
        ("concert", 0.33),
        ("vlog", 0.67),
        ("news", 1.0),
    ]
    distances = [distance for *_, distance in picks]
    assert distances == sorted(distances, reverse=True)
    # A clip already kept counts: the low clips are covered, so only the mid ones are left
    assert [
        ref
        for ref, *_ in pick(
            coverage,
            candidates,
            [clip("kept", "k", 1.5), clip("kept-2", "k2", 9.5)],
            6,
        )
    ][:1] == ["vlog"]


def test_the_step_report_names_the_slowest_first() -> None:
    steps = Steps()
    steps.seconds.update({"decode": 0.5, "fetch": 2.0})
    steps.counts.update({"decode": 3, "fetch": 1})
    assert steps.report() == "time by step: fetch 2.0 s (1x); decode 0.5 s (3x)"
    assert Steps().report() == "no timed steps"
