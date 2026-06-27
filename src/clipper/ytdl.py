import json
import subprocess
import sys
from typing import Dict, Iterable, List, NoReturn, Tuple

from rich.text import Text

from clipper.clipper_types import ClipperPaths, ClipperState, argvPath
from clipper.log_helpers import subprocess_block
from clipper.ytc_logger import Subsystem, make_subsystem_logger, printToLogFile

logger = make_subsystem_logger(Subsystem.YTDL)


def ytdl_bin_get_version(cp: ClipperPaths) -> str:
    ytdl_process = subprocess.run(
        args=[argvPath(cp.ytdlPath), "--version"],
        stdout=subprocess.PIPE,
        check=True,
        shell=False,
    )
    version = ytdl_process.stdout.decode("utf-8")
    return version


# Like yt-dlp's default sort, except higher filesize and bitrate come before a codec hierarchy.
DEFAULT_FORMAT_SORT = [
    "hasvid,ie_pref,lang,quality,res,fps,br,size,hdr:1,vcodec:vp9.2,vcodec:vp9,asr,proto,ext,hasaud,source,id",
]


def ytdl_bin_get_args_base(cs: ClipperState) -> List[str]:
    settings = cs.settings
    cp = cs.clipper_paths

    # fmt: off
    ytdl_args = [
      argvPath(cp.ytdlPath),
      "--no-cache-dir",
      "--verbose",
      "--merge-output-format", "mkv",
      "--format", settings["format"],
      "--format-sort", ",".join(settings["formatSort"]),
      "--check-formats",
      # A watch URL with a playlist (&list=) clips its video, not the playlist.
      "--no-playlist",
      "--extractor-args", "generic:impersonate",
      "--output", f'{settings["downloadVideoPath"]}.%(ext)s',
    ]
    # fmt: on

    if getattr(sys, "frozen", False):
        ytdl_args.extend(["--ffmpeg-location", cp.ffmpegPath])

    cookies = settings["cookiefile"]
    cookiesFromBrowser = settings["cookiesFromBrowser"]

    # yt-dlp rejects --cookies and --cookies-from-browser together; catch it
    # here so the user gets a clear message instead of a mid-run yt-dlp abort.
    if cookies != "" and cookiesFromBrowser != "":
        logger.error(
            "Both --cookies (a cookies file) and --cookies-from-browser were provided, "
            "but they are mutually exclusive. Please specify only one.",
        )
        sys.exit(1)

    if cookies != "":
        ytdl_args.extend(["--cookies", cookies])
    elif cookiesFromBrowser != "":
        ytdl_args.extend(["--cookies-from-browser", cookiesFromBrowser])

    if settings["username"] != "" or settings["password"] != "":
        ytdl_args.extend(["--username", settings["username"]])
        ytdl_args.extend(["--password", settings["password"]])

    return ytdl_args


def selected_format_ids(ytdl_info: Dict) -> List[str]:
    """A multi-part video's info has its parts' entries and no format of its own, so no ids."""
    selected = ytdl_info.get("requested_formats") or [ytdl_info]
    return [f["format_id"] for f in selected if "format_id" in f]


def find_skipped_format_ids(
    preferredFormatIds: List[str],
    selectedFormatIds: List[str],
) -> List[str]:
    """The formats yt-dlp prefers but skipped as not downloadable: those it picks without
    --check-formats and not with it."""
    return [formatId for formatId in preferredFormatIds if formatId not in selectedFormatIds]


def parse_preferred_formats_output(stdout: str) -> Tuple[List[str], str]:
    """Split the output of `--print format_id --print formats_table` into the format ids yt-dlp
    picks before probing them (e.g. 137+251) and the formats table."""
    formatIds, _, formatsTable = stdout.partition("\n")
    return formatIds.strip().split("+"), formatsTable.rstrip("\n")


def count_preferred_downloads(stdout: str) -> int:
    """How many downloads the `--print format_id --print formats_table` output describes: yt-dlp
    prints the pair once per download, and a comma in the format or a playlist asks for several."""
    return sum(1 for line in stdout.splitlines() if line.split(" ", 1)[0] == "ID")


def stop_on_several_downloads() -> NoReturn:
    logger.error(
        "yt-dlp would download several files: a comma in --format, a playlist URL, or a video in several parts. "
        "The clipper script needs one video: join video and audio formats with + instead of a comma, "
        "use the URL of one video instead of a playlist, "
        "or download each part and clip it with --input-video.",
    )
    sys.exit(1)


def _is_video(ytdl_format: Dict) -> bool:
    return ytdl_format.get("vcodec", "none") != "none"


def _is_hdr(ytdl_format: Dict) -> bool:
    return ytdl_format.get("dynamic_range") not in {None, "SDR"}


def _video_codec(ytdl_format: Dict) -> str:
    """The codec family, e.g. vp9 for both "vp9" and "vp09.00.51.08"."""
    family = (ytdl_format.get("vcodec") or "").split(".")[0].lower()
    return {"vp09": "vp9", "avc1": "avc", "avc3": "avc"}.get(family, family)


def _quality(ytdl_format: Dict, reference: Dict) -> Tuple[float, ...]:
    """Video ranks by height, then frame rate, then video bitrate, then HDR over SDR. Bitrate
    counts only against a reference in the same codec: across codecs it does not measure quality
    (AV1 needs less than VP9). Audio ranks by bitrate."""
    if not _is_video(ytdl_format):
        return (ytdl_format.get("abr") or 0,)
    bitrate = reference.get("vbr") or 0
    if _video_codec(ytdl_format) == _video_codec(reference) and ytdl_format.get("vbr") and bitrate:
        bitrate = ytdl_format["vbr"]
    return (
        ytdl_format.get("height") or 0,
        ytdl_format.get("fps") or 0,
        bitrate,
        _is_hdr(ytdl_format),
    )


def _describe_quality(ytdl_format: Dict) -> str:
    if not _is_video(ytdl_format):
        return f"{ytdl_format.get('abr') or 0:g}k"
    fps = ytdl_format.get("fps")
    vbr = ytdl_format.get("vbr")
    bitrate = f" {vbr:.0f}k" if vbr else ""
    hdr = " HDR" if _is_hdr(ytdl_format) else ""
    return f"{ytdl_format.get('height') or 0}p{f'{fps:g}' if fps else ''}{bitrate}{hdr}"


def _describe_format(ytdl_format: Dict) -> str:
    return f"{ytdl_format['format_id']} ({_describe_quality(ytdl_format)})"


def describe_quality_drop(drop: Tuple[Dict, Dict]) -> str:
    skipped, selected = drop
    return (
        f"Cannot download format {_describe_format(skipped)}. "
        f"The best downloadable format is {_describe_format(selected)}."
    )


def find_quality_drops(
    ytdl_info: Dict,
    skippedFormatIds: List[str],
    followFormatOrder: bool = False,
) -> List[Tuple[Dict, Dict]]:
    """Each selected format that is lower quality than a skipped format of the same kind, paired
    with that skipped format. A skipped format can fall back to one of equal quality (e.g. another
    codec). With followFormatOrder, quality is the order of the info's formats, which yt-dlp sorts
    worst to best by the --format-sort in use."""
    formats = ytdl_info.get("formats", [])
    formatsById = {f["format_id"]: f for f in formats}
    position = {f["format_id"]: i for i, f in enumerate(formats)}

    def rank(ytdl_format: Dict, selected: Dict) -> Tuple[float, ...]:
        if followFormatOrder:
            return (position.get(ytdl_format.get("format_id"), -1),)
        return _quality(ytdl_format, selected)

    skipped = [formatsById[i] for i in skippedFormatIds if i in formatsById]
    drops = []
    for selected in ytdl_info.get("requested_formats") or [ytdl_info]:
        sameKind = [f for f in skipped if _is_video(f) == _is_video(selected)]
        best = max(sameKind, key=lambda f: rank(f, selected), default=None)
        if best is not None and rank(best, selected) > rank(selected, selected):
            drops.append((best, selected))
    return drops


def prompt_to_continue_on_quality_drop(
    drops: List[Tuple[Dict, Dict]],
    acceptLowerQuality: bool = False,
) -> None:
    if not drops:
        return

    for drop in drops:
        logger.warning(describe_quality_drop(drop))

    lowerFormats = " and ".join(_describe_format(selected) for _, selected in drops)
    chosen = f"format{'s' if len(drops) > 1 else ''} {lowerFormats}"
    if acceptLowerQuality:
        logger.info(f"Continuing with {chosen}, as --accept-lower-quality is set.")
        return

    try:
        answer = input(f"Continue with {chosen}? (y/n): ")
    except EOFError:
        # No one to answer, for example a scheduled run.
        logger.error(
            "No answer to the prompt. Pass --accept-lower-quality to continue without asking.",
        )
        sys.exit(1)
    if answer.strip().lower() in {"yes", "y"}:
        logger.info(f"Continuing with {chosen}.")
    else:
        logger.error("Stopped without making clips.")
        sys.exit(1)


# yt-dlp strips its colors when its stdout is piped, so color the rows ourselves.
_FORMAT_ROW_AVAILABLE_STYLE = "\x1b[1;32m"  # bold green: tested, downloadable, selected
_FORMAT_ROW_UNAVAILABLE_STYLE = "\x1b[2;31m"  # dim red: tested but not downloadable
_ANSI_RESET = "\x1b[0m"


def highlight_formats_table(
    formats_table: str,
    selectedFormatIds: Iterable[str],
    unavailableFormatIds: Iterable[str],
) -> str:
    """Color each row of the yt-dlp formats table by its probe result. A row's format id is its
    first token, so the header and separator rows never match and stay uncolored."""
    selected = set(selectedFormatIds)
    unavailable = set(unavailableFormatIds)

    highlightedLines = []
    for line in formats_table.splitlines():
        formatId = line.split(" ", 1)[0]
        if formatId in selected:
            highlightedLines.append(f"{_FORMAT_ROW_AVAILABLE_STYLE}{line}{_ANSI_RESET}")
        elif formatId in unavailable:
            highlightedLines.append(f"{_FORMAT_ROW_UNAVAILABLE_STYLE}{line}{_ANSI_RESET}")
        else:
            highlightedLines.append(line)

    return "\n".join(highlightedLines)


def show_formats_table(cs: ClipperState, formats_table: str) -> None:
    if not formats_table:
        return
    logger.info("Found the following audio/video formats: \n")
    # print without logger to use full console width
    # A blank line after the table, before the log lines resume.
    print(f"{formats_table}\n")
    printToLogFile(cs.clipper_paths, f"{Text.from_ansi(formats_table)}\n\n")


def check_for_quality_drop(cs: ClipperState, ytdl_args: List[str], ytdl_info: Dict) -> None:
    """Show the formats table with the rows colored by probe result, and ask before continuing
    when yt-dlp fell back to a lower quality format."""
    settings = cs.settings
    # The formats yt-dlp would pick without probing them, and the formats table. Comparing them with
    # the probed pick in ytdl_info finds a fallback through yt-dlp's documented --print fields.
    ytdl_args_preferred = ytdl_args.copy()
    ytdl_args_preferred.extend(
        ["--no-check-formats", "--print", "format_id", "--print", "formats_table"],
    )
    ytdl_args_preferred.extend([settings["videoPageURL"]])
    preferred_process = subprocess.run(
        args=ytdl_args_preferred,
        stdout=subprocess.PIPE,
        check=True,
    )
    # Piped, yt-dlp writes the table in the console code page (e.g. cp1252 on Windows). It is only shown.
    preferredOutput = preferred_process.stdout.decode("utf-8", errors="replace")
    # The probe can drop a download that failed, so a comma format may only show up here.
    if count_preferred_downloads(preferredOutput) > 1:
        stop_on_several_downloads()
    preferredFormatIds, formats_table = parse_preferred_formats_output(preferredOutput)

    selectedFormatIds = selected_format_ids(ytdl_info)
    skippedFormatIds = find_skipped_format_ids(preferredFormatIds, selectedFormatIds)
    # Shown before the question, so the user sees which formats could not be downloaded.
    show_formats_table(
        cs,
        highlight_formats_table(
            formats_table,
            selectedFormatIds=selectedFormatIds,
            unavailableFormatIds=skippedFormatIds,
        ),
    )
    prompt_to_continue_on_quality_drop(
        # A --format-sort of the user's own is their idea of quality; the default sort gets the
        # fixed order, which compares bitrate only within one codec.
        find_quality_drops(
            ytdl_info,
            skippedFormatIds,
            followFormatOrder=list(settings["formatSort"]) != DEFAULT_FORMAT_SORT,
        ),
        acceptLowerQuality=settings.get("acceptLowerQuality", False),
    )


def ytdl_bin_get_video_info(cs: ClipperState) -> Dict:
    """Return yt-dlp's video info, after showing its formats table with the rows colored by probe
    result and asking before a lower quality fallback."""
    settings = cs.settings

    ytdl_args = ytdl_bin_get_args_base(cs)

    # Check for yt-dlp updates if appropriate
    ytdl_bin_update(cs)

    # Get video info using yt-dlp
    ytdl_args_dump_json = ytdl_args.copy()
    ytdl_args_dump_json.extend(["--dump-json"])
    ytdl_args_dump_json.extend([settings["videoPageURL"]])

    ytdl_dumped_json_process = subprocess.run(
        args=ytdl_args_dump_json,
        stdout=subprocess.PIPE,
        check=True,
    )
    dumpedInfos = ytdl_dumped_json_process.stdout.decode("utf-8").splitlines()
    dumpedInfos = [line for line in dumpedInfos if line.strip()]
    if len(dumpedInfos) > 1:
        stop_on_several_downloads()
    if not dumpedInfos:
        logger.error(f"yt-dlp found no video at {settings['videoPageURL']}.")
        sys.exit(1)
    ytdl_info = json.loads(dumpedInfos[0])

    # The check is an extra: a failure in it never stops the clip. A deliberate stop (the answer
    # no, or a comma format) is a SystemExit, which passes through.
    try:
        check_for_quality_drop(cs, ytdl_args, ytdl_info)
    except Exception as error:
        # yt-dlp prints its own error; its full command line would only bury the warning.
        if isinstance(error, subprocess.CalledProcessError):
            error = f"yt-dlp failed with exit code {error.returncode}"
        logger.warning(
            f"Could not check whether yt-dlp fell back to a lower quality format ({error}). "
            "Continuing with the formats yt-dlp picked.",
        )

    # Download the full video if requested by user
    if settings["downloadVideo"]:
        ytdl_args_download = ytdl_args.copy()
        ytdl_args_download.extend([settings["videoPageURL"]])
        with subprocess_block("yt-dlp", logger=logger, action="download") as block:
            process = subprocess.run(args=ytdl_args_download, check=True)
            block.set_returncode(process.returncode)
        settings["downloadVideoPath"] = f"{settings['downloadVideoPath']}.mkv"

    return ytdl_info


def ytdl_bin_update(cs: ClipperState) -> None:
    settings = cs.settings
    cp = cs.clipper_paths

    if not getattr(sys, "frozen", False):
        return

    if settings["ytdlDir"]:
        logger.report(
            "Skipping check for yt-dlp updates as user specified their own location for yt-dlp.",
        )
        return

    if not settings["ytdlAutoUpdate"]:
        logger.report(
            "Skipping check for yt-dlp updates as user set --no-ytdl-auto-update option.",
        )
        return

    ytdl_old_version = ytdl_bin_get_version(cp)

    try:
        with subprocess_block("yt-dlp", logger=logger, action="update") as block:
            process = subprocess.run(
                args=[argvPath(cp.ytdlPath), "--update"],
                check=True,
                shell=False,
            )
            block.set_returncode(process.returncode)
    except subprocess.CalledProcessError:
        logger.warning("Failed to update yt-dlp. Try manually updating.")

    ytdl_new_version = ytdl_bin_get_version(cp)
    if ytdl_old_version != ytdl_new_version:
        logger.success(f"Updated yt-dlp to {ytdl_new_version}")
    else:
        logger.success(f"yt-dlp is up to date {ytdl_new_version}")


def ytdl_bin_get_subs(cs: ClipperState) -> None:
    cp = cs.clipper_paths
    settings = cs.settings

    settings["subsFileStem"] = f"{cp.clipsPath}/subs/{settings['titleSuffix']}"
    settings["subsFilePath"] = f"{settings['subsFileStem']}.{settings['autoSubsLang']}.vtt"

    ytdl_args = ytdl_bin_get_args_base(cs)

    # fmt: off
    ytdl_args.extend(
        [
            "--skip-download",
            "--write-subs",
            "--sub-format", "vtt",
            "--sub-langs", settings["autoSubsLang"],
            "--output", settings["subsFileStem"],
            settings["videoPageURL"],
        ],
    )
    # fmt: on

    with subprocess_block("yt-dlp", logger=logger, action="fetch subtitles") as block:
        process = subprocess.run(args=ytdl_args, check=True)
        block.set_returncode(process.returncode)
