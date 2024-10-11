import contextlib
import importlib
import json
import shlex
import subprocess
import sys
from typing import Any, Dict, List, Tuple

import yt_dlp

from clipper.clipper_types import ClipperPaths, ClipperState


def ytdl_bin_get_version(cp: ClipperPaths) -> str:
    ytdl_process = subprocess.run(
        args=[cp.ytdlPath, "--version"],
        stdout=subprocess.PIPE,
        check=True,
        shell=False,
    )
    version = ytdl_process.stdout.decode("utf-8")
    return version


def ytdl_bin_get_args_base(cs: ClipperState) -> List[str]:
    settings = cs.settings
    cp = cs.clipper_paths

    # fmt: off
    ytdl_args = [
      cp.ytdlPath,
      "--no-cache-dir",
      "--verbose",
      "--no-youtube-include-dash-manifest",
      "--merge-output-format", "mkv",
      "--format", settings["format"],
      "--format-sort", shlex.quote(",".join(settings["formatSort"])),
      "--output", shlex.quote(f'{settings["downloadVideoPath"]}.%(ext)s'),
    ]
    # fmt: on

    if getattr(sys, "frozen", False):
        ytdl_args.extend(["--ffmpeg-location", shlex.quote(cp.ffmpegPath)])

    cookiefile = settings["cookiefile"]

    if cookiefile != "":
        ytdl_args.extend(["--cookiefile", shlex.quote(cookiefile)])

    if settings["username"] != "" or settings["password"] != "":
        ytdl_args.extend(["--username", shlex.quote(settings["username"])])
        ytdl_args.extend(["--password", shlex.quote(settings["password"])])

    return ytdl_args


def ytdl_bin_get_video_info(cs: ClipperState) -> Tuple[Dict, str]:
    settings = cs.settings

    ytdl_args = ytdl_bin_get_args_base(cs)

    ytdl_args_download = ytdl_args.copy()

    ytdl_args_get_url = ytdl_args.copy()
    ytdl_args_get_url.extend(["--get-url"])
    ytdl_args_get_url.extend([settings["videoPageURL"]])

    ytdl_args_dump_json = ytdl_args.copy()
    ytdl_args_dump_json.extend(["--dump-json"])
    ytdl_args_dump_json.extend([settings["videoPageURL"]])

    ytdl_args_list_formats = ytdl_args.copy()
    ytdl_args_list_formats.extend(["--list-formats"])
    ytdl_args_list_formats.extend([settings["videoPageURL"]])

    ytdl_dumped_json_process = subprocess.run(
        args=ytdl_args_dump_json,
        stdout=subprocess.PIPE,
        check=True,
    )
    ytdl_dumped_json = ytdl_dumped_json_process.stdout.decode("utf-8")
    ytdl_info = json.loads(ytdl_dumped_json)

    formats_table_process = subprocess.run(
        args=ytdl_args_list_formats,
        stdout=subprocess.PIPE,
        check=True,
    )
    formats_table = formats_table_process.stdout.decode("utf-8")

    if settings["downloadVideo"]:
        subprocess.run(args=ytdl_args_download, check=True)
        settings["downloadVideoPath"] = f'{settings["downloadVideoPath"]}.mkv'

    return ytdl_info, formats_table


def ytdl_lib_get_video_info(cs: ClipperState) -> Tuple[Dict, str]:
    settings = cs.settings
    cp = cs.clipper_paths

    ytdl_opts = {
        "format": settings["format"],
        "forceurl": True,
        "format_sort": ",".join(settings["formatSort"]).split(","),
        "merge_output_format": "mkv",
        "verbose": True,
        "outtmpl": f'{settings["downloadVideoPath"]}.%(ext)s',
        "cachedir": False,
        "youtube_include_dash_manifest": False,
    }

    if settings["cookiefile"] != "":
        ytdl_opts["cookiefile"] = settings["cookiefile"]

    if settings["username"] != "" or settings["password"] != "":
        ytdl_opts["username"] = settings["username"]
        ytdl_opts["password"] = settings["password"]

    if getattr(sys, "frozen", False):
        ytdl_opts["ffmpeg_location"] = cp.ffmpegPath

    importlib.reload(yt_dlp)
    with yt_dlp.YoutubeDL(ytdl_opts) as ytdl:
        if settings["downloadVideo"]:
            ytdl_info: Dict[str, Any] = ytdl.extract_info(
                settings["videoPageURL"],
                download=True,
            )  # type: ignore
            settings["downloadVideoPath"] = f'{settings["downloadVideoPath"]}.mkv'
        else:
            ytdl_info: Dict[str, Any] = ytdl.extract_info(
                settings["videoPageURL"],
                download=False,
            )  # type: ignore

        formats_table = ""
        with contextlib.suppress(Exception):
            formats_table = ytdl.render_formats_table(ytdl_info) or ""

    return ytdl_info, formats_table


def ytdl_bin_get_subs(cs: ClipperState) -> None:
    cp = cs.clipper_paths
    settings = cs.settings

    settings["subsFileStem"] = f'{cp.clipsPath}/subs/{settings["titleSuffix"]}'
    settings["subsFilePath"] = f'{settings["subsFileStem"]}.{settings["autoSubsLang"]}.vtt'

    ytdl_args = ytdl_bin_get_args_base(cs)

    # fmt: off
    ytdl_args.extend(
        [
            "--skip-download",
            "--write-subs",
            "--sub-format", "vtt",
            "--sub-langs", settings["autoSubsLang"],
            "--output", shlex.quote(settings["subsFileStem"]),
            settings["videoPageURL"],
        ],
    )
    # fmt: on

    subprocess.run(args=ytdl_args, check=True)


def ytdl_lib_get_subs(cs: ClipperState) -> None:
    cp = cs.clipper_paths
    settings = cs.settings

    settings["subsFileStem"] = f'{cp.clipsPath}/subs/{settings["titleSuffix"]}'
    settings["subsFilePath"] = f'{settings["subsFileStem"]}.{settings["autoSubsLang"]}.vtt'

    ytdl_opts = {
        "skip_download": True,
        "writesubtitles": True,
        "subtitlesformat": "vtt",
        "subtitleslangs": [settings["autoSubsLang"]],
        "outtmpl": f'{settings["subsFileStem"]}',
        "cachedir": False,
    }

    if settings["cookiefile"] != "":
        ytdl_opts["cookiefile"] = settings["cookiefile"]

    importlib.reload(yt_dlp)
    with yt_dlp.YoutubeDL(ytdl_opts) as ytdl:
        ytdl.download([settings["videoPageURL"]])
