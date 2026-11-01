"""Test media: fetch open datasets, build distilled test cases from them, survey clips' traits, and
pick clips by how much of the real footage's traits they cover.

    uv run python tools/media/media.py list
    uv run python tools/media/media.py fetch ugc:LiveMusic_1080P-14af
    uv run python tools/media/media.py build [CASE ...]
    uv run python tools/media/media.py survey OUT.jsonl SOURCE ... [--per-category N] [--label concert]
    uv run python tools/media/media.py stats SURVEY.jsonl
    uv run python tools/media/media.py pick TARGET.jsonl CANDIDATES.jsonl [--have HAVE.jsonl] [--count 8]

A SOURCE is a dataset (all its items, or N per category with --per-category), DATASET:ITEM, `cases`
(every built case), or a clip or folder of clips. Datasets are in datasets/, cases in cases/. Every
command ends with its time by step.
"""

import argparse
import json
import math
import shutil
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "src"))

from media_cases import build, flagged_licenses, load_cases  # noqa: E402
from media_coverage import Clip, Coverage, pick  # noqa: E402
from media_datasets import CACHE, Dataset, cached_path, fetch, load_datasets  # noqa: E402
from media_steps import Steps  # noqa: E402
from media_survey import Source, survey  # noqa: E402

VIDEO_SUFFIXES = {".mp4", ".mkv", ".webm", ".mov"}


def ffmpeg_path() -> str:
    return shutil.which("ffmpeg") or "ffmpeg"


def dataset_sources(dataset: Dataset, per_category: int | None, label: str | None) -> list[Source]:
    """The dataset's items, optionally only those with a label, and N per category scaled by the
    category's priority (in id order, so a sample is repeatable)."""
    items = sorted(dataset.items.values(), key=lambda item: item.id)
    if label:
        items = [
            i
            for i in items
            if any(label.lower() in str(name).lower() for name in i.meta.get("labels", []))
        ]
    if per_category is not None:
        taken: Counter = Counter()
        kept = []
        for item in items:
            if taken[item.category] < round(per_category * dataset.weight(item)):
                taken[item.category] += 1
                kept.append(item)
        items = kept
    sources = []
    for item in items:
        local = cached_path(item)
        meta = {
            "category": item.category,
            "license": item.license,
            "priority": dataset.weight(item),
            **item.meta,
        }
        sources.append(Source(item.ref, str(local) if local.exists() else item.url, item.ref, meta))
    return sources


def resolve_sources(
    args: argparse.Namespace,
    datasets: dict[str, Dataset],
    steps: Steps,
) -> list[Source]:
    sources = []
    for spec in args.sources:
        name, _, item = spec.partition(":")
        if name in datasets and not item:
            sources += dataset_sources(datasets[name], args.per_category, args.label)
        elif name in datasets:
            sources += [s for s in dataset_sources(datasets[name], None, None) if s.ref == spec]
        elif spec == "cases":
            for case in load_cases().values():
                with steps.step("build"):
                    path = build(case, datasets, ffmpeg_path())
                sources.append(
                    Source(f"case:{case.name}", str(path), case.source, {"note": case.note}),
                )
        else:
            path = Path(spec)
            clips = (
                sorted(p for p in path.rglob("*") if p.suffix in VIDEO_SUFFIXES)
                if path.is_dir()
                else [path]
            )
            sources += [Source(str(clip), str(clip), clip.stem, {}) for clip in clips]
    return sources


def read_rows(path: Path) -> list[dict]:
    """A survey's measured rows (failed sources have no traits)."""
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    return [row for row in rows if row.get("traits")]


def command_list(datasets: dict[str, Dataset]) -> None:
    for dataset in datasets.values():
        categories = Counter(item.category for item in dataset.items.values())
        size = sum(item.size for item in dataset.items.values()) / 1e9
        print(
            f"{dataset.name}: {dataset.title}, {len(dataset.items)} items, {size:.1f} GB, {dataset.license}",
        )
        print(
            "  "
            + ", ".join(
                f"{c} {n} (x{dataset.priority.get(c, 1):g})" for c, n in sorted(categories.items())
            ),
        )
    for case in load_cases().values():
        flags = flagged_licenses(case, datasets)
        print(
            f"case {case.name}: {case.source}, {case.seconds} s{'  license: ' + ', '.join(flags) if flags else ''}",
        )


def command_stats(rows: list[dict]) -> None:
    """Each trait's spread, and what the datasets say about the clips: category, quality, labels."""
    traits = defaultdict(list)
    for row in rows:
        for trait, value in row["traits"].items():
            if isinstance(value, (int, float)) and not math.isnan(value):
                traits[trait].append(value)
    print(f"{len(rows)} clips")
    for trait, values in sorted(traits.items()):
        cut = statistics.quantiles(values, n=10) if len(values) > 1 else values * 9
        print(
            f"  {trait:20} p10 {cut[0]:8.3f}  median {statistics.median(values):8.3f}  p90 {cut[-1]:8.3f}",
        )
    metas = [row.get("meta", {}) for row in rows]
    if categories := Counter(m["category"] for m in metas if m.get("category")):
        print("categories: " + ", ".join(f"{c} {n}" for c, n in categories.most_common()))
    if scores := [m["mos"] for m in metas if isinstance(m.get("mos"), (int, float))]:
        print(
            f"MOS (1 to 5): median {statistics.median(scores):.2f}, lowest {min(scores):.2f}, highest {max(scores):.2f}",
        )
    if labels := Counter(label for m in metas for label in m.get("labels", [])):
        print("labels: " + ", ".join(f"{label} {n}" for label, n in labels.most_common(25)))


def command_pick(args: argparse.Namespace) -> None:
    target, candidates = clips(read_rows(args.target)), clips(read_rows(args.candidates))
    have = clips(read_rows(args.have)) if args.have else []
    traits = sorted(
        set().union(*(c.traits for c in target)) & set().union(*(c.traits for c in candidates)),
    )
    coverage = Coverage.of(target, traits)
    pair_share, distance = coverage.score(have)
    print(f"traits: {', '.join(traits)}")
    shown = "-" if math.isnan(distance) else f"{distance:.3f}"
    print(
        f"before: pairs {pair_share:.0%} of {len(target)} target clips' level pairs, mean distance {shown}",
    )
    for ref, pair_share, distance in pick(coverage, candidates, have, args.count):
        print(f"  + {ref}  -> pairs {pair_share:.0%}, mean distance {distance:.3f}")


def clips(rows: list[dict]) -> list[Clip]:
    return [
        Clip(
            r["ref"],
            r.get("group", r["ref"]),
            r["traits"],
            r.get("meta", {}).get("priority", 1.0),
        )
        for r in rows
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="datasets, their categories, and cases")
    fetch_parser = sub.add_parser("fetch", help="download dataset items into the cache")
    fetch_parser.add_argument("refs", nargs="+", help="DATASET:ITEM")
    build_parser = sub.add_parser("build", help="build cases (all by default)")
    build_parser.add_argument("cases", nargs="*")
    survey_parser = sub.add_parser("survey", help="measure clips' traits into a JSON lines file")
    survey_parser.add_argument("out", type=Path)
    survey_parser.add_argument("sources", nargs="+")
    survey_parser.add_argument("--families", default="encoding,stabilization")
    survey_parser.add_argument("--seconds", type=float, default=5)
    survey_parser.add_argument(
        "--per-category",
        type=int,
        help="N items per category, times its priority",
    )
    survey_parser.add_argument("--label", help="only items with a content label containing this")
    survey_parser.add_argument("--workers", type=int, default=4)
    stats_parser = sub.add_parser("stats", help="summarize a survey")
    stats_parser.add_argument("survey", type=Path)
    pick_parser = sub.add_parser(
        "pick",
        help="the candidates that cover the most of a target's trait pairs",
    )
    pick_parser.add_argument("target", type=Path, help="survey of the real footage")
    pick_parser.add_argument("candidates", type=Path)
    pick_parser.add_argument("--have", type=Path, help="survey of the cases already kept")
    pick_parser.add_argument("--count", type=int, default=8)
    args = parser.parse_args()

    steps, start = Steps(), time.perf_counter()
    datasets = load_datasets()
    if args.command == "list":
        command_list(datasets)
    elif args.command == "fetch":
        for ref in args.refs:
            name, _, item = ref.partition(":")
            with steps.step("fetch"):
                print(fetch(datasets[name].items[item], CACHE))
    elif args.command == "build":
        cases = load_cases()
        for name in args.cases or list(cases):
            with steps.step("build"):
                print(build(cases[name], datasets, ffmpeg_path()))
    elif args.command == "survey":
        sources = resolve_sources(args, datasets, steps)
        families = args.families.split(",")
        measured = survey(
            ffmpeg_path(),
            sources,
            args.out,
            families,
            args.seconds,
            args.workers,
            steps,
        )
        print(f"measured {measured} of {len(sources)} sources")
    elif args.command == "stats":
        command_stats(read_rows(args.survey))
    elif args.command == "pick":
        command_pick(args)
    print(f"{steps.report()}; total {time.perf_counter() - start:.1f} s", file=sys.stderr)


if __name__ == "__main__":
    main()
