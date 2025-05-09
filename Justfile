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
  uv run ruff check --select I --fix src/clipper && uv run ruff format src/clipper
pretty-py-check:
  uv run ruff format --check src/clipper

test-py:
  uv run pytest src/clipper -s --cov=src/clipper --cov-report=html -m "not slow"
test-py-slow:
  uv run pytest src/clipper --cov=src/clipper --cov-report=html

lint-py:
  uv run ruff check src/clipper
lint-py-fix:
  yarn run lint-py --fix

poetry-sync:
  poetry lock --no-update && poetry install --sync

build-ts:
  npx tsc --watch
build-ts-ne:
  npx tsc --noEmit --watch
build-ts-p:
  run-s -c build-ts pretty

build-py $UV_PREVIEW="1":
  uv run pyinstaller ./src/clipper/yt_clipper.py --icon=../../../assets/image/pepe-clipper.gif -F --workpath ./dist/py/work/ --distpath ./dist/py/ --specpath ./dist/py/spec
build-all:
  run-s -c build-ts-p build-py
bundle-w:
  npx parcel watch --no-scope-hoist --no-optimize --no-hmr
bundle-tc-w:
  run-p -c build-ts-ne bundle-w
bundle-prod:
  npx parcel build --no-scope-hoist --no-optimize

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
