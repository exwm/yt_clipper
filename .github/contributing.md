# Contributing Guide

## Setup

```bash
# Fork and clone the repository
git clone git@github.com:<YOUR-FORK/USERNAME>/yt_clipper.git
cd yt_clipper
```

### Markup Script (Browser User Script)

Prerequisites:

- [Node.js](https://nodejs.org/)
  - See `engines` constraint in `package.json` for supported versions

```bash
# Install yarn globally
npm install --global yarn

# Install js dependencies with yarn
yarn

# Build and bundle markup script in watch mode with typechecking
# Builds will be placed in ./dist/js
yarn run bundle:tc:w

# Bundle markup script for release
yarn run bundle:prod

# Install the user script in your browser using a user script manager extension
```

### Clipper Script (Python)

Prerequisites:

- [Python 3](https://www.python.org/)
  - See `python` version constraint in `pyproject.toml`
- [Poetry](https://python-poetry.org/)
  - See also <https://python-poetry.org/docs/managing-environments/>
- [FFmpeg](https://ffmpeg.org/)

```bash
# Install dependencies
poetry install

# Run yt_clipper via poetry
poetry run yt_clipper

# Run unit tests
yarn run test:py

# Run unit tests and integration tests
yarn run test:py:slow

# Build clipper executable
yarn run build:py # executable will be placed in ./dist/py
mkdir -p ./dist/py/bin/  # place ffmpeg binaries here (ffmpeg, ffplay, and ffprobe)
```

## Pre Commit Checks

A few simple pre-commit checks are automatically run by the `pre-commit` node package on commit. See the `pre-commit` config in `package.json`.

You can still force a commit by telling git to skip the pre-commit hooks by committing using `--no-verify`.
