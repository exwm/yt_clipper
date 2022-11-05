import pytest
from clipper import util


@pytest.mark.parametrize(
    "test_input,expected",
    [
        pytest.param("", "", id="empty string"),
        ("non-empty", "non-empty"),
        ("'squoted'", r"'\''squoted'\''"),
    ],
)
def test_escapeSingleQuotesFFmpeg(test_input: str, expected: str):
    assert expected == util.escapeSingleQuotesFFmpeg(test_input)
