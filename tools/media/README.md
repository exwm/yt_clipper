# Test media

Open video datasets, distilled test cases built from them, and a survey to pick clips by how much of the footage's traits they cover. Run it with `just media` (or `uv run python tools/media/media.py`); add `--help` to any command.

```
just media list
just media survey OUT.jsonl ugc --per-category 4 --seconds 3
just media stats OUT.jsonl
just media pick TARGET.jsonl CANDIDATES.jsonl [--have KEPT.jsonl] [--count 8]
just media build [CASE ...]
just media fetch ugc:LiveMusic_1080P-14af
```

- Datasets are TOML files in `datasets/`, one item per line: its URL, size, hash, license, and what the dataset knows about it (quality scores, content labels, complexity). Adding or removing a dataset is adding or removing a file. `import_ugc.py` regenerates the YouTube UGC files: `ugc.toml` (CRF 10 copies of 1049 clips) and `ugc_vp9.toml` (YouTube-style VP9 transcodes of 148, with the loss viewers rated).
- `priority` and `label_priority` in a dataset file set how much a category or content label counts when sampling and picking. The UGC files favor music videos, concerts and other live footage, which is what yt_clipper users clip.
- Item ids, dataset file names and case names use only letters, digits, `.`, `_` and `-`, since each names a file in the cache.
- Cases are `[[case]]` tables in `cases/*.toml`: a source, where to cut it, and transforms (splice, ffmpeg filters, an encode, optionally two-pass).
- A survey streams the first seconds of each item, decodes them once, and measures the stabilization and encoding traits. `pick` adds the clips that cover the most of the target's trait pairs and come nearest the clips no pick covers yet, favoring higher priority.
- Downloads and built cases go to `sandbox/media`, or to `YTC_MEDIA_CACHE` when set. Every command ends with its time by step.
- Never add private footage (the calibration corpus, clipper outputs) to a dataset or case here.
- `cases/stab.toml` holds the clips `just stab-eval` stabilizes (`tools/stabilization/stab_eval.py`). `datasets/commons.toml` lists openly licensed drone and FPV flights from Wikimedia Commons, each with its license and attribution.
