import pytest

from clipper.clip_maker import containsValidCharsForVidStab


@pytest.mark.parametrize(
    ("path", "valid"),
    [
        pytest.param("./webms/a title-1/shaky/1.trf", True, id="plain"),
        pytest.param(
            "./webms/a:result=evil/shaky/1.trf", False, id="a colon, which splits the options"
        ),
        pytest.param("./webms/it's/shaky/1.trf", False, id="a quote, which ends the path"),
        pytest.param("./webms/a\\b/shaky/1.trf", False, id="a backslash, which escapes"),
        pytest.param("./webms/café/shaky/1.trf", False, id="non-ASCII"),
    ],
)
def test_a_transform_path_vidstab_cannot_read_falls_back_to_a_hashed_one(
    path: str, valid: bool
) -> None:
    assert containsValidCharsForVidStab(path) is valid
