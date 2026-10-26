import base64
import hashlib
import re
from importlib import util as importlib_util
from typing import Any, Dict, Union


def is_module_available(mod: str) -> bool:
    return importlib_util.find_spec(mod) is not None


def dictTryGetKeys(d: Dict, *keys: str, default: Any = None) -> Any:  # noqa: ANN401
    for key in keys:
        value = d.get(key)
        if value is not None:
            return value

    return default


def notifyOnComplete(titleSuffix: str) -> None:
    from notifypy import Notify

    n = Notify()
    n.application_name = "yt_clipper"
    n.title = "yt_clipper Completed Run"
    n.message = f"Processed {titleSuffix}.json."
    n.send(block=False)


def getTrimmedBase64Hash(string: str, n_bytes: int = 9) -> str:
    hash_object = hashlib.sha256(string.encode(encoding="utf-8", errors="replace"))
    hex_dig = hash_object.digest()[:n_bytes]
    return base64.b64encode(hex_dig).decode("ascii")


def escapeSingleQuotesFFmpeg(string: str) -> str:
    return re.sub(r"'", r"'\\''", string)


def shlexDoubleQuoted(value: str) -> str:
    """`value` in double quotes that `shlex.split` reads back unchanged. Inside them it takes `\\` and
    `"` as escapes, which a filter's own escaping uses."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def escapeFilterOptionValue(value: str) -> str:
    """`value` as a filter option in a filter graph, read literally: escaped once for the option
    parser and once more for the graph parser (ffmpeg-filters, "Notes on filtergraph escaping")."""
    optionLevel = re.sub(r"([\\':])", r"\\\1", value)
    return re.sub(r"([\\'\[\],;])", r"\\\1", optionLevel)


def floorToEven(x: Union[int, str, float]) -> int:
    x = int(x)
    return x & ~1
