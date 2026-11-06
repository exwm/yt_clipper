"""Video stabilization against 5.49 on open clips: `just stab-eval [--quick] [--presets 1,3,6] [CASE ...]`.

Each clip (a `stab-*` case in tools/media/cases/stab.toml, plus any `--cases` file) is stabilized at
each preset with the clipper's own filters and between-pass step:

  analysis  the frames the repair reads, shrunk and in gray (the same for every preset)
  detect    vid.stab's text transforms, at the preset's shakiness
  off       5.49.0: its filters, binary transforms, vid.stab's gaussian camera path and zoom
  on        this code: the repair, the zoom budget, the transform
  nvsma     this code with -nvsma: as on, without the repair (reported, never failing a row)

Every output is scored with vidstab_motions.shake, as checkStabilizedShake does: a share of the
frame's width a frame, divided by 1 + the zoom the pass used (vidstab_motions.magnification). The
summary also reports each side's crop (that zoom) and its seconds per pass, from the run that made
the pass.

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
import contextlib
import hashlib
import inspect
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import tomllib
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from math import pi
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
        self.timing: dict[str, float] = {}
        with self.steps.step(kind):
            make(tmp)
        # The first run's times stay with the pass, so a warm run still reports them
        (tmp / "timing.json").write_text(json.dumps(self.timing), encoding="utf-8")
        (tmp / "done").write_text("", encoding="utf-8")
        if folder.exists():
            shutil.rmtree(folder)
        folder.parent.mkdir(parents=True, exist_ok=True)
        tmp.replace(folder)
        return folder

    @contextlib.contextmanager
    def timed(self, part: str) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            self.timing[part] = self.timing.get(part, 0.0) + time.perf_counter() - start

    def run(self, args: list[str], cwd: Path, part: str) -> str:
        # The default log level: vid.stab's stall and final zoom lines
        with self.timed(part):
            return subprocess.run(
                [self.ffmpeg, "-hide_banner", "-y", *args],
                cwd=cwd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
            ).stderr

    def saveAnalysis(self, nut: Path, out: Path, part: str) -> None:
        with self.steps.step("read analysis"), self.timed(part):
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
        detect549, transform549 = (gamma(f) for f in filters549(mps, "b.trf"))
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
                "analysis",
            )
            self.saveAnalysis(d / "input.nut", d / "input.npz", "read analysis")

        def makeDetect(d: Path) -> None:
            self.run([*source, "-vf", detectText, "-f", "null", "-"], d, "detect")

        def makeOff(d: Path) -> None:
            self.run([*source, "-vf", detect549, "-f", "null", "-"], d, "detect")
            info = passInfo(self.run([*source, *toAnalysis(transform549)], d, "transform"))
            self.saveAnalysis(d / "o.nut", d / "out.npz", "read output")
            for name in ("o.nut", "b.trf"):
                (d / name).unlink()
            # 5.49 passes no zoom: vid.stab's gaussian path picks one and logs it as its final zoom
            (d / "info.json").write_text(
                json.dumps({**info, "zoom": 0.0, "zoom_option": "0"}), encoding="utf-8"
            )

        analysis = self.cached("analysis", passKey(*clipId, vm.analysisFilter()), makeAnalysis)
        detect = self.cached("detect", passKey(*clipId, detectText), makeDetect)
        off = self.cached("off", passKey(*clipId, detect549, transform549), makeOff)

        def makeOn(d: Path, repair: bool = True) -> None:
            shutil.copy(detect / "t.trf", d / "t.trf")
            # The repair deletes the analysis output it reads
            shutil.copy(analysis / "input.nut", d / "a.nut")

            def stalls(zoom: str) -> bool:
                with self.steps.step("stall trial"), self.timed("trial"):
                    graph = transformText.replace(ZOOM_BUDGET_PLACEHOLDER, zoom)
                    return vm.transformStalls(
                        [self.ffmpeg, "-hide_banner", *source, "-vf", graph], str(d)
                    )

            with self.steps.step("repair"), self.timed("repair"), recordedFrames() as frames:
                replacements = clip_maker.prepareVidstabTransformPass(
                    self.ffmpeg,
                    str(d / "t.trf"),
                    str(d / "a.nut"),
                    smoothing,
                    (),
                    stalls,
                    repair=repair,
                )
            # The repair's own time, without the trials it ran
            self.timing["repair"] -= self.timing.get("trial", 0.0)
            zoom = replacements[ZOOM_BUDGET_PLACEHOLDER]
            graph = transformText.replace(ZOOM_BUDGET_PLACEHOLDER, zoom)
            info = passInfo(self.run([*source, *toAnalysis(graph)], d, "transform"))
            self.saveAnalysis(d / "o.nut", d / "out.npz", "read output")
            for name in ("o.nut", "t.trf", "t.trf.shake", "a.nut"):
                (d / name).unlink(missing_ok=True)
            # vid.stab's gaussian path logs the zoom it picks as its final zoom
            budget = None if zoom == vm.GAUSSIAN_PATH else float(zoom)
            (d / "info.json").write_text(
                json.dumps({**info, "zoom": budget, "zoom_option": zoom, **frames}),
                encoding="utf-8",
            )

        onKey = passKey(analysis.name, detect.name, self.code, transformText, smoothing)
        on = self.cached("on", onKey, makeOn)
        # -nvsma: this code without the repair, reported but never failing a row
        nvsma = self.cached("nvsma", onKey, lambda d: makeOn(d, repair=False))
        with self.steps.step("score"):
            row = score(analysis, off, on, nvsma)
        row["seconds"] = passSeconds(analysis, detect, off, on)
        return row


def filters549(mps: Mapping, transformPath: str) -> tuple[str, str]:
    """5.49.0's vidstabdetect and vidstabtransform filters, as its clip_maker wrote them (without
    dynamic zoom). Its ffmpeg 8.0.1 ran vid.stab's gaussian camera path by default; ffmpeg 9
    defaults to the L1 path, which crops a fixed 15%, so the gaussian path is asked for."""
    vidstab = mps["videoStabilization"]
    maxAngle = mps["videoStabilizationMaxAngle"]
    maxAngle = -1 if maxAngle < 0 else maxAngle * pi / 180
    maxShift = mps["videoStabilizationMaxShift"]
    maxShift = -1 if maxShift < 0 else maxShift
    return (
        f"vidstabdetect=result='{transformPath}':shakiness={vidstab['shakiness']}",
        f"vidstabtransform=input='{transformPath}':smoothing={vidstab['smoothing']}"
        f":maxangle={maxAngle}:maxshift={maxShift}:optalgo=gauss",
    )


def passSeconds(analysis: Path, detect: Path, off: Path, on: Path) -> dict[str, dict[str, float]]:
    """Each side's passes, as the clipper runs them, in seconds from the run that made them. 5.50's
    analysis frames are a second output of its detect pass in the clipper, a decode of their own here.
    Reading the analysis outputs is the repair's and the shakier clip check's work."""

    def load(folder: Path) -> dict[str, float]:
        path = folder / "timing.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    a, d, f, n = load(analysis), load(detect), load(off), load(on)
    return {
        "off": {k: f[k] for k in ("detect", "transform") if k in f},
        "on": {
            k: v
            for k, v in (
                ("detect", d.get("detect")),
                ("analysis", a.get("analysis")),
                ("repair", n.get("repair")),
                ("trial", n.get("trial", 0.0) if n else None),
                ("transform", n.get("transform")),
                ("check", n.get("read output")),
            )
            if v is not None
        },
    }


def passInfo(stderr: str) -> dict:
    """vid.stab logs a final zoom only when its gaussian path ran, the fallback for a stall"""
    return {"stalled": vm.STALL_LINE in stderr, "final_zoom": vm.finalZoom(stderr)}


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


def score(analysis: Path, off: Path, on: Path, nvsma: Path) -> dict:
    """Shake as checkStabilizedShake measures it, for the input and each output, and its warning."""
    inputFrames = loadAnalysis(analysis / "input.npz")
    width = inputFrames[0].size[0]
    measured = vm.shake(inputFrames)
    inputShake = None if measured is None else measured / width
    unmeasured = vm.unmeasuredFrames(inputFrames)
    row: dict = {"in": inputShake, "width": width}
    for name, folder in (("off", off), ("on", on), ("nvsma", nvsma)):
        info = json.loads((folder / "info.json").read_text(encoding="utf-8"))
        frames = loadAnalysis(folder / "out.npz")
        s = vm.shake(frames, unmeasured)
        zoom = vm.magnification(info.get("zoom_option") or str(info["zoom"]), info["final_zoom"])
        shake = None if s is None else s / frames[0].size[0] / (1 + zoom / 100)
        warn = (
            None
            if shake is None or inputShake is None
            else bool(
                shake
                > inputShake + max(vm.SHAKE_TOLERANCE * inputShake, vm.SHAKE_TOLERANCE_PX / width)
            )
        )
        jitter = vm.frameJitter(frames, unmeasured) / frames[0].size[0] / (1 + zoom / 100)
        row[name] = {**info, "zoom_used": zoom, "shake": shake, "warn": warn}
        row[f"{name}_jitter"] = jitter
    on = row["on"]
    for kind in ("repaired", "kept"):
        flagged = on.get(kind, [])
        row[f"jerk_{kind}"] = {
            side: localJerk(row[f"{side}_jitter"], flagged) for side in ("off", "on")
        }
    for side in ("off", "on", "nvsma"):
        del row[f"{side}_jitter"]
    return row


# A frame's neighbours that count for the local jerk at it
JERK_WINDOW = 2


def localJerk(jitter: np.ndarray, frames: Sequence[int]) -> float | None:
    """The largest per-frame jitter within JERK_WINDOW of vid.stab's frames (from 1; frame n's
    motion moves the picture of index n - 1): one jerk the clip's shake averages away. None when no
    frame there was measured."""
    near = {
        i
        for n in frames
        for i in range(n - 1 - JERK_WINDOW, n + JERK_WINDOW)
        if 0 <= i < len(jitter)
    }
    values = [jitter[i] for i in near if not np.isnan(jitter[i])]
    return float(max(values)) if values else None


def jerkWorse(jerk: Mapping[str, float | None], width: int) -> bool:
    """5.50's local jerk more than WORSE times 5.49's and past the shakier clip warning's margin."""
    on, off = jerk["on"], jerk["off"]
    return (
        on is not None
        and off is not None
        and on > WORSE * off
        and on - off > vm.SHAKE_TOLERANCE_PX / width
    )


@contextlib.contextmanager
def recordedFrames() -> Iterator[dict[str, list[int]]]:
    """The frames the repair rewrote and the frames whose subject fields it dropped, as the clipper's
    own between-pass step reports them."""
    frames: dict[str, list[int]] = {"repaired": [], "kept": []}
    repair, keep = vm.repairMotions, vm.keepFieldsMovingWithTheCamera

    def repairing(*args: object, **kwargs: object) -> list[int]:
        frames["repaired"] = repair(*args, **kwargs)
        return frames["repaired"]

    def keeping(*args: object, **kwargs: object) -> list[int]:
        frames["kept"] = keep(*args, **kwargs)
        return frames["kept"]

    vm.repairMotions, vm.keepFieldsMovingWithTheCamera = repairing, keeping
    try:
        yield frames
    finally:
        vm.repairMotions, vm.keepFieldsMovingWithTheCamera = repair, keep


def shakeRatio(row: Mapping, side: str) -> float | None:
    """The side's shake over 5.49's, None when either was not measured."""
    shake, base = row[side]["shake"], row["off"]["shake"]
    return shake / base if shake and base else None


def nvsmaLine(rows: list[dict]) -> str:
    """-nvsma against 5.49 and against 5.50: its shake ratio median and crop median."""
    ratios = [x for r in rows if (x := shakeRatio(r, "nvsma")) is not None]
    shakier = sum(x > WORSE for x in ratios)
    crop = statistics.median([r["nvsma"]["zoom_used"] for r in rows]) if rows else 0.0
    ratio = statistics.median(ratios) if ratios else float("nan")
    return (
        f"-nvsma: shake {ratio:.2f}x 5.49's (median), more than {WORSE:.2f}x in {shakier} of "
        f"{len(ratios)}; crop median {crop:.2f}%"
    )


def cropAndTime(rows: list[dict]) -> list[str]:
    """Report lines for one preset's rows: median crop of 5.49 and 5.50, the rows where 5.50 crops
    more, and median seconds per pass, over the rows whose passes recorded their times."""

    def median(values: list[float]) -> str:
        return f"{statistics.median(values):.2f}" if values else "-"

    more = [r for r in rows if r["on"]["zoom_used"] > r["off"]["zoom_used"] + 0.005]
    lines = [
        f"crop median 5.49 {median([r['off']['zoom_used'] for r in rows])}%, "
        f"5.50 {median([r['on']['zoom_used'] for r in rows])}%; 5.50 crops more in {len(more)}"
        + "".join(
            f"\n    {r['case'][5:]}: {r['off']['zoom_used']:.2f}% -> {r['on']['zoom_used']:.2f}%"
            for r in more
        )
    ]
    lines.append(nvsmaLine(rows))
    for side, label in (("off", "5.49"), ("on", "5.50")):
        parts = {part for r in rows for part in r["seconds"][side]}
        order = ("detect", "analysis", "repair", "trial", "transform", "check")
        lines.append(
            f"seconds median {label}: "
            + ", ".join(
                f"{part} {median([r['seconds'][side][part] for r in rows if part in r['seconds'][side]])}"
                for part in order
                if part in parts
            )
        )
    for kind in ("repaired", "kept"):
        jerks = [
            r
            for r in rows
            if r[f"jerk_{kind}"]["on"] is not None and r[f"jerk_{kind}"]["off"] is not None
        ]
        worse = [r for r in jerks if jerkWorse(r[f"jerk_{kind}"], r["width"])]
        total = {side: 1e4 * sum(r[f"jerk_{kind}"][side] for r in jerks) for side in ("off", "on")}
        lines.append(
            f"local jerk at {kind} frames (1e-4 of the width, summed over {len(jerks)} rows): "
            f"5.49 {total['off']:.0f}, 5.50 {total['on']:.0f}; 5.50 worse in {len(worse)}"
            + "".join(
                f"\n    {r['case'][5:]}: {1e4 * r[f'jerk_{kind}']['off']:.1f} -> {1e4 * r[f'jerk_{kind}']['on']:.1f}"
                for r in worse
            )
        )
    return lines


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
            ratio, nvsmaRatio = (shakeRatio(row, side) or float("nan") for side in ("on", "nvsma"))
            print(
                f"{name[5:40]:35s} {preset} on/5.49 {ratio:5.2f} zoom {row['on']['zoom_used']:5.2f} "
                f"nvsma/5.49 {nvsmaRatio:5.2f} "
                f"stall {int(row['on']['stalled'])}/{int(row['off']['stalled'])} {' '.join(row['fail'])}",
                flush=True,
            )
    run = CACHE / "runs" / time.strftime("%Y%m%d-%H%M%S")
    run.mkdir(parents=True, exist_ok=True)
    (run / "results.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8"
    )
    for preset in presets:
        presetRows = [r for r in rows if r["preset"] == preset]
        found = [findings(r["on"], r["off"], r["width"]) for r in presetRows]
        print(
            f"preset {preset}: "
            + ", ".join(f"{kind} {sum(f[kind] for f in found)}" for kind in KINDS)
            + f" of {len(found)}"
        )
        for line in cropAndTime(presetRows):
            print(f"  {line}")
    failed = sum(bool(r["fail"]) for r in rows)
    print(
        f"{len(rows)} rows, {failed} failing, results in {run}; {steps.report()}; total {time.perf_counter() - start:.1f} s",
        file=sys.stderr,
    )
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
