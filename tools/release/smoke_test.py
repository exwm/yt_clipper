"""Smoke test an assembled clipper release folder before it is zipped.

    uv run python tools/release/smoke_test.py artifact/py/yt_clipper_win_5.48.0 [5.48.0]

Runs the frozen clipper the way users do, from the release folder, so the bin/ layout is checked
too: the bundled tools run, the clipper makes real clips from the end-to-end test's local video
(offline, nothing is downloaded), and it rejects an invalid markers JSON. The clips are removed
again, so the folder can be zipped afterwards.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "src"))

from clipper.video2x import RIFE_MODEL  # noqa: E402

TEST_VIDEO = REPO / "src/clipper/tests/testdata/test-with-dynamic.mp4"
TEST_MARKERS = REPO / "src/clipper/tests/testdata/test-with-dynamic.json"
VALID_MARKERS = REPO / "src/schema/examples/kitchen-sink.json"
EXE = ".exe" if sys.platform == "win32" else ""
YTDL = {"win32": "yt-dlp.exe", "darwin": "yt-dlp_macos"}.get(sys.platform, "yt-dlp")
# Without it a frozen release updates its bundled yt-dlp first, over the network.
OFFLINE_ARGS = ["--no-ytdl-auto-update", "--overwrite"]


@dataclass(frozen=True)
class ClipCase:
    name: str
    args: list[str]
    codec: str
    # The ffmpeg encoder the case needs. A build without it skips the case.
    encoder: str


CLIP_CASES = (
    ClipCase("vp9", [], "vp9", "libvpx-vp9"),
    ClipCase("av1", ["--video-codec", "av1"], "av1", "libsvtav1"),
)


class SmokeTest:
    def __init__(self, release: Path) -> None:
        self.release = release
        self.clipper = release / f"yt_clipper{EXE}"
        self.ffmpeg = release / "bin/video-tools" / f"ffmpeg{EXE}"
        self.ffprobe = release / "bin/video-tools" / f"ffprobe{EXE}"
        self.failures: list[str] = []

    def check(self, ok: bool, message: str) -> bool:
        print(f"{'ok  ' if ok else 'FAIL'} {message}")
        if not ok:
            self.failures.append(message)
        return ok

    def run(self, *args: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(arg) for arg in args],
            cwd=self.release,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def bundledTools(self) -> list[tuple[Path, str]]:
        tools = [
            (self.ffmpeg, "-version"),
            (self.ffprobe, "-version"),
            (self.release / "bin/yt-dlp" / YTDL, "--version"),
            (self.release / "bin/yt-dlp" / f"deno{EXE}", "--version"),
        ]
        if sys.platform == "win32":
            tools.append((self.release / "bin/video-tools" / f"video2x{EXE}", "--version"))
        return tools

    def checkLayout(self) -> None:
        print("bin layout:")
        for path in sorted((self.release / "bin").rglob("*")):
            relative = path.relative_to(self.release)
            if "models" not in relative.parts[:-1]:
                print(f"     {relative.as_posix()}")
        for path in [self.clipper, *(tool for tool, _flag in self.bundledTools())]:
            self.check(path.is_file(), f"{path.relative_to(self.release).as_posix()} exists")
        if sys.platform == "win32":
            # video2x shares the ffmpeg DLLs, so the release must hold one copy.
            copies = list(self.release.rglob("avcodec-*.dll"))
            self.check(len(copies) == 1, f"one copy of the ffmpeg DLLs ({len(copies)} found)")
            model = self.release / "bin/video-tools/models/rife" / RIFE_MODEL / "flownet.bin"
            self.check(model.is_file(), f"video2x has the clipper's model {RIFE_MODEL}")

    def checkVersions(self, expectedVersion: str | None) -> None:
        for args in (["--version"], ["--print-versions"]):
            result = self.run(self.clipper, *args)
            output = (result.stdout + result.stderr).strip()
            print(f"     {output}".replace("\n", "\n     "))
            ok = result.returncode == 0 and "unknown" not in output
            if expectedVersion:
                ok = ok and expectedVersion in output
            self.check(ok, f"yt_clipper {' '.join(args)}")
        for tool, flag in self.bundledTools():
            result = self.run(tool, flag)
            firstLine = (result.stdout + result.stderr).strip().splitlines()[:1]
            self.check(result.returncode == 0, f"{tool.name} {flag}: {''.join(firstLine)}")

    def checkClips(self, workDir: Path) -> None:
        encoders = self.run(self.ffmpeg, "-hide_banner", "-encoders").stdout
        for case in CLIP_CASES:
            if case.encoder not in encoders:
                print(f"skip {case.name} clip: this ffmpeg build has no {case.encoder}")
                continue
            # The clipper names the output folder after the markers JSON file.
            markers = workDir / f"smoke-{case.name}.json"
            shutil.copyfile(TEST_MARKERS, markers)
            output = self.release / "webms" / markers.stem
            try:
                self.checkClip(case, markers, output)
            finally:
                shutil.rmtree(output, ignore_errors=True)

    def checkClip(self, case: ClipCase, markers: Path, output: Path) -> None:
        args = ["--markers-json", markers, "--input-video", TEST_VIDEO, *OFFLINE_ARGS, *case.args]
        result = self.run(self.clipper, *args)
        if not self.check(result.returncode == 0, f"{case.name} clip run exits 0"):
            print(result.stdout[-3000:], result.stderr[-3000:])
            return
        clips = [path for path in output.glob("*") if path.suffix in {".webm", ".mp4"}]
        if not self.check(len(clips) == 1, f"{case.name} clip written ({len(clips)} found)"):
            return
        probe = self.run(
            self.ffprobe, "-v", "error", "-select_streams", "v:0", "-count_packets",
            "-show_entries", "stream=codec_name,nb_read_packets", "-of", "json", clips[0],
        )  # fmt: skip
        streams = json.loads(probe.stdout or "{}").get("streams") or [{}]
        codec, frames = streams[0].get("codec_name"), int(streams[0].get("nb_read_packets", 0))
        self.check(
            codec == case.codec and frames > 0,
            f"{case.name} clip is {codec}, {frames} frames",
        )
        log = output / f"{markers.stem}.log"
        problems = re.findall(
            r"^.*\b(?:ERROR|CRITICAL)\b.*$",
            log.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
        self.check(not problems, f"{case.name} clip log has no errors {problems[:3]}")

    def checkInvalidMarkersRejected(self, workDir: Path) -> None:
        markers = workDir / "smoke-invalid.json"
        invalid = {**json.loads(VALID_MARKERS.read_text(encoding="utf-8")), "crf": "30 -y"}
        markers.write_text(json.dumps(invalid), encoding="utf-8")
        result = self.run(self.clipper, "--markers-json", markers, *OFFLINE_ARGS)
        ok = result.returncode == 1 and "invalid settings" in result.stdout + result.stderr
        self.check(ok, "invalid markers JSON is rejected (the schema is bundled)")


def main() -> None:
    if len(sys.argv) not in {2, 3}:
        sys.exit(__doc__)
    smoke = SmokeTest(Path(sys.argv[1]).resolve())
    smoke.checkLayout()
    smoke.checkVersions(sys.argv[2] if len(sys.argv) == 3 else None)
    with tempfile.TemporaryDirectory() as workDir:
        smoke.checkClips(Path(workDir))
        smoke.checkInvalidMarkersRejected(Path(workDir))
    if smoke.failures:
        sys.exit(f"{len(smoke.failures)} smoke checks failed")
    print("all smoke checks passed")


if __name__ == "__main__":
    main()
