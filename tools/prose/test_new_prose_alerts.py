import pytest
from new_prose_alerts import added_lines

DIFF = """diff --git a/readme.md b/readme.md
--- a/readme.md
+++ b/readme.md
@@ -10,0 +11,2 @@ intro
+a new line
+another
@@ -40 +42 @@ section
-old
+changed
@@ -50,3 +52,0 @@ gone
-removed
-removed
-removed
diff --git a/old.md b/old.md
--- a/old.md
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-gone
"""


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        pytest.param("readme.md", {11, 12, 42}, id="added and changed lines, not removed ones"),
        pytest.param("old.md", None, id="a deleted file has no added lines"),
    ],
)
def test_added_lines_are_the_new_versions_line_numbers(
    path: str, expected: set[int] | None
) -> None:
    assert added_lines(DIFF).get(path) == expected
