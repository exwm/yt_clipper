"""Smoke test an assembled clipper release folder before it is zipped.

    uv run python tools/release/smoke_test.py artifact/py/yt_clipper_win_5.48.0 [5.48.0]

Runs the frozen clipper the way users do, from the release folder, so the bin/ layout is checked
too: the bundled tools run, the offline end-to-end tests pass with the built clipper (nothing is
downloaded), and it rejects an invalid markers JSON. The clips are removed again, so the folder can
be zipped afterwards.
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "src"))

from clipper.video2x import RIFE_MODEL  # noqa: E402

E2E_TESTS = REPO / "src/clipper/tests/test_e2e.py"
VALID_MARKERS = REPO / "src/schema/examples/kitchen-sink.json"
EXE = ".exe" if sys.platform == "win32" else ""
YTDL = {"win32": "yt-dlp.exe", "darwin": "yt-dlp_macos"}.get(sys.platform, "yt-dlp")
# Without it a frozen release updates its bundled yt-dlp first, over the network.
OFFLINE_ARGS = ["--no-ytdl-auto-update", "--overwrite"]


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

    def checkClips(self) -> None:
        try:
            result = subprocess.run(
                [
                    sys.executable, "-m", "pytest", E2E_TESTS, "-m", "not slow", "-ra",
                    "--clipper-exe", self.clipper,
                    # The tests that make their own media need an ffmpeg, which CI has only here.
                    "--ffmpeg-dir", str(self.ffmpeg.parent),
                ],
                cwd=REPO,
                check=False,
            )  # fmt: skip
        finally:
            # The end-to-end tests' clip folder, named after their markers JSON.
            shutil.rmtree(self.release / "webms" / "test-with-dynamic", ignore_errors=True)
        self.check(result.returncode == 0, "offline end-to-end tests pass with the built clipper")

    def checkInvalidMarkersRejected(self, workDir: Path) -> None:
        markers = workDir / "smoke-invalid.json"
        invalid = {**json.loads(VALID_MARKERS.read_text(encoding="utf-8")), "crf": "30 -y"}
        markers.write_text(json.dumps(invalid), encoding="utf-8")
        try:
            result = self.run(self.clipper, "--markers-json", markers, *OFFLINE_ARGS)
        finally:
            # The rejected run still writes its log, which would ship in the zip.
            shutil.rmtree(self.release / "webms" / markers.stem, ignore_errors=True)
        ok = result.returncode == 1 and "invalid settings" in result.stdout + result.stderr
        self.check(ok, "invalid markers JSON is rejected (the schema is bundled)")

    def outputPaths(self) -> set[Path]:
        """The clips, logs and temp files in the release, and their folders."""
        return {path for name in ("webms", "temp") for path in [self.release / name, *(self.release / name).rglob("*")]}

    def checkNoLeftovers(self, before: set[Path]) -> None:
        # CI zips the folder right after these checks. An installed release may hold clips already.
        added = sorted(self.outputPaths() - before, reverse=True)
        files = [path for path in added if path.is_file()]
        self.check(not files, "the checks leave no files in the release" + (f": {files}" if files else ""))
        for path in added:
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()


def main() -> None:
    if len(sys.argv) not in {2, 3}:
        sys.exit(__doc__)
    smoke = SmokeTest(Path(sys.argv[1]).resolve())
    outputBefore = smoke.outputPaths()
    smoke.checkLayout()
    smoke.checkVersions(sys.argv[2] if len(sys.argv) == 3 else None)
    smoke.checkClips()
    with tempfile.TemporaryDirectory() as workDir:
        smoke.checkInvalidMarkersRejected(Path(workDir))
    smoke.checkNoLeftovers(outputBefore)
    if smoke.failures:
        sys.exit(f"{len(smoke.failures)} smoke checks failed")
    print("all smoke checks passed")


if __name__ == "__main__":
    main()
