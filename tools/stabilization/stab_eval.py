"""Video stabilization against 5.49 on open clips: `just stab-eval [--quick] [--presets 1,3,6] [CASE ...]`.

Each clip (a `stab-*` case in tools/media/cases/stab.toml, plus any `--cases` file) is stabilized at
each preset with the clipper's own filters and between-pass step:

  analysis  the frames the repair reads, shrunk and in gray (the same for every preset)
  detect    vid.stab's text transforms, at the preset's shakiness
  off       5.49: binary transforms and vid.stab's own L1 zoom, no repair
  on        this code: the repair, the zoom budget, the transform

Every output is scored with vidstab_motions.shake, as checkStabilizedShake does: a share of the
frame's width a frame, divided by 1 + the output's zoom.

Each pass is cached under a hash of exactly what decides its output, so a run redoes only what a
change touched: the built clip, the ffmpeg version and the filter strings for every pass, and for
"on" also the code between the passes (CODE_FILES). Scores are recomputed every run from the cached
per-frame shifts, since shake() is code too.

A clip and preset fails when "on" is more than 10% shakier than 5.49, warns that stabilization made
it shakier, or vid.stab's L1 camera path stalls, unless stab-eval.toml expects that; an expectation
that no longer holds fails too, like a strict xfail. Runs go to sandbox/stab-eval (or
YTC_STAB_EVAL_CACHE), never to git.
"""

import argparse
import hashlib
import inspect
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import verboselogs

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "media"))
from media_cases import Case, build, load_cases  # noqa: E402
from media_datasets import load_datasets  # noqa: E402
from media_steps import Steps  # noqa: E402

from clipper import clip_maker, phase_correlation  # noqa: E402
from clipper import vidstab_motions as vm  # noqa: E402
from clipper.argparser import getArgParser, getVidstabPreset  # noqa: E402
from clipper.ffmpeg_filter import (  # noqa: E402
    ZOOM_BUDGET_PLACEHOLDER,
    getVideoStabilizationFilters,
    videoStabilizationGammaFixFilter,
)
from clipper.ytc_logger import NOTICE  # noqa: E402

# The clipper registers its log levels when it sets up logging, which this tool does not do
verboselogs.add_log_level(NOTICE, "NOTICE")

CONFIG = Path(__file__).with_name("stab-eval.toml")
CACHE = Path(os.environ.get("YTC_STAB_EVAL_CACHE") or REPO / "sandbox" / "stab-eval")
# The code between the passes: a change to any of these reruns every "on" pass
CODE_FILES = (vm.__file__, phase_correlation.__file__)
PRESETS = (1, 3, 6)
WORSE = 1.10
KINDS = ("worse", "warn", "stall")


@dataclass(frozen=True)
class Config:
    quick: tuple[str, ...]
    quickPresets: tuple[int, ...]
    # (case, preset) -> {kind: reason}
    expected: Mapping[tuple[str, int], Mapping[str, str]]


def parseConfig(text: str) -> Config:
    data = tomllib.loads(text)
    expected: dict[tuple[str, int], dict[str, str]] = {}
    for entry in data.get("expected", []):
        if entry.get("kind") not in KINDS or not entry.get("reason"):
            raise ValueError(
                f"an expected entry needs a kind ({', '.join(KINDS)}) and a reason: {entry}"
            )
        kinds = expected.setdefault((entry["case"], int(entry["preset"])), {})
        if entry["kind"] in kinds:
            raise ValueError(
                f"{entry['case']} at preset {entry['preset']} expects {entry['kind']} twice"
            )
        kinds[entry["kind"]] = entry["reason"]
    return Config(tuple(data.get("quick", ())), tuple(data.get("quick_presets", PRESETS)), expected)


def failures(found: Mapping[str, bool], expected: Mapping[str, str]) -> list[str]:
    """What fails: each kind found but not expected, and each expected but no longer found."""
    out = [kind for kind in KINDS if found[kind] and kind not in expected]
    out += [
        f"{kind} expected but gone ({expected[kind]})"
        for kind in KINDS
        if kind in expected and not found[kind]
    ]
    return out


def findings(on: Mapping, off: Mapping, width: int) -> dict[str, bool]:
    """Worse also needs the shakier clip warning's absolute margin: where 5.49 left almost no shake,
    the difference is noise. width: the analysis frame's, px."""
    return {
        "worse": on["shake"] is not None
        and bool(off["shake"])
        and on["shake"] > WORSE * off["shake"]
        and on["shake"] - off["shake"] > vm.SHAKE_TOLERANCE_PX / width,
        "warn": bool(on["warn"]),
        "stall": bool(on["stalled"]),
    }


def passKey(*parts: object) -> str:
    return hashlib.sha256("\x00".join(map(str, parts)).encode()).hexdigest()[:24]


def codeHash() -> str:
    digest = hashlib.sha256()
    for path in CODE_FILES:
        digest.update(Path(path).read_bytes())
    digest.update(inspect.getsource(clip_maker.prepareVidstabTransformPass).encode())
    return digest.hexdigest()[:24]


class Runner:
    def __init__(self, ffmpeg: str, steps: Steps) -> None:
        self.ffmpeg = ffmpeg
        self.steps = steps
        self.version = subprocess.run(
            [ffmpeg, "-version"], capture_output=True, text=True, check=True
        ).stdout.splitlines()[0]
        self.code = codeHash()

    def cached(self, kind: str, key: str, make: Callable[[Path], None]) -> Path:
        """The pass's folder, made once: in a temporary folder, renamed when complete, so a stopped
        run never leaves a pass that looks finished."""
        folder = CACHE / kind / key
        if (folder / "done").exists():
            return folder
        tmp = Path(tempfile.mkdtemp(prefix=f"{kind}-", dir=CACHE))
        with self.steps.step(kind):
            make(tmp)
        (tmp / "done").write_text("", encoding="utf-8")
        if folder.exists():
            shutil.rmtree(folder)
        folder.parent.mkdir(parents=True, exist_ok=True)
        tmp.replace(folder)
        return folder

    def run(self, args: list[str], cwd: Path) -> str:
        # The default log level: vid.stab's stall and final zoom lines
        return subprocess.run(
            [self.ffmpeg, "-hide_banner", "-y", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=True,
        ).stderr

    def saveAnalysis(self, nut: Path, out: Path) -> None:
        with self.steps.step("read analysis"):
            a = vm.readAnalysis(self.ffmpeg, str(nut))
        np.savez(
            out,
            brightness=[f.brightness for f in a],
            dx=[f.shift.dx if f.shift else np.nan for f in a],
            dy=[f.shift.dy if f.shift else np.nan for f in a],
            peak=[f.shift.peak if f.shift else np.nan for f in a],
            size=a[0].size,
        )

    def evaluate(self, clip: Path, preset: int) -> dict:
        parser = getArgParser()
        mps = {
            "videoStabilization": getVidstabPreset(preset),
            **{
                k: parser.get_default(k)
                for k in ("videoStabilizationMaxAngle", "videoStabilizationMaxShift")
            },
        }
        smoothing = mps["videoStabilization"]["smoothing"]
        gamma = videoStabilizationGammaFixFilter
        detectText, transformText = (
            gamma(f) for f in getVideoStabilizationFilters(mps, "t.trf", textTransforms=True)
        )
        detect549, transform549 = (
            gamma(f) for f in getVideoStabilizationFilters(mps, "b.trf", textTransforms=False)
        )
        source = ["-i", str(clip), "-an"]
        clipId = (clip.name, clip.stat().st_size, self.version)

        def toAnalysis(vf: str) -> list[str]:
            return [
                "-vf",
                f"{vf},{vm.analysisFilter()}",
                "-fps_mode",
                "passthrough",
                "-c:v",
                "ffv1",
                "o.nut",
            ]

        def makeAnalysis(d: Path) -> None:
            self.run(
                [
                    *source,
                    "-vf",
                    vm.analysisFilter(),
                    "-fps_mode",
                    "passthrough",
                    "-c:v",
                    "ffv1",
                    "input.nut",
                ],
                d,
            )
            self.saveAnalysis(d / "input.nut", d / "input.npz")

        def makeDetect(d: Path) -> None:
            self.run([*source, "-vf", detectText, "-f", "null", "-"], d)

        def makeOff(d: Path) -> None:
            self.run([*source, "-vf", detect549, "-f", "null", "-"], d)
            info = passInfo(self.run([*source, *toAnalysis(transform549)], d))
            self.saveAnalysis(d / "o.nut", d / "out.npz")
            for name in ("o.nut", "b.trf"):
                (d / name).unlink()
            (d / "info.json").write_text(json.dumps({**info, "zoom": 15.0}), encoding="utf-8")

        analysis = self.cached("analysis", passKey(*clipId, vm.analysisFilter()), makeAnalysis)
        detect = self.cached("detect", passKey(*clipId, detectText), makeDetect)
        off = self.cached("off", passKey(*clipId, detect549, transform549), makeOff)

        def makeOn(d: Path) -> None:
            shutil.copy(detect / "t.trf", d / "t.trf")
            # The repair deletes the analysis output it reads
            shutil.copy(analysis / "input.nut", d / "a.nut")

            def stalls(zoom: str) -> bool:
                with self.steps.step("stall trial"):
                    graph = transformText.replace(ZOOM_BUDGET_PLACEHOLDER, zoom)
                    return vm.transformStalls(
                        [self.ffmpeg, "-hide_banner", *source, "-vf", graph], str(d)
                    )

            with self.steps.step("repair"):
                replacements = clip_maker.prepareVidstabTransformPass(
                    self.ffmpeg, str(d / "t.trf"), str(d / "a.nut"), smoothing, (), stalls
                )
            zoom = replacements[ZOOM_BUDGET_PLACEHOLDER]
            graph = transformText.replace(ZOOM_BUDGET_PLACEHOLDER, zoom)
            info = passInfo(self.run([*source, *toAnalysis(graph)], d))
            self.saveAnalysis(d / "o.nut", d / "out.npz")
            for name in ("o.nut", "t.trf", "t.trf.shake", "a.nut"):
                (d / name).unlink(missing_ok=True)
            # vid.stab's gaussian path logs the zoom it picks as its final zoom
            budget = None if zoom == vm.GAUSSIAN_PATH else float(zoom)
            (d / "info.json").write_text(
                json.dumps({**info, "zoom": budget, "zoom_option": zoom}), encoding="utf-8"
            )

        on = self.cached(
            "on", passKey(analysis.name, detect.name, self.code, transformText, smoothing), makeOn
        )
        with self.steps.step("score"):
            return score(analysis, off, on)


def passInfo(stderr: str) -> dict:
    """vid.stab logs its final zoom only when the gaussian path ran, as the fallback for a stall"""
    zoom = re.findall(r"Final zoom: ([-\d.]+)", stderr)
    return {"stalled": "stalled" in stderr, "final_zoom": float(zoom[-1]) if zoom else None}


def loadAnalysis(path: Path) -> list[vm.FrameAnalysis]:
    z = np.load(path)
    size = (int(z["size"][0]), int(z["size"][1]))
    return [
        vm.FrameAnalysis(
            float(b),
            None if np.isnan(dx) else phase_correlation.FrameShift(float(dx), float(dy), float(p)),
            size,
        )
        for b, dx, dy, p in zip(z["brightness"], z["dx"], z["dy"], z["peak"], strict=True)
    ]


def score(analysis: Path, off: Path, on: Path) -> dict:
    """Shake as checkStabilizedShake measures it, for the input and both outputs, and its warning."""
    inputFrames = loadAnalysis(analysis / "input.npz")
    width = inputFrames[0].size[0]
    measured = vm.shake(inputFrames)
    inputShake = None if measured is None else measured / width
    row: dict = {"in": inputShake, "width": width}
    for name, folder in (("off", off), ("on", on)):
        info = json.loads((folder / "info.json").read_text(encoding="utf-8"))
        frames = loadAnalysis(folder / "out.npz")
        s = vm.shake(frames)
        # A stalled run, or vid.stab's gaussian path, zooms in to vid.stab's final zoom
        zoom = info["final_zoom"] if info["final_zoom"] is not None else info["zoom"]
        shake = None if s is None else s / frames[0].size[0] / (1 + zoom / 100)
        warn = (
            None
            if shake is None or inputShake is None
            else bool(
                shake
                > inputShake + max(vm.SHAKE_TOLERANCE * inputShake, vm.SHAKE_TOLERANCE_PX / width)
            )
        )
        row[name] = {**info, "zoom_used": zoom, "shake": shake, "warn": warn}
    return row


def loadCaseFile(path: Path) -> dict[str, Case]:
    cases = {}
    for entry in tomllib.loads(path.read_text(encoding="utf-8")).get("case", []):
        case = Case(**{**entry, "transforms": tuple(entry.get("transforms", ()))})
        case.check()
        cases[case.name] = case
    return cases


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("names", nargs="*", help="only the cases whose name contains one of these")
    parser.add_argument(
        "--quick", action="store_true", help="only stab-eval.toml's quick cases and presets"
    )
    parser.add_argument("--presets", help="comma-separated presets (default 1,3,6)")
    parser.add_argument(
        "--cases",
        action="append",
        type=Path,
        default=[],
        help="another case file, e.g. local clips that are not checked in",
    )
    args = parser.parse_args()
    start = time.perf_counter()
    steps = Steps()
    config = parseConfig(CONFIG.read_text(encoding="utf-8"))
    cases = {n: c for n, c in load_cases().items() if n.startswith("stab-")}
    for path in args.cases:
        cases |= loadCaseFile(path)
    if args.quick:
        cases = {n: c for n, c in cases.items() if n in config.quick}
    if args.names:
        cases = {n: c for n, c in cases.items() if any(part in n for part in args.names)}
    presets = (
        [int(p) for p in args.presets.split(",")]
        if args.presets
        else (config.quickPresets if args.quick else PRESETS)
    )
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    CACHE.mkdir(parents=True, exist_ok=True)
    runner = Runner(ffmpeg, steps)
    datasets = load_datasets()
    rows = []
    for name, case in cases.items():
        with steps.step("build clip"):
            clip = build(case, datasets, ffmpeg)
        for preset in presets:
            row = {"case": name, "preset": preset, **runner.evaluate(clip, preset)}
            row["fail"] = failures(
                findings(row["on"], row["off"], row["width"]),
                config.expected.get((name, preset), {}),
            )
            rows.append(row)
            ratio = (
                row["on"]["shake"] / row["off"]["shake"]
                if row["on"]["shake"] and row["off"]["shake"]
                else float("nan")
            )
            print(
                f"{name[5:40]:35s} {preset} on/5.49 {ratio:5.2f} zoom {row['on']['zoom_used']:5.2f} "
                f"stall {int(row['on']['stalled'])}/{int(row['off']['stalled'])} {' '.join(row['fail'])}",
                flush=True,
            )
    run = CACHE / "runs" / time.strftime("%Y%m%d-%H%M%S")
    run.mkdir(parents=True, exist_ok=True)
    (run / "results.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8"
    )
    for preset in presets:
        found = [findings(r["on"], r["off"], r["width"]) for r in rows if r["preset"] == preset]
        print(
            f"preset {preset}: "
            + ", ".join(f"{kind} {sum(f[kind] for f in found)}" for kind in KINDS)
            + f" of {len(found)}"
        )
    failed = sum(bool(r["fail"]) for r in rows)
    print(
        f"{len(rows)} rows, {failed} failing, results in {run}; {steps.report()}; total {time.perf_counter() - start:.1f} s",
        file=sys.stderr,
    )
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
