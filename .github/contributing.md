# Contributing Guide

## Setup

1. Prerequisites:

    - [Node.js](https://nodejs.org/) v10.0.0 or higher
    - [Python 3](https://www.python.org/)
    - [FFmpeg](https://ffmpeg.org/)

2. In a terminal:

    ```bash
    # Fork and clone the repository
    git clone git@github.com:<YOUR-FORK/USERNAME>/yt_clipper.git
    cd yt_clipper

    # Install npm dependencies
    npm install

    # Build and bundle markup script in watch mode with typchecking
    npm run bundle:tc:w

    # Bundle markup script for release
    npm run bundle:prod

    # Build python executable
    pip install -U pyinstaller youtube-dl urllib3
    npm run build:py
    mkdir -p ./dist/py/bin/  # place ffmpeg binaries here (ffmpeg, ffplay, and ffprobe)

    # Build all and run prettier formatting
    npm run build:all
    ```
