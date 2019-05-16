# Contributing Guide

## Setup

1.  Prerequisites:

    - [Node.js](https://nodejs.org/) v10.0.0 or higher
    - [Python](https://www.python.org/)
    - [FFmpeg](https://ffmpeg.org/)

2.  In a terminal:

    ```bash
    # fork and clone the repository
    git clone git@github.com:<YOUR-FORK/USERNAME>/yt_clipper.git
    cd yt_clipper

    # Install npm dependencies
    npm install

    # Build user script (AKA markup script)
    npm run build:ts

    # Build python executable
    pip install -U pyinstaller youtube-dl urllib3
    npm run build:py
    mkdir -p ./dist/py/bin/  # place ffmpeg binary here

    # Build all and run prettier formatting
    npm run build:all
    ```
