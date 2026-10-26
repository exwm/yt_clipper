from pathlib import Path

import pytest

from clipper import yt_clipper
from clipper.argparser import redactSecrets


@pytest.mark.parametrize(
    ("args", "shown"),
    [
        pytest.param(
            ["--ytdl-password", "hunter2", "-o", "x"],
            ["--ytdl-password", "***", "-o", "x"],
            id="long option",
        ),
        pytest.param(["-yp", "hunter2"], ["-yp", "***"], id="short option"),
        pytest.param(["--ytdl-password=hunter2"], ["--ytdl-password=***"], id="joined with ="),
        pytest.param(["--ytdl-password"], ["--ytdl-password"], id="no value"),
        pytest.param(
            ["--ytdl-username", "me"], ["--ytdl-username", "me"], id="other options as they are"
        ),
    ],
)
def test_redact_secrets_hides_the_password_value(args: list[str], shown: list[str]) -> None:
    assert redactSecrets(args) == shown


def test_a_run_shows_neither_password_on_the_console_or_in_its_log(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    example = Path(__file__).resolve().parents[2] / "schema" / "examples" / "kitchen-sink.json"
    (tmp_path / "markers.json").write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "args.txt").write_text("--ytdl-password from-arg-file\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    # The unknown option stops the run right after it logs its arguments.
    argv = ["--markers-json", "markers.json", "--arg-files", "args.txt", "-yp", "from-cli", "--x"]
    monkeypatch.setattr("sys.argv", ["yt_clipper", *argv])
    with pytest.raises(SystemExit):
        yt_clipper.main()
    captured = capsys.readouterr()
    log = "".join(path.read_text(encoding="utf-8") for path in tmp_path.rglob("*.log"))
    shown = captured.out + captured.err + log
    assert [secret for secret in ("from-cli", "from-arg-file") if secret in shown] == []
