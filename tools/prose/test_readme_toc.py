import pytest
from readme_toc import toc_problems

TOC = """# yt_clipper

# Table of Contents

- [yt\\_clipper](#yt_clipper)
- [Table of Contents](#table-of-contents)
- [Reframe Mode (WYSIWYG Dynamic Cropping)](#reframe-mode-wysiwyg-dynamic-cropping)
  - [Tips](#tips)
  - [Tips](#tips-1)

## Reframe Mode (WYSIWYG Dynamic Cropping)

### Tips

### Tips

```
# a comment in default_args.txt, not a heading
```
"""


@pytest.mark.parametrize(
    ("markdown", "expected"),
    [
        pytest.param(TOC, [], id="punctuation, escapes, repeats and fenced comments"),
        pytest.param(
            TOC + "\n### Crop Easing\n",
            ["21: heading has no table of contents entry (#crop-easing)"],
            id="a heading with no entry",
        ),
        pytest.param(
            TOC.replace("## Reframe Mode (WYSIWYG Dynamic Cropping)", "## Reframe"),
            [
                "11: heading has no table of contents entry (#reframe)",
                "7: table of contents entry points at no heading (#reframe-mode-wysiwyg-dynamic-cropping)",
            ],
            id="a renamed heading",
        ),
    ],
)
def test_toc_problems(markdown: str, expected: list[str]) -> None:
    assert toc_problems(markdown) == expected
