"""Release showcase shots, driven by showcase.toml: one case per shot of the chosen release. Not named
test_*, so `just ui-test` skips it; run it with `just ui-showcase <release>`."""

import shutil
from pathlib import Path
from typing import Any, Dict, List

import pytest
import tomllib
from harness.markup_page import MarkupPage
from harness.paths import REPO, SANDBOX
from showcase_scenarios import SCENARIOS

# Retina-density shots, so small text like the chart's point labels stays legible.
pytestmark = pytest.mark.browser_context_args(device_scale_factor=2)

CONFIG = Path(__file__).with_name("showcase.toml")
ASSETS = REPO / "assets" / "image"


def release_shots(release: str) -> List[Dict[str, Any]]:
    releases = tomllib.loads(CONFIG.read_text(encoding="utf-8"))["release"]
    if release not in releases:
        raise pytest.UsageError(
            f"no showcase for {release} in {CONFIG.name}: {', '.join(releases)}",
        )
    return releases[release]


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    if "shot" in metafunc.fixturenames:
        release = str(metafunc.config.getoption("showcase_release"))
        shots = release_shots(release)
        metafunc.parametrize("shot", shots, ids=[shot["name"] for shot in shots])


def test_showcase_shot(
    markup: MarkupPage, shot: Dict[str, Any], pytestconfig: pytest.Config,
) -> None:
    SCENARIOS[shot["scenario"]](markup)
    path = markup.shot_of(shot["name"], shot["clip"], padding=shot.get("padding", 12))

    release_dir = SANDBOX / "showcase" / str(pytestconfig.getoption("showcase_release"))
    release_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, release_dir / f"{shot['name']}.png")
    if pytestconfig.getoption("update_assets") and "asset" in shot:
        shutil.copyfile(path, ASSETS / shot["asset"])
        markup.report(f"updated {(ASSETS / shot['asset']).relative_to(REPO)}")
