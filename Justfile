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

# A folder, not a glob: sh on Windows (MSYS2) expands a glob in its arguments before the recipe runs.
pretty-ts:
  just _timed prettier npx prettier src --write --cache
pretty-py:
  uv run ruff check --select I --fix src/clipper integration-tests tools && uv run ruff format src/clipper integration-tests tools
pretty-py-check:
  just _timed "ruff format --check" uv run ruff format --check src/clipper integration-tests tools

# Coverage settings and the fail-under floor are in pyproject.toml; reports go to coverage/.
# The config path is absolute so tests that run from a temporary folder still find it. Tests do not
# measure the Python processes they start (yt-dlp): see noCoverageInSubprocesses in conftest.py.
test-py update="false":
  just _timed pytest uv run pytest src/clipper tools/release tools/prose tools/test -s --durations=10 --cov --cov-config="{{justfile_directory()}}/pyproject.toml" --cov-report=html --cov-report=xml -m "not slow" \
    {{ if update == "true" { "--snapshot-update" } else { "-n auto --dist worksteal" } }}
# Check an assembled release folder before zipping, as CI does: bundled tools, offline clips, schema.
smoke-release folder version="":
  uv run python tools/release/smoke_test.py "{{folder}}" {{version}}
# Check an installed release with the existing tests: the smoke test, one YouTube clip (with the
# install's default_args.txt, e.g. cookies), and the UI tests on the release's userscript.
verify-release install userscript version="":
  just smoke-release "{{install}}" {{version}}
  uv run pytest src/clipper/tests/test_e2e.py -k youtube-vp9 --clipper-exe "{{install}}/yt_clipper{{ if os_family() == "windows" { ".exe" } else { "" } }}"
  just ui-test --userscript "{{userscript}}"
  just ui-test-display-rates --userscript "{{userscript}}"
# After publishing: check that Greasy Fork serves the release's userscript (waits up to 3 minutes).
check-greasyfork version:
  uv run python tools/release/greasyfork.py {{version}}
test-py-slow:
  uv run pytest src/clipper tools/test --cov --cov-config="{{justfile_directory()}}/pyproject.toml" --cov-report=html -vvv
test-py-update:
  just test-py true

lint-py:
  just _timed "ruff check" uv run ruff check src/clipper integration-tests tools
lint-py-fix:
  uv run ruff check src/clipper integration-tests tools --fix

# Advisory prose lint with vale (rules in .vale/styles/ytc-style): reports, never fails. Install vale
# with `scoop install vale` or `brew install vale`. Pass paths to lint only those.
lint-prose *paths="readme.md quickstart.md release-notes .github tools/encoding/README.md src":
  vale --no-exit {{paths}}
# Commit subjects become changelog lines, so they get the same advisory lint.
lint-subjects revset="tags()..@":
  jj log -r '{{revset}}' --no-graph -T 'description.first_line() ++ "\n\n"' | vale --no-exit --ext=.subject
# Vale sees only comments in code, so this lints the strings users read (--help, tooltips, messages).
lint-strings *paths="src":
  uv run python tools/prose/lint_strings.py {{paths}}
test-prose:
  vale test --coverage .vale/styles

poetry-sync:
  poetry lock --no-update && poetry install --sync

build-ts:
  npx tsc --watch
build-ts-ne:
  npx tsc --noEmit --watch
build-ts-p:
  run-s -c build-ts pretty

build-py $UV_PREVIEW="1":
  uv run pyinstaller ./src/clipper/yt_clipper.py --icon=../../../assets/image/pepe-clipper.gif -F --collect-data ffmpeg_quality_metrics --collect-submodules numpy._core --add-data ../../../src/schema/markers.schema.json:schema --workpath ./dist/py/work/ --distpath ./dist/py/ --specpath ./dist/py/spec
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
# With coverage (thresholds in jest.config.js; reports go to coverage/markup). It triples the run time,
# so bundle-prod leaves it off unless asked (`just bundle-prod true`, as CI does).
test-ts coverage="true":
  just _timed jest npx jest test {{ if coverage == "true" { "--coverage" } else { "" } }} --json --outputFile=coverage/jest-report.json
  uv run python tools/test/jest_slowest.py coverage/jest-report.json
# Plants each bug in tools/test/planted-bugs/bugs.json in turn and runs its jest tests: fails if one
# is not caught (results in sandbox/planted-bugs/). `PLANT_UI=1` runs the UI test of those that name one.
[positional-arguments]
planted-bugs *ids:
  node tools/test/planted-bugs/plant.js "$@"
# Rewrite the crop easing and Cinematic parity tables' samples from the markup's preview math, after
# adding a case or changing the preview. An unchanged case comes out byte for byte the same.
regen-parity:
  npx jiti tools/test/write-parity-fixtures.ts
# Coverage of the lines changed since base, from the reports test-py and test-ts write (run them first).
coverage-diff base="origin/master": (coverage-diff-py base) (coverage-diff-ts base)
coverage-diff-py base="origin/master":
  uv run diff-cover coverage/clipper.xml --compare-branch={{base}} --fail-under=80
# Report only: the Playwright UI tests cover most markup code but do not record coverage.
coverage-diff-ts base="origin/master":
  uv run diff-cover coverage/markup/cobertura-coverage.xml --compare-branch={{base}}
# A one-shot build without Parcel's disk cache: for this one bundle, loading the cache took longer
# than rebuilding (measured 2.8s with it, 1.5s without), and it grew to about 1 GB. Parcel still
# writes some state, so it goes to a throwaway dir cleared each build, apart from watch mode's.
_parcel-once:
  rm -rf node_modules/.cache/parcel-once && npx parcel build --no-scope-hoist --no-optimize --no-cache --cache-dir node_modules/.cache/parcel-once
parcel-build:
  just _timed parcel just _parcel-once
# Format first (it rewrites sources), then check and build in parallel: they only read them.
bundle-prod coverage="false": pretty-ts (_check-and-build coverage)
[parallel]
_check-and-build coverage: typecheck-ts eslint-ts (test-ts coverage) parcel-build

# Serve the generic yt_clipper site with the freshly built userscript injected (no Tampermonkey).
dev-site:
  just _parcel-once
  uv run --group ui-test python integration-tests/ui/serve_dev_site.py
# Run the markup UI tests (pytest + Playwright, in an installed Chrome) on the dev site, in parallel. Screenshots
# go to sandbox/ui-shots/<test>/, and a failed test's Playwright trace to sandbox/ui-test-results/. Extra args go to pytest,
# e.g. `just ui-test -k "zoom or crop"`, or `just ui-test -n 0 -s --headed` to watch one at a time.
# The timing tests run after the rest, on fewer workers, so the others' load can't fail them, and a test that
# loads the machine itself runs alone last. A timing test whose measured window the machine spoiled (displays asleep) raises InconclusiveEnvironment, the only failure rerun.
# A phase that -k leaves empty (pytest exit 5) passes, unless all are. Filter with -k: a -m replaces the phases' marks.
[positional-arguments]
ui-test *args:
  just _parcel-once
  @just _ui-test-phase 8 "not display_rate and not timing and not alone" "$@"; rest=$?; just _ui-test-phase 4 "timing and not display_rate" "$@"; timing=$?; just _ui-test-phase 1 "alone" "$@"; alone=$?; [ $rest -eq 5 ] && [ $timing -eq 5 ] && [ $alone -eq 5 ] && exit 5; [ $rest -eq 5 ] && rest=0; [ $timing -eq 5 ] && timing=0; [ $alone -eq 5 ] && alone=0; exit $((rest | timing | alone))
[positional-arguments]
_ui-test-phase workers marks *args:
  @workers="$1"; marks="$2"; shift 2; uv run --group ui-test pytest integration-tests/ui --browser-channel chrome -n "$workers" --durations=10 --tracing retain-on-failure --output sandbox/ui-test-results --reruns 2 --only-rerun InconclusiveEnvironment -m "$marks" "$@"
# The loop's end frame on simulated 30, 50, 120 and 144 Hz displays, in Playwright's chromium-headless-shell
# (installed here once per Playwright version). Apart from ui-test: beside the other tests' load the simulated
# display drops refreshes now and then, which cuts an end frame short.
[positional-arguments]
ui-test-display-rates *args:
  just _parcel-once
  uv run --group ui-test playwright install chromium-headless-shell
  uv run --group ui-test pytest integration-tests/ui --browser-channel chrome -n 1 --durations=10 --output sandbox/ui-test-results --reruns 2 --only-rerun InconclusiveEnvironment -m display_rate "$@"
# Release highlight close-ups listed in integration-tests/ui/showcase.toml, into sandbox/showcase/<release>/.
# Add --update-assets to also write the shots that name an asset into assets/image/.
[positional-arguments]
ui-showcase release *args:
  just _parcel-once
  release="$1"; shift; uv run --group ui-test pytest integration-tests/ui/showcase.py --browser-channel chrome -n 3 --showcase-release "$release" --video-style calm "$@"
# The platform-dependent tests (marked platform) on a real YouTube video, into sandbox/ui-shots/<test>-youtube/. One at a time (YouTube only reliably buffers
# the first ~45s for an automated browser), and a failed test is retried once (YouTube loads can stall).
[positional-arguments]
ui-test-youtube url="https://www.youtube.com/watch?v=aqz-KE-bpKQ" *args:
  just _parcel-once
  url="$1"; shift; uv run --group ui-test pytest integration-tests/ui --browser-channel chrome -s --reruns 1 --durations=10 --tracing retain-on-failure --output sandbox/ui-test-results -m platform --youtube "$url" "$@"

clean-dist:
  rm -r ./dist/*
clean-sandbox:
  rm -r ./sandbox/*

# Release X.Y.Z in two steps, from the jj change described `version: X.Y.Z` (an empty change on top of
# everything the release includes; `jj edit` it first):
#   just release-prep X.Y.Z     write the changelog, set the version everywhere, and run every check
#   just release-publish X.Y.Z  protect, tag, and push it; CI then builds the draft GitHub release

# Write the changelog, set the version everywhere, and run every check. Safe to rerun: the version's
# changelog section is regenerated from the commits each time, with release-notes/<version>.md (the
# hand-written summary and Highlights) inserted under its heading.
release-prep version:
  @test "$(jj log -r @ --no-graph -T 'description.first_line()')" = "version: {{version}}" || { echo "Run this in the 'version: {{version}}' change (jj edit it first)."; exit 1; }
  uv run python tools/release/changelog.py drop {{version}}
  npx commit-and-tag-version --release-as {{version}}
  uv run python tools/release/changelog.py highlights {{version}}
  uv run python tools/release/changelog.py credits {{version}}
  uv run python tools/release/version.py set {{version}}
  just bundle-prod true
  just lint-py
  just test-py
  just ui-test
  # Again with the frame rate never measured: the assumed 60 fps a user gets with Measure off, as 5.48.
  just ui-test --assumed-frame-rate
  just ui-test-display-rates
  uv run python tools/release/version.py check {{version}}
# Tagged commits are made immutable in jj: the changelog links and the tag point at them.

# Tag the version change and push it to release/master; CI then builds the draft GitHub release.
# Safe to rerun, also after rewriting the version change (jj --ignore-immutable): the tag,
# release/master, and the draft release move to the new commit. The tag goes first so CI sees it.
# The local tag moves only after its push, so the lease expects what the remote last accepted.
# release/master is fetched first (with stale remote state jj can refuse to move it after a
# rewrite), and both refs are checked on origin at the end: CI builds only on a release/master push.
release-publish version:
  uv run python tools/release/version.py check {{version}}
  jj config set --repo 'revset-aliases."immutable_heads()"' 'builtin_immutable_heads() | tags()'
  @commit="$(jj log -r 'exactly(subject(exact:"version: {{version}}"), 1)' --no-graph -T commit_id)" || exit 1; old="$(git rev-parse -q --verify refs/tags/v{{version}})"; if [ "$old" = "$commit" ]; then echo 'v{{version}} already tags the version change'; else git push --force-with-lease="refs/tags/v{{version}}:$old" origin "$commit:refs/tags/v{{version}}" && git tag -f v{{version}} "$commit"; fi
  jj git import
  jj git fetch --remote origin --branch release/master
  jj bookmark set release/master --allow-backwards -r 'exactly(subject(exact:"version: {{version}}"), 1)'
  jj git push --bookmark release/master
  @commit="$(jj log -r 'exactly(subject(exact:"version: {{version}}"), 1)' --no-graph -T commit_id)"; for ref in refs/tags/v{{version}} refs/heads/release/master; do remote="$(git ls-remote origin "$ref" | cut -f1)"; [ "$remote" = "$commit" ] || { echo "error: $ref on origin is '$remote', not the version change $commit"; exit 1; }; done; echo "v{{version}} and release/master on origin are at $commit"
pigar:
  pigar -P ./src/clipper -p ./src/clipper/requirements.txt --without-referenced-comments
