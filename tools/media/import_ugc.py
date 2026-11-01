"""Write datasets/ugc.toml and datasets/ugc_vp9.toml from the YouTube UGC dataset's bucket: its H.264
copies of the clips (20 s, CRF 10), and its YouTube-style VP9 transcodes of 148 of them (VOD,
low-bitrate VOD and CBR), each with its attribution, subjective quality scores, content labels and
features.

    uv run --with openpyxl python tools/media/import_ugc.py

The bucket's LICENSE is Creative Commons; ATTRIBUTION names each clip's source and license.
"""

import csv
import io
import json
import re
from pathlib import Path
from urllib.request import urlopen

import openpyxl
from media_datasets import DATASETS, md5_from_base64

BUCKET = "https://storage.googleapis.com/ugc-dataset"
LISTING = "https://storage.googleapis.com/storage/v1/b/ugc-dataset/o?maxResults=1000&fields=items(name,size,md5Hash),nextPageToken"
# yt_clipper users mostly clip music videos, concerts and other live footage
PRIORITY = {
    "LiveMusic": 3, "MusicVideo": 3, "CoverSong": 2, "TelevisionClip": 2, "VerticalVideo": 2, "Vlog": 2,
    "Sports": 1, "HDR": 1, "Animation": 0.5, "Gaming": 0.5, "HowTo": 0.5, "Lecture": 0.5,
    "LyricVideo": 0.5, "NewsClip": 0.5, "VR": 0,
}  # fmt: skip
# Live footage filed under other categories, like dance on the news. No label names K-pop or fancams.
LABEL_PRIORITY = {"Concert": 3, "Dance": 3, "Performance art": 2}


def get(path: str) -> bytes:
    with urlopen(f"{BUCKET}/{path}", timeout=60) as response:
        return response.read()


def listing(prefix: str) -> list[dict]:
    items, token = [], ""
    while True:
        url = f"{LISTING}&prefix={prefix}" + (f"&pageToken={token}" if token else "")
        with urlopen(url, timeout=60) as response:
            page = json.load(response)
        items += page.get("items", [])
        if not (token := page.get("nextPageToken", "")):
            return items


def sheet(path: str, name: str) -> list[dict]:
    rows = list(
        openpyxl.load_workbook(io.BytesIO(get(path)), read_only=True)[name].iter_rows(
            values_only=True,
        ),
    )
    return [dict(zip(rows[0], row, strict=False)) for row in rows[1:] if row[0]]


def number(value: object) -> float | None:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None


def toml_value(value: object) -> str:
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, list):
        return "[" + ", ".join(toml_value(v) for v in value) + "]"
    if isinstance(value, dict):
        return (
            "{ "
            + ", ".join(f"{k} = {toml_value(v)}" for k, v in value.items() if v is not None)
            + " }"
        )
    raise TypeError(value)


def main() -> None:
    attribution = {}
    for line in get("ATTRIBUTION").decode("utf-8").splitlines():
        if match := re.match(
            r"(\S+) is an audio-removed excerpt from .* licensed under (.+)$",
            line,
        ):
            attribution[match[1]] = (line, match[2].strip())
    mos = {
        row["vid"]: row for row in sheet("original_videos/MOS_for_YouTube_UGC_dataset.xlsx", "MOS")
    }
    dmos = {
        row["vid"]: row
        for row in sheet("original_videos/DMOS_for_YouTube_UGC_dataset.xlsx", "DMOS")
    }
    # 12 label columns, then their votes, then their confidence (votes over times shown)
    labels = {
        row["vid"]: [
            (str(row[f"label_{i:02}"]), number(row[f"conf_{i:02}"]))
            for i in range(12)
            if row[f"label_{i:02}"]
        ]
        for row in sheet(
            "original_videos/Content_label_for_YouTube_UGC_dataset.xlsx",
            "content label",
        )
    }
    features = {
        r["FILENAME"]: r
        for r in csv.DictReader(
            io.StringIO(get("original_videos/dataset_selection_features.csv").decode()),
        )
    }
    distortion = {
        r["FILENAME"]: r
        for r in csv.DictReader(io.StringIO(get("original_videos/metrics.csv").decode()))
    }

    def metadata(vid: str) -> dict:
        """What the dataset says about one source clip."""
        category, resolution = re.match(r"([A-Za-z]+)_(\d+P)", vid).groups()
        quality, loss, feature, metric = (
            mos.get(vid, {}),
            dmos.get(vid, {}),
            features.get(vid, {}),
            distortion.get(vid, {}),
        )
        return {
            "category": category,
            "license": attribution.get(vid, ("", ""))[1],
            "resolution": resolution,
            "mos": number(quality.get("MOS full")),
            "mos_std": number(quality.get("std full")),
            "raters": int(quality["# subjects"]) if quality.get("# subjects") else None,
            "dmos": {k: number(loss.get(f"DMOS({k})")) for k in ("vod", "vodlb", "cbr")} if loss else None,
            "complexity": {
                "spatial": number(feature.get("SPATIAL_COMPLEXITY")),
                "temporal": number(feature.get("TEMPORAL_COMPLEXITY")),
                "chunk_variation": number(feature.get("CHUNK_COMPLEXITY_VARIATION")),
                "color": number(feature.get("COLOR_COMPLEXITY")),
            } if feature else None,
            "distortion": {k.lower(): number(metric.get(f"{k}_DMOS")) for k in ("SLEEQ", "BANDING", "NOISE")} if metric else None,
            "labels": [label for label, _ in labels.get(vid, [])],
            "label_confidence": [confidence for _, confidence in labels.get(vid, [])],
            "attribution": attribution.get(vid, ("", ""))[0],
        }  # fmt: skip

    def item(entry: dict, item_id: str, vid: str, **extra: object) -> dict:
        return {
            "id": item_id,
            "url": f"{BUCKET}/{entry['name']}",
            "size": int(entry["size"]),
            "md5": md5_from_base64(entry["md5Hash"]),
            **metadata(vid),
            **extra,
        }

    copies = []
    for entry in sorted(listing("original_videos_h264/"), key=lambda e: e["name"]):
        name = Path(entry["name"]).name
        if name.endswith(".mp4"):
            vid = name.split("_crf_")[0]
            copies.append(item(entry, vid, vid))
    write(DATASETS / "ugc.toml", "YouTube UGC dataset (H.264 copies, 20 s, CRF 10)", copies)

    # What yt_clipper users download: the clip as YouTube-style VP9 serves it, with the loss
    # viewers rated (DMOS) for that transcode
    transcodes = []
    for entry in sorted(listing("vp9_compressed_videos/"), key=lambda e: e["name"]):
        if match := re.search(r"/(\w+?_\d+P-\w+)_(vod|vodlb|cbr)\.webm$", entry["name"]):
            vid, mode = match.groups()
            loss = number(dmos.get(vid, {}).get(f"DMOS({mode})"))
            transcodes.append(
                item(entry, f"{vid}_{mode}", vid, mode=mode, source=vid, transcode_dmos=loss),
            )
    write(
        DATASETS / "ugc_vp9.toml",
        "YouTube UGC dataset (YouTube-style VP9 transcodes, 20 s)",
        transcodes,
    )


def write(path: Path, title: str, items: list[dict]) -> None:
    lines = [
        "# Generated by import_ugc.py from the YouTube UGC dataset bucket. Edit the priorities freely;",
        "# rerun the import to refresh the items.",
        f"title = {toml_value(title)}",
        'homepage = "https://media.withyoutube.com/"',
        'license = "Creative Commons, per clip (see each item\'s attribution)"',
        "items = [",
    ]
    lines += [
        "  " + toml_value({k: v for k, v in i.items() if v not in (None, [], "")}) + ","
        for i in items
    ]
    lines += ["]", "", "[priority]", *(f"{k} = {v}" for k, v in PRIORITY.items()), ""]
    lines += [
        "[label_priority]",
        *(f"{toml_value(k)} = {v}" for k, v in LABEL_PRIORITY.items()),
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
