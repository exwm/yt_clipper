"""Serve the dev site for trying the userscript by hand: the generic yt_clipper page with the freshly
built bundle injected (no Tampermonkey), plus a generated test video. Run through `just dev-site`."""

import argparse
import contextlib
import threading

from harness.dev_site import DEFAULT_PORT, DEFAULT_VIDEO_SECONDS, build, serving


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--video-seconds", type=int, default=DEFAULT_VIDEO_SECONDS)
    args = parser.parse_args()
    video_name = build(args.video_seconds)
    with serving(args.port) as url:
        print(f"Serving {url} (test video: {video_name}). Press Ctrl+C to stop.")
        print("Load the video by pasting its name into the page, then press Alt+Shift+A.")
        with contextlib.suppress(KeyboardInterrupt):
            threading.Event().wait()


if __name__ == "__main__":
    main()
