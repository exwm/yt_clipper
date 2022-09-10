import pytest

import yt_clipper


@pytest.mark.parametrize(
    "test_input,expected",
    [
        pytest.param("", "", id="empty string"),
        ("non-empty", "non-empty"),
        ("'squoted'", r"'\''squoted'\''"),
    ],
)
def test_escapeSingleQuotesFFmpeg(test_input: str, expected: str):
    assert expected == yt_clipper.escapeSingleQuotesFFmpeg(test_input)
