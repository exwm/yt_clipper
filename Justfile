default:
  just --list

fetch_tags:
  git fetch origin --tags --force

poetry_sync:
  poetry lock --no-update && poetry install --sync

pr pr_number:
    git fetch -fu origin refs/pull/{{pr_number}}/head:pr/{{pr_number}}
    git checkout pr/{{pr_number}}

# Run a command and print how long it took, so a slow build or check step stays visible. Times come
# from Node, which every build machine has (macOS's date has no sub-second format). A missing time
# skips the report but never fails the step: the command's own exit status is kept.
[positional-arguments]
_timed label *command:
  @label="$1"; shift; start=$(node -p 'Date.now()' 2>/dev/null); "$@"; status=$?; end=$(node -p 'Date.now()' 2>/dev/null); case "$start$end" in ''|*[!0-9]*) ;; *) ms=$((end - start)); printf '[time] %-22s %3d.%01ds\n' "$label" $((ms / 1000)) $((ms % 1000 / 100)) ;; esac; exit $status

pretty-ts:
  just _timed prettier npx prettier "src/**/*.{ts,js,json}" --write --cache
pretty-py:
  uv run ruff check --select I --fix src/clipper integration-tests && uv run ruff format src/clipper integration-tests
pretty-py-check:
  just _timed "ruff format --check" uv run ruff format --check src/clipper integration-tests

test-py update="false":
  just _timed pytest uv run pytest src/clipper -s --cov=src/clipper --cov-report=html -m "not slow" \
    {{ if update == "true" { "--snapshot-update" } else { "" } }}
test-py-slow:
  uv run pytest src/clipper --cov=src/clipper --cov-report=html -vvv
test-py-update:
  just test-py true

lint-py:
  just _timed "ruff check" uv run ruff check src/clipper integration-tests
lint-py-fix:
  uv run ruff check src/clipper integration-tests --fix

poetry-sync:
  poetry lock --no-update && poetry install --sync

build-ts:
  npx tsc --watch
build-ts-ne:
  npx tsc --noEmit --watch
build-ts-p:
  run-s -c build-ts pretty

build-py $UV_PREVIEW="1":
  uv run pyinstaller ./src/clipper/yt_clipper.py --icon=../../../assets/image/pepe-clipper.gif -F --collect-data ffmpeg_quality_metrics --workpath ./dist/py/work/ --distpath ./dist/py/ --specpath ./dist/py/spec
build-all:
  run-s -c build-ts-p build-py
bundle-w:
  npx parcel watch --no-scope-hoist --no-optimize --no-hmr
bundle-tc-w:
  run-p -c build-ts-ne bundle-w
# Incremental: only files changed since the last check are re-checked.
typecheck-ts:
  just _timed tsc npx tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsc/tsconfig.tsbuildinfo
# Cached: unchanged files are skipped. By content, not timestamp: jj rewrites files on every checkout
# and rebase, which would otherwise invalidate the cache (measured 4.9s vs 1.3s). With type-aware
# rules an edit can change another file's result, so delete node_modules/.cache/eslint for a full
# lint if one looks stale.
eslint-ts:
  just _timed eslint npx eslint --cache --cache-strategy content --cache-location node_modules/.cache/eslint/ ./src/markup ./src/command-palette
lint-ts: typecheck-ts eslint-ts
test-ts:
  just _timed jest npx jest test
# A one-shot build without Parcel's disk cache: for this one bundle, loading the cache took longer
# than rebuilding (measured 2.8s with it, 1.5s without), and it grew to about 1 GB. Parcel still
# writes some state, so it goes to a throwaway dir cleared each build, apart from watch mode's.
_parcel-once:
  rm -rf node_modules/.cache/parcel-once && npx parcel build --no-scope-hoist --no-optimize --no-cache --cache-dir node_modules/.cache/parcel-once
parcel-build:
  just _timed parcel just _parcel-once
# Format first (it rewrites sources), then check and build in parallel: they only read them.
bundle-prod: pretty-ts _check-and-build
[parallel]
_check-and-build: typecheck-ts eslint-ts test-ts parcel-build

# Serve the generic yt_clipper site with the freshly built userscript injected (no Tampermonkey).
dev-site:
  just _parcel-once
  uv run --group ui-test python integration-tests/ui/serve_dev_site.py
# Run the markup UI tests (pytest + Playwright, in an installed Chrome) on the dev site, in parallel. Screenshots
# go to sandbox/ui-shots/<test>/, and a failed test's Playwright trace to sandbox/ui-test-results/. Extra args go to pytest,
# e.g. `just ui-test -k "zoom or crop"`, or `just ui-test -n 0 -s --headed` to watch one at a time.
[positional-arguments]
ui-test *args:
  just _parcel-once
  uv run --group ui-test pytest integration-tests/ui --browser-channel chrome -n 4 --durations=10 -o faulthandler_timeout=600 --tracing retain-on-failure --output sandbox/ui-test-results "$@"
# The platform-dependent tests (marked platform) on a real YouTube video, into sandbox/ui-shots/<test>-youtube/. One at a time (YouTube only reliably buffers
# the first ~45s for an automated browser), and a failed test is retried once (YouTube loads can stall).
[positional-arguments]
ui-test-youtube url="https://www.youtube.com/watch?v=aqz-KE-bpKQ" *args:
  just _parcel-once
  url="$1"; shift; uv run --group ui-test pytest integration-tests/ui --browser-channel chrome -s --reruns 1 --durations=10 -o faulthandler_timeout=600 --tracing retain-on-failure --output sandbox/ui-test-results -m platform --youtube "$url" "$@"

clean-dist:
  rm -r ./dist/*
clean-sandbox:
  rm -r ./sandbox/*

version-patch:
  npx commit-and-tag-version -r patch && uv run bumpit -p patch || true
version-minor:
  npx commit-and-tag-version -r minor && uv run bumpit -p minor || true
version-major:
  npx commit-and-tag-version -r major && uv run bumpit -p major || true
pigar:
  pigar -P ./src/clipper -p ./src/clipper/requirements.txt --without-referenced-comments
