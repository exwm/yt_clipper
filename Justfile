default:
  just --list

fetch_tags:
  git fetch origin --tags --force

poetry_sync:
  poetry lock --no-update && poetry install --sync

pr pr_number:
    git fetch -fu origin refs/pull/{{pr_number}}/head:pr/{{pr_number}}
    git checkout pr/{{pr_number}}

pretty-ts:
  npx prettier "src/**/*.{ts,js,json}" --write
pretty-py:
  uv run ruff check --select I --fix src/clipper integration-tests && uv run ruff format src/clipper integration-tests
pretty-py-check:
  uv run ruff format --check src/clipper integration-tests

test-py update="false":
  uv run pytest src/clipper -s --cov=src/clipper --cov-report=html -m "not slow" \
    {{ if update == "true" { "--snapshot-update" } else { "" } }}
test-py-slow:
  uv run pytest src/clipper --cov=src/clipper --cov-report=html -vvv
test-py-update:
  just test-py true

lint-py:
  uv run ruff check src/clipper integration-tests
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
lint-ts:
  npx tsc --noEmit && npx eslint ./src/markup ./src/command-palette
test-ts:
  npx jest test
bundle-prod:
  just pretty-ts && just lint-ts && just test-ts && npx parcel build --no-scope-hoist --no-optimize

# Serve the generic yt_clipper site with the freshly built userscript injected (no Tampermonkey).
dev-site:
  npx parcel build --no-scope-hoist --no-optimize
  uv run --group ui-test python integration-tests/ui/serve_dev_site.py
# Run the markup UI tests (pytest + Playwright, in an installed Chrome) on the dev site, in parallel. Screenshots
# go to sandbox/ui-shots/<test>/, and a failed test's Playwright trace to sandbox/ui-test-results/. Extra args go to pytest,
# e.g. `just ui-test -k "zoom or crop"`, or `just ui-test -n 0 -s --headed` to watch one at a time.
[positional-arguments]
ui-test *args:
  npx parcel build --no-scope-hoist --no-optimize
  uv run --group ui-test pytest integration-tests/ui --browser-channel chrome -n 4 --durations=10 -o faulthandler_timeout=600 --tracing retain-on-failure --output sandbox/ui-test-results "$@"
# The platform-dependent tests (marked platform) on a real YouTube video, into sandbox/ui-shots/<test>-youtube/. One at a time (YouTube only reliably buffers
# the first ~45s for an automated browser), and a failed test is retried once (YouTube loads can stall).
[positional-arguments]
ui-test-youtube url="https://www.youtube.com/watch?v=aqz-KE-bpKQ" *args:
  npx parcel build --no-scope-hoist --no-optimize
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
