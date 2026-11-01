"""Open video datasets, one TOML file each in datasets/, and fetching their items into a local cache.

A dataset file names the dataset, its homepage and license, how much each category and content
label counts when sampling (`priority`, `label_priority`), and one inline table per item: `id`, `url`, `size`, an `md5` or `sha256`,
and anything else known about it (category, license, attribution, quality scores, labels).
"""

import base64
import hashlib
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[2]
DATASETS = Path(__file__).with_name("datasets")
# Fetched items and built cases. Never in git.
CACHE = Path(os.environ.get("YTC_MEDIA_CACHE") or REPO / "sandbox" / "media")
CORE = ("id", "url", "size", "md5", "sha256", "category", "license")


class DatasetError(Exception):
    pass


@dataclass(frozen=True)
class Item:
    dataset: str
    id: str
    url: str
    size: int
    md5: str = ""
    sha256: str = ""
    category: str = ""
    license: str = ""
    # Everything else the dataset says about the item: attribution, quality scores, labels
    meta: dict = field(default_factory=dict, compare=False, hash=False)

    @property
    def ref(self) -> str:
        return f"{self.dataset}:{self.id}"


@dataclass(frozen=True)
class Dataset:
    name: str
    title: str
    homepage: str
    license: str
    priority: dict[str, float]
    items: dict[str, Item]
    # Content labels that count more than their category, like Dance clips filed under Sports
    label_priority: dict[str, float] = field(default_factory=dict)

    def weight(self, item: Item) -> float:
        """How much the item counts when sampling: the highest of its category's and its labels'
        priorities, 1 for a category the dataset does not name."""
        labels = [
            self.label_priority[label]
            for label in item.meta.get("labels", [])
            if label in self.label_priority
        ]
        return max([self.priority.get(item.category, 1.0), *labels])


def load_dataset(path: Path) -> Dataset:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    name = path.stem
    items = {}
    for entry in data.get("items", []):
        missing = [key for key in ("id", "url", "size") if key not in entry]
        if missing or not (entry.get("md5") or entry.get("sha256")):
            raise DatasetError(
                f"{path.name}: item {entry.get('id', '?')} needs id, url, size and an md5 or sha256",
            )
        meta = {key: value for key, value in entry.items() if key not in CORE}
        core = {key: entry[key] for key in CORE if key in entry}
        items[entry["id"]] = Item(dataset=name, meta=meta, **core)
    return Dataset(
        name=name,
        title=data.get("title", name),
        homepage=data.get("homepage", ""),
        license=data.get("license", ""),
        priority=data.get("priority", {}),
        items=items,
        label_priority=data.get("label_priority", {}),
    )


def load_datasets(folder: Path = DATASETS) -> dict[str, Dataset]:
    return {path.stem: load_dataset(path) for path in sorted(folder.glob("*.toml"))}


def cached_path(item: Item, cache: Path = CACHE) -> Path:
    return cache / "datasets" / item.dataset / Path(urlparse(item.url).path).name


def _matches(item: Item, path: Path) -> bool:
    if path.stat().st_size != item.size:
        return False
    digest = hashlib.sha256() if item.sha256 else hashlib.md5()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest() == (item.sha256 or item.md5).lower()


def fetch(item: Item, cache: Path = CACHE) -> Path:
    """The item's file, downloaded once and checked against its hash. A broken download resumes."""
    target = cached_path(item, cache)
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={have}-"} if 0 < have < item.size else {}
    if have < item.size:
        with urlopen(Request(item.url, headers=headers), timeout=60) as response:
            resumed = response.status == 206
            with part.open("ab" if resumed else "wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
    if not _matches(item, part):
        part.unlink()
        raise DatasetError(f"{item.ref}: the download does not match its size and hash")
    part.replace(target)
    return target


def md5_from_base64(value: str) -> str:
    """Google Cloud Storage lists MD5s in base64."""
    return base64.b64decode(value).hex()
