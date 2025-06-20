import pathlib
import sys

import pytest

from clipper.yt_clipper import main

this_dir = pathlib.Path(__file__).parent.resolve()


@pytest.mark.slow
def test_get_version_info(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    with monkeypatch.context() as m:
        m.setattr(sys, "argv", ["yt_clipper.py", "--version"])
        with pytest.raises(SystemExit):
            main()
    out, err = capsys.readouterr()
    print(out, err)
    assert err == ""
    assert "yt_clipper.py v" in out


@pytest.mark.slow
def test_make_clip(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    with monkeypatch.context() as m:
        m.setattr(
            sys,
            "argv",
            [
                "yt_clipper.py",
                "--markers-json",
                f'{this_dir / "testdata" / "test-with-dynamic.json"}',
                "--overwrite",
            ],
        )
        main()
    out, err = capsys.readouterr()
    # assert no warnings from a yt-dlp extractor
    assert "WARNING: [" not in out
    # assert no errors
    assert "error" not in out
    assert "ERROR" not in out
    print(out, err)


@pytest.mark.slow
def test_make_clip_vulkan(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    with monkeypatch.context() as m:
        m.setattr(
            sys,
            "argv",
            [
                "yt_clipper.py",
                "--markers-json",
                f'{this_dir / "testdata" / "test-with-dynamic.json"}',
                "--overwrite",
                "--video-codec h264_vulkan",
            ],
        )
        main()
    out, err = capsys.readouterr()
    # assert no warnings from a yt-dlp extractor
    assert "WARNING: [" not in out
    # assert no errors
    assert "error" not in out
    assert "ERROR" not in out
    print(out, err)


@pytest.mark.slow
def test_make_clip_fast_trim(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    with monkeypatch.context() as m:
        m.setattr(
            sys,
            "argv",
            [
                "yt_clipper.py",
                "--markers-json",
                f'{this_dir / "testdata" / "test-with-dynamic.json"}',
                "--overwrite",
                "--fast-trim",
            ],
        )
        main()
    out, err = capsys.readouterr()
    # assert no warnings from a yt-dlp extractor
    assert "WARNING: [" not in out
    # assert no errors
    assert "error" not in out
    assert "ERROR" not in out
    print(out, err)


@pytest.mark.slow
def test_make_clip_with_local_input_video(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    with monkeypatch.context() as m:
        m.setattr(
            sys,
            "argv",
            [
                "yt_clipper.py",
                "--markers-json",
                f'{this_dir / "testdata" / "test-with-dynamic.json"}',
                "--input-video",
                f'{this_dir / "testdata" / "test-with-dynamic.mp4"}',
                "--overwrite",
            ],
        )
        main()
    out, err = capsys.readouterr()
    # assert no warnings from a yt-dlp extractor
    assert "WARNING: [" not in out
    # assert no errors
    assert "error" not in out
    assert "ERROR" not in out
    print(out, err)


@pytest.mark.slow
def test_make_clip_nvenc_with_local_input_video(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    with monkeypatch.context() as m:
        m.setattr(
            sys,
            "argv",
            [
                "yt_clipper.py",
                "--markers-json",
                f'{this_dir / "testdata" / "test-with-dynamic.json"}',
                "--input-video",
                f'{this_dir / "testdata" / "test-with-dynamic.mp4"}',
                "--overwrite",
                "--video-codec h264_nvenc",
            ],
        )
        main()
    out, err = capsys.readouterr()
    # assert no warnings from a yt-dlp extractor
    assert "WARNING: [" not in out
    # assert no errors
    assert "error" not in out
    assert "ERROR" not in out
    print(out, err)
