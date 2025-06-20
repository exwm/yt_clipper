from fractions import Fraction
from typing import Optional, Tuple

from clipper.clipper_types import DictStrAny
from clipper.ytc_logger import logger


def getFfmpegVideoCodecArgs(
    videoCodec: str,
    cbr: Optional[int],
    mp: DictStrAny,
    mps: DictStrAny,
    qmax: int,
    qmin: int,
) -> Tuple[str, str, str]:
    if videoCodec in {"vp9", "vp8"}:
        return getFfmpegVideoCodecVpx(
            videoCodec=videoCodec,
            cbr=cbr,
            mp=mp,
            mps=mps,
            qmax=qmax,
            qmin=qmin,
        )

    if videoCodec == "h264":
        return getFfmpegVideoCodecH264(cbr=cbr, mp=mp, mps=mps, qmax=qmax, qmin=qmin)

    if videoCodec == "h264_vulkan":
        return getFfmpegVideoCodecH264Vulkan(cbr=cbr, mp=mp, mps=mps, qmax=qmax, qmin=qmin)

    if videoCodec == "h264_nvenc":
        return getFfmpegVideoCodecH264Nvenc(cbr=cbr, mp=mp, mps=mps, qmax=qmax, qmin=qmin)

    raise ValueError(f"Invalid video codec: {videoCodec}")


def getFfmpegVideoCodecVpx(
    videoCodec: str,
    cbr: Optional[int],
    mp: DictStrAny,
    mps: DictStrAny,
    qmax: int,
    qmin: int,
) -> Tuple[str, str, str]:
    if mps["minterpFPS"] is not None:
        fps_arg = f'-r {mps["minterpFPS"]}'
    elif not mp["isVariableSpeed"]:
        fps_arg = f'-r ({mps["r_frame_rate"]}*{mp["speed"]})'
    else:
        fps_arg = "-fps_mode vfr"

    sdr_args = "-pix_fmt yuv420p"
    hdr_args = "-profile:v 2 -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc"

    dynamic_range_args = sdr_args
    if mps["enableHDR"]:
        if videoCodec == "vp8":
            logger.warning("HDR output was requested but vp8 does not support HDR.")
        else:
            dynamic_range_args = hdr_args

    video_codec_args = " ".join(
        (
            f"-c:v libvpx-vp9" if videoCodec != "vp8" else f"-c:v libvpx",
            dynamic_range_args,
            f"-slices 8",
            f"-aq-mode 4 -row-mt 1 -tile-columns 6 -tile-rows 2" if videoCodec != "vp8" else "",
            f'-qmin {qmin} -crf {mps["crf"]} -qmax {qmax}' if mps["targetSize"] <= 0 else "",
            f'-b:v {mps["targetMaxBitrate"]}k' if cbr is None else f"-b:v {cbr}MB",
            f'-force_key_frames 1 -g {mp["averageSpeed"] * Fraction(mps["r_frame_rate"])}',
        ),
    )
    video_codec_input_args = ""
    video_codec_output_args = " ".join(("-f webm", fps_arg))
    return video_codec_args, video_codec_input_args, video_codec_output_args


def getFfmpegVideoCodecH264(
    cbr: Optional[int],
    mp: DictStrAny,
    mps: DictStrAny,
    qmax: int,
    qmin: int,
) -> Tuple[str, str, str]:
    """Following recommendations from https://www.lighterra.com/papers/videoencodingh264"""
    fps_arg = ""
    if not mps["h264DisableReduceStutter"]:
        if mps["minterpFPS"] is not None:
            fps_arg = f'-r {mps["minterpFPS"]}'
        elif not mp["isVariableSpeed"]:
            fps_arg = f'-r ({mps["r_frame_rate"]}*{mp["speed"]})'

    if mp["isVariableSpeed"]:
        fps_arg = "-fps_mode vfr"

    pixel_count = mps["width"] * mps["height"]

    # The me_method and me_range have a fairly significant impact on encoding speed and could be tweaked
    # Currently going with a high me_method (umh vs the default hex), and a moderate me_range (32 for higher resolutions vs the default 16)
    me_range = 16 if pixel_count < (1800 * 1000) else 32

    sdr_args = "-pix_fmt yuv420p"
    hdr_args = (
        "-pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc"
    )

    dynamic_range_args = sdr_args
    if mps["enableHDR"]:
        dynamic_range_args = hdr_args

    video_codec_args = " ".join(
        (
            f"-c:v libx264",
            f"-movflags write_colr",
            dynamic_range_args,
            f'-qmin 3 -crf {mps["crf"]} -qmax {qmax}' if mps["targetSize"] <= 0 else "",
            f'-b:v {mps["targetMaxBitrate"]}k' if cbr is None else f"-b:v {cbr}MB",
            f'-force_key_frames 1 -g {mp["averageSpeed"] * Fraction(mps["r_frame_rate"])}',
            # video_track_timescale = 2^4 * 3^2 * 5^2 * 7 * 11 * 13 * 23, max is ~2E9
            f" -video_track_timescale 82882800",
            "-bf 5",
            "-refs 4",
            "-qcomp 0.9",
            f"-aq-mode 4",
            "-rc-lookahead 40",
            "-weightb 1 -weightp 2",
            "-direct-pred auto",
            "-b-pyramid none",
            "-me_method umh",
            f"-me_range {me_range}",
            "-psy-rd 1.0:1.0",
            "-fastfirstpass 1",
            "-keyint_min 1",
            "-trellis 2",
            "-x264-params rc-lookahead=40",
        ),
    )

    video_codec_input_args = ""
    video_codec_output_args = " ".join(("-f mp4", fps_arg))
    return video_codec_args, video_codec_input_args, video_codec_output_args


def getFfmpegVideoCodecH264Vulkan(
    cbr: Optional[int],
    mp: DictStrAny,
    mps: DictStrAny,
    qmax: int,
    qmin: int,
) -> Tuple[str, str, str]:
    fps_arg = ""
    if not mps["h264DisableReduceStutter"]:
        if mps["minterpFPS"] is not None:
            fps_arg = f'-r {mps["minterpFPS"]}'
        elif not mp["isVariableSpeed"]:
            fps_arg = f'-r ({mps["r_frame_rate"]}*{mp["speed"]})'

    if mp["isVariableSpeed"]:
        fps_arg = "-fps_mode vfr"

    sdr_args = "-pix_fmt vulkan"
    # x2rgb10 may better support 10-bit HDR output with vulkan in the future
    # It doesn't seem to be allowed currently however, only the vulkan pixel format works with vulkan encoders
    # See https://patchwork.ffmpeg.org/project/ffmpeg/patch/1587532983-20287-1-git-send-email-fei.w.wang@intel.com/#55407
    hdr_args = "-pix_fmt vulkan -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc"

    dynamic_range_args = sdr_args
    if mps["enableHDR"]:
        dynamic_range_args = hdr_args
    video_codec_args = " ".join(
        (
            f"-c:v h264_vulkan",
            f"-movflags write_colr",
            dynamic_range_args,
            "-quality 0",
            "-rc_mode vbr",
            "-tune hq",
            # i_qfactor = QP factor between P and I frames,
            # b_qfactor = between P and B frames.
            "-i_qfactor 0.75 -b_qfactor 1.1",
            f"-qmin 3 -qmax {qmax}" if mps["targetSize"] <= 0 else "",
            f'-b:v {mps["targetMaxBitrate"]}k' if cbr is None else f"-b:v {cbr}MB",
            f'-bufsize {mps["targetMaxBitrate"]}k' if cbr is None else f"-bufsize {cbr}MB",
            f'-maxrate {mps["targetMaxBitrate"]*4}k' if cbr is None else f"-maxrate {cbr*4}MB",
            f'-force_key_frames 1 -g {mp["averageSpeed"] * Fraction(mps["r_frame_rate"])}',
            # video_track_timescale = 2^4 * 3^2 * 5^2 * 7 * 11 * 13 * 23, max is ~2E9
            f" -video_track_timescale 82882800",
            "-qcomp 0.9",
            "-bf 5",
            "-refs 4",
            # x264 options that do not apply to h264_vulkan
            # f"-aq-mode 4",
            # "-weightb 1 -weightp 2",
            # "-direct-pred auto",
            # "-b-pyramid none",
            # "-me_method umh",
            # f"-me_range {me_range}",
            # "-psy-rd 1.0:1.0",
            # "-fastfirstpass 1",
            # "-x264-params rc-lookahead=40",
            "-keyint_min 1",
            "-trellis 2",
            # explicit defaults for h264_vulkan
            "-b_depth 1",
            "-async_depth 2",
        ),
    )

    video_codec_input_args = "-hwaccel vulkan -hwaccel_output_format vulkan"
    video_codec_output_args = " ".join(("-f mp4", fps_arg))
    return video_codec_args, video_codec_input_args, video_codec_output_args


def getFfmpegVideoCodecH264Nvenc(
    cbr: Optional[int],
    mp: DictStrAny,
    mps: DictStrAny,
    qmax: int,
    qmin: int,
) -> Tuple[str, str, str]:
    fps_arg = ""
    if not mps["h264DisableReduceStutter"]:
        if mps["minterpFPS"] is not None:
            fps_arg = f'-r {mps["minterpFPS"]}'
        elif not mp["isVariableSpeed"]:
            fps_arg = f'-r ({mps["r_frame_rate"]}*{mp["speed"]})'

    if mp["isVariableSpeed"]:
        fps_arg = "-fps_mode vfr"

    sdr_args = "-pix_fmt cuda"
    # h264_nvenc does not support 10-bit HDR output
    hdr_args = "-pix_fmt cuda -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc"

    dynamic_range_args = sdr_args
    if mps["enableHDR"]:
        dynamic_range_args = hdr_args
    
    video_codec_args = " ".join(
        (
            f"-c:v h264_nvenc",
            f"-movflags write_colr",
            dynamic_range_args,
            "-rc vbr",
            # CQ (Constant Quality) mode settings - only when not using CBR
            f"-cq {mps['crf']}" if cbr is None and mps["targetSize"] <= 0 else "",
            f"-qmin 3 -qmax {qmax}" if mps["targetSize"] <= 0 else "",
            f'-b:v {mps["targetMaxBitrate"]}k' if cbr is None else f"-b:v {cbr}MB",
            f'-maxrate {mps["targetMaxBitrate"]*2}k' if cbr is None else f"-maxrate {cbr*2}MB",
            f'-force_key_frames 1 -g {mp["averageSpeed"] * Fraction(mps["r_frame_rate"])}',
            "-qcomp 0.9",
            # NVENC specific settings - optimized for latency tolerant high quality encoding
            "-tune hq",
            "-preset p6",
            "-bf 4",  # There are no devices that support more than 4 B-frames currently
            "-rc-lookahead 40",
            "-spatial-aq 1",
            "-aq-strength 12",
            "-keyint_min 1",
        ),
    )

    video_codec_input_args = "-hwaccel cuda -hwaccel_output_format cuda"
    video_codec_output_args = " ".join(("-f mp4", fps_arg))
    return video_codec_args, video_codec_input_args, video_codec_output_args
