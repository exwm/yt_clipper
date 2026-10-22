import codecs

import pytest

from clipper.settings_file import decodeSettingsFile

TEXT = "--video-codec av1 # é\n"


@pytest.mark.parametrize(
    ("raw", "fallbackUsed"),
    [
        pytest.param(TEXT.encode("utf-8"), False, id="UTF-8"),
        pytest.param(codecs.BOM_UTF8 + TEXT.encode("utf-8"), False, id="UTF-8 with a byte order mark"),
        pytest.param(TEXT.encode("utf-16"), False, id="UTF-16 with its byte order mark (PowerShell 5.1)"),
        pytest.param(codecs.BOM_UTF16_BE + TEXT.encode("utf-16-be"), False, id="UTF-16 big endian"),
        pytest.param(TEXT.encode("cp1252"), True, id="the ANSI code page"),
    ],
)
def test_decode_settings_file(raw: bytes, fallbackUsed: bool) -> None:
    text, fallback = decodeSettingsFile(raw, fallbackEncoding="cp1252")
    assert text == TEXT
    assert (fallback == "cp1252") is fallbackUsed
