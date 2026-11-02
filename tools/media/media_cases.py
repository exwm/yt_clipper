"""Distilled test cases, as data: `[[case]]` tables in cases/*.toml, built into short clips.

A case names its source, where to cut it, and transforms in order:

    [[case]]
    name = "concert-dark"
    source = "ugc:LiveMusic_1080P-14af"   # DATASET:ITEM, synthetic:NAME, shaky:NAME or file:PATH
    start = 4
    seconds = 3
    transforms = [
        { splice = "ugc:LiveMusic_1080P-157b", at = 1.5, start = 2 },  # a hard cut to another source
        { filter = "eq=brightness=-0.15" },                            # any ffmpeg filters
        { encode = "libvpx-vp9", kbps = 1590, passes = 2, args = ["-deadline", "good", "-cpu-used", "2", "-row-mt", "1"] },
    ]

The last line is the YouTube-like upload that yt_clipper reads: two-pass libvpx-vp9 at 0.86 times
YouTube's VOD bitrate for the resolution (about 1850 kbps at 1080p, 1056 at 720p) matched the UGC
dataset's real VOD transcodes in VMAF on average, at their bitrate within 1%.

Splices come first, then filters, then at most one encode. Without an encode the case is lossless
(FFV1). A built case is kept under a hash of its recipe and the ffmpeg version, so a change to either
builds it again.
"""

import functools
import hashlib
import json
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path

from media_datasets import CACHE, Dataset, DatasetError, fetch, is_safe_name

from clipper.tests import shaky_media, synthetic_media

CASES = Path(__file__).with_name("cases")
KINDS = ("splice", "filter", "encode")


class CaseError(Exception):
    pass


@dataclass(frozen=True)
class Case:
    name: str
    source: str
    start: float
    seconds: float
    transforms: tuple[dict, ...] = ()
    note: str = ""

    def check(self) -> None:
        if not is_safe_name(self.name):
            raise CaseError(f"the case name {self.name!r} is not a safe file name")
        order = []
        for transform in self.transforms:
            kinds = [kind for kind in KINDS if kind in transform]
            if len(kinds) != 1:
                raise CaseError(
                    f"{self.name}: each transform is one of {', '.join(KINDS)}: {transform}",
                )
            order.append(KINDS.index(kinds[0]))
        if order != sorted(order) or order.count(KINDS.index("encode")) > 1:
            raise CaseError(
                f"{self.name}: splices come first, then filters, then at most one encode",
            )
        for splice in self.splices():
            if not 0 < splice["at"] < self.seconds:
                raise CaseError(
                    f"{self.name}: a splice's `at` is within the case's {self.seconds} s",
                )

    def splices(self) -> list[dict]:
        return [t for t in self.transforms if "splice" in t]

    def filters(self) -> list[str]:
        return [t["filter"] for t in self.transforms if "filter" in t]

    def encode(self) -> dict | None:
        return next((t for t in self.transforms if "encode" in t), None)


def load_cases(folder: Path = CASES) -> dict[str, Case]:
    cases = {}
    for path in sorted(folder.glob("*.toml")):
        for entry in tomllib.loads(path.read_text(encoding="utf-8")).get("case", []):
            case = Case(**{**entry, "transforms": tuple(entry.get("transforms", ()))})
            case.check()
            if case.name in cases:
                raise CaseError(f"{path.name}: case {case.name} is defined twice")
            cases[case.name] = case
    return cases


@functools.cache
def ffmpeg_version(ffmpeg: str) -> str:
    return subprocess.run(
        [ffmpeg, "-version"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()[0]


def source_path(ref: str, datasets: dict[str, Dataset], ffmpeg: str, cache: Path = CACHE) -> Path:
    """The local file a source reference names, fetched or made first if needed."""
    kind, _, name = ref.partition(":")
    if kind == "file":
        return Path(name)
    if kind == "synthetic":
        return synthetic_media.makeSyntheticClip(ffmpeg, name, cache / "synthetic")[0]
    if kind == "shaky":
        return shaky_media.makeShakyClip(ffmpeg, name, shaky_media.mediaFolder(ffmpeg))
    if kind in datasets and name in datasets[kind].items:
        return fetch(datasets[kind].items[name], cache)
    raise DatasetError(f"unknown source {ref}")


def frame_format(ffmpeg: str, path: Path) -> tuple[int, int, str]:
    """Width, height and frame rate of a file's first video stream."""
    probe = str(Path(ffmpeg).with_name(Path(ffmpeg).name.replace("ffmpeg", "ffprobe")))
    out = subprocess.run(
        [probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    stream = json.loads(out)["streams"][0]
    return stream["width"], stream["height"], stream["r_frame_rate"]


def recipe_key(case: Case, ffmpeg: str) -> str:
    recipe = {"case": case.__dict__, "ffmpeg": ffmpeg_version(ffmpeg)}
    return hashlib.sha256(json.dumps(recipe, sort_keys=True, default=list).encode()).hexdigest()[
        :16
    ]


def build_command(
    case: Case,
    sources: list[Path],
    size: tuple[int, int, str],
    output: Path,
) -> list[str]:
    """One ffmpeg run: each source cut, the splices joined into one timeline, then the filters and
    the encode. Spliced sources are scaled to the first source's size and frame rate."""
    width, height, rate = size
    inputs = ["-ss", str(case.start), "-t", str(case.seconds), "-i", str(sources[0])]
    for splice, path in zip(case.splices(), sources[1:], strict=True):
        inputs += [
            "-ss",
            str(splice.get("start", 0)),
            "-t",
            str(case.seconds - splice["at"]),
            "-i",
            str(path),
        ]
    same = f"scale={width}:{height},setsar=1,fps={rate},format=yuv420p"
    cuts = [0.0, *(s["at"] for s in case.splices())]
    parts = [
        f"[{i}:v]{same},trim=duration={end - begin},setpts=PTS-STARTPTS[p{i}]"
        for i, (begin, end) in enumerate(zip(cuts, [*cuts[1:], case.seconds], strict=True))
    ]
    joined = "".join(f"[p{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0"
    graph = ";".join([*parts, ",".join([joined, *case.filters()]) + "[out]"])
    encode = case.encode()
    if encode is None:
        codec = ["-c:v", "ffv1"]
    else:
        codec = [
            "-c:v",
            encode["encode"],
            *(["-b:v", f"{encode['kbps']}k"] if "kbps" in encode else []),
        ]
        codec += [str(arg) for arg in encode.get("args", [])]
    return ["-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-an",
            *codec, str(output)]  # fmt: skip


def output_suffix(case: Case) -> str:
    encode = case.encode()
    codec = encode["encode"] if encode else "ffv1"
    return (
        ".webm"
        if codec.startswith(("libvpx", "libaom"))
        else ".mp4"
        if codec.startswith(("libx26", "libsvtav1"))
        else ".mkv"
    )


def build(case: Case, datasets: dict[str, Dataset], ffmpeg: str, cache: Path = CACHE) -> Path:
    """The case's clip, built once per recipe and ffmpeg version."""
    case.check()
    output = cache / "cases" / f"{case.name}-{recipe_key(case, ffmpeg)}{output_suffix(case)}"
    if output.exists():
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    sources = [
        source_path(ref, datasets, ffmpeg, cache)
        for ref in [case.source, *(s["splice"] for s in case.splices())]
    ]
    partial = output.with_name(f"partial-{output.name}")
    command = [ffmpeg, *build_command(case, sources, frame_format(ffmpeg, sources[0]), partial)]
    encode = case.encode()
    if encode and encode.get("passes") == 2:
        # Like a platform's VOD encode: the first pass only writes the rate statistics
        log = str(partial.with_suffix(""))
        subprocess.run(
            [*command[:-1], "-pass", "1", "-passlogfile", log, "-f", "null", "-"],
            check=True,
        )
        command[-1:] = ["-pass", "2", "-passlogfile", log, str(partial)]
    subprocess.run(command, check=True)
    partial.replace(output)
    for stats in output.parent.glob(f"{partial.stem}*.log"):
        stats.unlink()
    return output


def flagged_licenses(case: Case, datasets: dict[str, Dataset]) -> list[str]:
    """The case's dataset sources whose license forbids derivatives or commercial use: a built case
    is a derivative."""
    flagged = []
    for ref in [case.source, *(s["splice"] for s in case.splices())]:
        kind, _, name = ref.partition(":")
        item = datasets[kind].items.get(name) if kind in datasets else None
        license_ = (item.license or datasets[kind].license) if item else ""
        if any(mark in license_.upper() for mark in ("-ND", "-NC", "NODERIV", "NONCOMMERCIAL")):
            flagged.append(f"{ref} ({license_})")
    return flagged
