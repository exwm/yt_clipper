"""Small synthetic shaky clips with exact camera motion, for testing video stabilization.

A 640x360 window moves over a still, textured 960x600 frame by a known offset per frame (a slow pan
plus seeded shake), one sendcmd crop per frame. Each variant adds a condition stabilizers struggle
with; steady variants have no camera motion, so any motion a stabilizer adds is wrong.
Used by test_stabilization.py and the stabilization evals.
"""

import hashlib
import math
import os
import random
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

FPS = 30
SECONDS = 3
WIDTH, HEIGHT = 640, 360
BASE_WIDTH, BASE_HEIGHT = 960, 600
# Every 7th frame from frame 9: the frames that flash or strobe
FLASH_FRAMES = tuple(range(9, FPS * SECONDS - 6, 7))
FLASHING = "+".join(f"eq(n,{frame})" for frame in FLASH_FRAMES)
CUT_FRAME = FPS * SECONDS // 2
# Distilled from a concert fan cam: a dark stage lit about once a second, jumping 69% brighter
# in a frame (as measured) then settling at 2.4 times over 3 more, holding, fading over 20, evenly
PULSING_LIGHT = (
    ",geq=lum='min(255,p(X,Y)*0.45*if(lt(mod(N,32),1),1,if(lt(mod(N,32),2),1.49,if(lt(mod(N,32),3),1.95,"
    "if(lt(mod(N,32),4),2.25,if(lt(mod(N,32),12),2.4,2.4-0.07*(mod(N,32)-12)))))))':cb='p(X,Y)':cr='p(X,Y)'"
)
# Clip folders of other recipe versions unused this long are removed
UNUSED_FOLDER_SECONDS = 7 * 24 * 3600
# Lossless, so the clip shows exactly the recipe; hard compression where the recipe calls for it
LOSSLESS = ("-qp", "0")
COMPRESSED = ("-crf", "34")


@dataclass(frozen=True)
class ShakyClip:
    description: str
    # Filters after the crop, in the window's coordinates
    after: str = ""
    # Filters on the full frame before the crop, in the scene's coordinates
    scene: str = ""
    # A whole lavfi graph in place of the cropped scene, for clips with nothing to track
    graph: str = ""
    # A lavfi source for the still scene, in place of the textured test pattern
    base: str = ""
    steady: bool = False
    # Rotation shake too, about the scene's center
    rotates: bool = False
    # The first frame after a cut: its motion from the frame before means nothing
    cutFrame: int | None = None
    # Rows scored for shake, when part of the frame (a logo) shakes once the rest is stabilized
    scoredRows: tuple[int, int] = (0, HEIGHT)
    # The shake's size: the standard deviation of each frame's random step, px
    shake: float = 6.0
    # The slow pan's speed, px/s
    pan: float = 40.0
    # Score shake with the clipper's own measure (vidstab_motions.shake: the cells' median, frames it
    # can match): a composite's subjects, saturated flashes and blurred frames throw off a whole-frame one
    cellShake: bool = False
    encode: tuple[str, ...] = LOSSLESS


CLIPS = {
    "plain": ShakyClip("textured scene"),
    # Half of real clips shake less than the clips here: a steadier hand, the same slow pan
    "gentle": ShakyClip("gentle handheld shake", shake=2.0),
    "flash": ShakyClip(
        "whole-frame flashes that clip highlights",
        after=f",lutyuv=y='min(val*2.2+60,255)':enable='{FLASHING}'",
    ),
    "strobe": ShakyClip(
        "a small light blinking in a corner",
        after=f",drawbox=x=520:y=20:w=100:h=100:color=white:t=fill:enable='{FLASHING}'",
    ),
    # vid.stab issue 55: flashing stage lights in a dark video. Fields lock onto whatever is lit.
    "stage": ShakyClip(
        "a dark stage with large lights that sweep and flash",
        scene=(
            ",lutyuv=y='16+val*0.25'[stage];"
            f"color=black:s={BASE_WIDTH}x{BASE_HEIGHT}:r={FPS},"
            "drawbox=x='300+250*sin(t*1.7)':y=120:w=180:h=180:color=white:t=fill:enable='lt(mod(n,8),4)',"
            "drawbox=x='520+200*sin(t*2.3+1)':y=320:w=220:h=160:color=white:t=fill:enable='gte(mod(n+3,10),5)',"
            "gblur=sigma=30[lights];[stage][lights]blend=all_mode=addition:shortest=1"
        ),
    ),
    "pulse": ShakyClip(
        "a dark scene with a light that pulses over the whole frame", after=PULSING_LIGHT
    ),
    # The same fan cam: the dancers fill the middle of the frame and move on their own
    "dancer": ShakyClip(
        "the pulsing light, with a subject in the middle moving on its own",
        # In the scene, so the camera shakes it too; the window's middle starts at (400, 300)
        scene=(
            f"[bg];testsrc=s=300x200:r={FPS},hue=h=200,eq=contrast=0.5[obj];"
            "[bg][obj]overlay=x='270+40*sin(n/7)':y='200+10*sin(n/5)':shortest=1"
        ),
        after=PULSING_LIGHT,
        # Above the subject: the shake measure follows the subject or the scene from frame to frame
        scoredRows=(0, 64),
    ),
    "dim": ShakyClip(
        "a low contrast stretch",
        after=",eq=contrast=0.15:brightness=-0.1:enable='between(n,30,60)'",
    ),
    # Also stands for underexposed clips with normal contrast, which stabilize like the plain clip
    "darkdim": ShakyClip(
        "underexposed and low contrast",
        after=",eq=contrast=0.35,lutyuv=y='16+val*0.2'",
    ),
    "grainy": ShakyClip(
        "heavy grain, compressed hard",
        after=",noise=alls=40:allf=t",
        encode=COMPRESSED,
    ),
    "occluder": ShakyClip(
        "an object a third of the frame wide crossing on its own",
        after=f"[bg];testsrc=s=220x300:r={FPS},hue=h=90[obj];[bg][obj]overlay=x='-220+10*n':y='40+20*sin(n/9)':shortest=1",
    ),
    "rotate": ShakyClip("rotation shake as well, as a hand-held camera adds", rotates=True),
    # A third of corpus clips have cuts: the motion across one means nothing
    "cut": ShakyClip(
        "a cut halfway to unrelated content, the camera still shaking",
        scene=f",split[first][second];[second]hflip,vflip[other];[first][other]overlay=enable='gte(n,{CUT_FRAME})'",
        cutFrame=CUT_FRAME,
    ),
    # A fifth of corpus clips repeat frames: 24 fps content stored at 30 repeats every 5th frame
    "repeats": ShakyClip("24 fps content stored at 30", after=f",fps=24,fps={FPS}"),
    # A dance practice in front of a tile wall: the match can lock onto the wrong tile
    "tiles": ShakyClip(
        "a wall of plain tiles smaller than the shake",
        base=f"color=c=0xb0a898:s={BASE_WIDTH}x{BASE_HEIGHT}:r={FPS},drawgrid=w=28:h=28:t=3:c=0x787068,noise=alls=6:allf=0",
    ),
    # Distilled from a dance practice: a nearly still camera before a wall of small tiles, dancers in
    # front, compressed. vid.stab's fields match tiles a row off and scatter; the cells measure little.
    "tilewall": ShakyClip(
        "a nearly still camera before small tiles, with dancers in front",
        base=f"color=c=0xb0a898:s={BASE_WIDTH}x{BASE_HEIGHT}:r={FPS},drawgrid=w=11:h=11:t=2:c=0x787068,noise=alls=6:allf=0",
        after=(
            f"[bg];testsrc=s=150x300:r={FPS},hue=h=200,eq=contrast=0.5[a];testsrc=s=150x300:r={FPS},hue=h=40,eq=contrast=0.5[b];"
            "[bg][a]overlay=x='180+60*sin(n/6)':y='60+20*sin(n/4)':shortest=1[s1];"
            "[s1][b]overlay=x='330+50*sin(n/5+1)':y='50+25*sin(n/3)':shortest=1"
        ),
        shake=0.6,
        encode=COMPRESSED,
        # Above the dancers: the shake measure follows them or the wall from frame to frame
        scoredRows=(0, 48),
    ),
    # A composite, distilled from one real concert clip on all its traits at once (combo_coverage.py
    # picked it as covering the most trait pairs no clip had): flat, grainy, flashing, 24 fps in 30,
    # with a subject drifting and swaying in front, and one frame blurred past matching
    "flashconcert": ShakyClip(
        "flashes on a flat, grainy scene with a subject, a blurred frame, 24 fps in 30",
        scene=(
            f"[bg];testsrc=s=260x160:r={FPS},trim=end_frame=1,loop=loop=-1:size=1,hue=h=200,eq=contrast=0.6[obj];"
            f"[bg][obj]overlay=x='270+n*40/{FPS}+12*sin(n/7)':y='220+4.0*sin(n/5)':shortest=1"
        ),
        after=(
            f",eq=contrast=0.65:brightness=-0.03,lutyuv=y='min(val*2.2+60,255)':enable='{FLASHING}',"
            f"gblur=sigma=25:enable='eq(n,60)',noise=alls=45:allf=t,fps=24,fps={FPS}"
        ),
        shake=2.0,
        encode=COMPRESSED,
        cellShake=True,
    ),
    # A composite of a dim stage clip (combo_coverage.py's next pick): a light that steps up once, a
    # cut, grain, and a subject. It matches the real clip on 8 of 9 trait levels: the subject's own
    # motion reads low, as subject_motion follows either the subject or the scene behind it.
    "dimstage": ShakyClip(
        "a dim stage, a light that steps up once, a cut, a subject drifting",
        scene=(
            f"[bg];testsrc=s=120x200:r={FPS},hue=h=200,eq=contrast=0.6[obj];"
            "[bg][obj]overlay=x='400+9*sin(n/7)':y='220+3*sin(n/5)':shortest=1,"
            f"split[first][second];[second]hflip,vflip[other];[first][other]overlay=enable='gte(n,{CUT_FRAME})'"
        ),
        after=",lutyuv=y='val*0.95-52',lutyuv=y='val*1.17':enable='gte(n,60)',noise=alls=10:allf=t",
        shake=1.8,
        cutFrame=CUT_FRAME,
        cellShake=True,
    ),
    # A composite of a calm handheld clip (combo_coverage.py's next pick): little shake, one light
    # step, one cut. At this little shake the slow pan rounds to the same pixel on about 6% of frames,
    # which is the real clip's level of repeated frames.
    "calmcut": ShakyClip(
        "little shake, a light that steps up once, a cut",
        scene=(
            f",split[first][second];[second]hflip,vflip,negate[other];"
            f"[first][other]overlay=enable='gte(n,{CUT_FRAME})'"
        ),
        # One repeated frame and one pixel of pan a frame: shake reads as medium motion
        after=",lutyuv=y='val*0.75+20',lutyuv=y='min(255,val*1.10)':enable='gte(n,60)',loop=loop=1:size=1:start=30",
        shake=0.0,
        pan=30.0,
        cutFrame=CUT_FRAME,
    ),
    # A composite of a calm stage clip with 24 fps content stored at 30 (combo_coverage.py's next
    # pick): calmcut's levels, with every fifth frame repeated
    "calmrepeats": ShakyClip(
        "little shake, a light that steps up once, a cut, 24 fps content stored at 30",
        scene=(
            f",split[first][second];[second]hflip,vflip,negate[other];"
            f"[first][other]overlay=enable='gte(n,{CUT_FRAME})'"
        ),
        after=f",lutyuv=y='val*0.75+20',lutyuv=y='min(255,val*1.10)':enable='gte(n,60)',fps=24,fps={FPS}",
        # The real clip is nearly still. One pixel per 24 fps frame: slower, rounding repeats more
        # frames; faster or shakier, the motion reads medium
        shake=0.0,
        pan=24.0,
        cutFrame=CUT_FRAME,
    ),
    # A composite of a bright, nearly still clip (combo_coverage.py's next pick): a subject the camera
    # follows, light grain, a cut, and one repeated frame. The subject holds still in the middle of the
    # frame while the scene pans one pixel a frame, so it moves apart from the scene by one pixel.
    "brightsubject": ShakyClip(
        "bright, nearly still, a subject the camera follows, light grain, a cut",
        after=(
            # Brightened by adding, not scaling, which would flatten the contrast
            f",lutyuv=y='min(255,val+35)'[bg];testsrc=s=200x110:r={FPS},trim=end_frame=1,loop=loop=-1:size=1,"
            "hue=h=200,eq=contrast=0.6[obj];[bg][obj]overlay=x=220:y=125:shortest=1,"
            # After the cut the frame is a negative brought back to the same mean: nothing matches across it
            f"split[first][second];[second]negate,lutyuv=y='val+53'[other];[first][other]overlay=enable='gte(n,{CUT_FRAME})',"
            "noise=alls=8:allf=t,loop=loop=1:size=1:start=30"
        ),
        shake=0.0,
        pan=30.0,
        cutFrame=CUT_FRAME,
        cellShake=True,
    ),
    # A composite of a bright, calm clip: nearly still, medium contrast, one repeated frame. Its subject
    # motion reads low (the real clip's is medium).
    "brightcalm": ShakyClip(
        "bright, medium contrast, nearly still",
        after=",lutyuv=y='val*0.8+26',loop=loop=1:size=1:start=30",
        shake=0.0,
        pan=30.0,
    ),
    # A composite of a calm stage clip: a subject the camera follows (held still mid-frame, as in
    # brightsubject, so it moves apart from the scene by the pan's pixel a frame), one repeated frame.
    "calmstage": ShakyClip(
        "nearly still, a dim low contrast stage, a light that steps up once, grain, a subject the camera follows",
        after=(
            f"[bg];testsrc=s=200x110:r={FPS},trim=end_frame=1,loop=loop=-1:size=1,hue=h=200,eq=contrast=0.6[obj];"
            "[bg][obj]overlay=x=220:y=125:shortest=1,"
            "eq=contrast=0.6,lutyuv=y='val*0.42+12',lutyuv=y='val*1.12':enable='gte(n,60)',"
            "noise=alls=7:allf=t,loop=loop=1:size=1:start=45"
        ),
        shake=0.0,
        pan=30.0,
    ),
    # A composite of a dark, shaky concert clip (combo_coverage.py's next pick): flashes on a dim, flat
    # stage, grain, a cut, one repeated frame, and a subject the shaking camera follows (held
    # mid-frame, it moves apart from the scene by the whole shake)
    "darkflashes": ShakyClip(
        "flashes on a dim, flat, grainy stage, shaking, a cut, a subject the camera follows",
        after=(
            f"[bg];testsrc=s=200x110:r={FPS},trim=end_frame=1,loop=loop=-1:size=1,hue=h=90[obj];"
            "[bg][obj]overlay=x=220:y=125:shortest=1,"
            f"eq=contrast=0.45,lutyuv=y='val*0.45+8',lutyuv=y='min(val*1.6+20,255)':enable='{FLASHING}',"
            "noise=alls=5:allf=t,"
            # Cut to the negative of the whole frame, subject too, so nothing matches across it
            f"split[first][second];[second]negate,lutyuv=y='val*0.3'[other];[first][other]overlay=enable='gte(n,{CUT_FRAME})',"
            "loop=loop=1:size=1:start=30"
        ),
        cutFrame=CUT_FRAME,
        cellShake=True,
    ),
    "gradient": ShakyClip(
        "a steady, smooth gradient, banded by hard compression",
        graph=f"gradients=s={WIDTH}x{HEIGHT}:r={FPS}:c0=0x203040:c1=0x405060:speed=0,noise=alls=4:allf=t",
        steady=True,
        encode=COMPRESSED,
    ),
    "skyobject": ShakyClip(
        "a steady, mostly flat sky with one small textured object",
        graph=(
            f"color=c=0x8090b0:s={WIDTH}x{HEIGHT}:r={FPS},noise=alls=6:allf=t[sky];"
            f"testsrc2=s=80x80:r={FPS}[obj];[sky][obj]overlay=x=280:y=140:shortest=1"
        ),
        steady=True,
    ),
}


# Each clip's measured traits (clip_character.py) must fall in these ranges. A shaky clip keeps the
# plain clip's levels except for the traits it stands for, whose ranges come from the real clips
# surveyed (real footage and clipper outputs): so each clip tests one thing, and a recipe
# that drifts from the footage it stands for fails here. Motion is the shake of the strongest real
# handheld clips (the survey's 75th percentile to its largest, at this size).
SHAKY_TRAITS = {
    "brightness": (100, 170),
    "brightness_changes": (0, 0.01),
    "brightness_jump": (0, 0.05),
    "contrast": (55, 90),
    "repeats": (0, 0.01),
    "no_match": (0, 0.01),
    "motion": (8, 31),
    "grain": (0, 1),
    "subject_motion": (0, 0.5),
}
STEADY_TRAITS = {"brightness_changes": (0, 0.01), "repeats": (0, 0.01)}
# combo_coverage.py's trait levels (from the third survey of real clips): thirds of the
# surveyed clips' values, or none / some / lots for traits that are often zero. The composites name a
# level per trait, so a new survey changes only this table.
LEVELS = {
    "brightness": {"low": (40, 81.6), "mid": (81.6, 123.2), "high": (123.2, 190)},
    "brightness_changes": {"none": (0, 0.001), "some": (0.001, 0.0244), "lots": (0.0244, 0.4)},
    "brightness_jump": {"low": (0, 0.0333), "mid": (0.0333, 0.199), "high": (0.199, 1.6)},
    "contrast": {"low": (10, 49.8), "mid": (49.8, 62.1), "high": (62.1, 90)},
    "repeats": {"none": (0, 0.001), "some": (0.001, 0.076), "lots": (0.076, 0.3)},
    "no_match": {"none": (0, 0.001), "some": (0.001, 0.0161), "lots": (0.0161, 0.4)},
    "motion": {"low": (0.1, 1.85), "mid": (1.85, 5.96), "high": (5.96, 31)},
    "grain": {"low": (0, 2.76), "mid": (2.76, 6.38), "high": (6.38, 25)},
    "subject_motion": {"low": (0, 0.233), "mid": (0.233, 1.26), "high": (1.26, 10)},
}


def atLevels(**levels: str) -> dict[str, tuple[float, float]]:
    return {trait: LEVELS[trait][level] for trait, level in levels.items()}


TRAITS: dict[str, dict[str, tuple[float, float]]] = {
    "plain": {},
    # A steady hand holds still for the odd frame
    "gentle": {"motion": (1, 8), "repeats": (0, 0.02)},
    # Real flashes jump up to 1.6 times the darker frame
    "flash": {"brightness_changes": (0.1, 0.4), "brightness_jump": (0.5, 1.6)},
    "strobe": {"brightness_changes": (0.1, 0.4), "brightness_jump": (0.03, 0.1)},
    "stage": {
        "brightness": (60, 110),
        "brightness_changes": (0.2, 0.6),
        "brightness_jump": (0.5, 1.6),
    },
    # The fan cam's light jumped 69% in a frame, from a stage at about 50
    "pulse": {
        "brightness": (60, 130),
        "brightness_changes": (0.2, 0.5),
        "brightness_jump": (0.6, 0.8),
        "grain": (0, 8),
    },
    # The subject is flatter than the scene. Real subjects move apart from the scene by 0.9 px a
    # frame in half the clips, 2 in the fan cam, 2.9 in a tenth (at this size)
    "dancer": {
        "brightness": (60, 130),
        "brightness_changes": (0.2, 0.5),
        "brightness_jump": (0.6, 0.8),
        "contrast": (45, 90),
        "grain": (2, 20),
        "subject_motion": (1, 6),
    },
    "dim": {"brightness_changes": (0.01, 0.05), "brightness_jump": (0.2, 0.6)},
    # Below the darkest tenth of real clips (brightness 47)
    "darkdim": {"brightness": (15, 50), "contrast": (2, 10)},
    # Real clips leave 0.3 to 23 levels between frames, half above 3.6
    "grainy": {"grain": (5, 25)},
    "occluder": {"grain": (5, 20)},
    "rotate": {"no_match": (0.05, 0.3), "grain": (5, 25)},
    "cut": {"no_match": (0.005, 0.05)},
    # A tenth of real clips repeat more than 29% of frames
    "repeats": {"repeats": (0.15, 0.3)},
    "tiles": {"brightness": (130, 190), "contrast": (10, 35)},
    # vid.stab's fields agree on 1-34% of real shaky fan cams' frames (the median frame), 5% on the dance practice
    "tilewall": {
        "contrast": (20, 40),
        "grain": (5, 25),
        "subject_motion": (1, 10),
        "field_consensus": (0.01, 0.34),
    },
    # Composites: each trait at the real clip's level
    "flashconcert": atLevels(
        brightness="mid",
        brightness_changes="lots",
        brightness_jump="high",
        contrast="low",
        repeats="lots",
        no_match="lots",
        motion="mid",
        grain="high",
        subject_motion="mid",
    ),
    # Subject motion low here, medium in the real clip
    "dimstage": atLevels(
        brightness="low",
        brightness_changes="some",
        brightness_jump="mid",
        contrast="mid",
        repeats="none",
        no_match="some",
        motion="mid",
        grain="mid",
        subject_motion="low",
    ),
    "calmcut": atLevels(
        brightness="mid",
        brightness_changes="some",
        brightness_jump="mid",
        contrast="mid",
        repeats="some",
        no_match="some",
        motion="low",
        grain="low",
        subject_motion="low",
    ),
    "calmrepeats": atLevels(
        brightness="mid",
        brightness_changes="some",
        brightness_jump="mid",
        contrast="mid",
        repeats="lots",
        no_match="some",
        motion="low",
        grain="low",
        subject_motion="low",
    ),
    "brightsubject": atLevels(
        brightness="high",
        brightness_changes="none",
        brightness_jump="low",
        contrast="high",
        repeats="some",
        no_match="some",
        motion="low",
        grain="mid",
        subject_motion="mid",
    ),
    # Subject motion low here, medium in the real clip
    "brightcalm": atLevels(
        brightness="high",
        brightness_changes="none",
        brightness_jump="low",
        contrast="mid",
        repeats="some",
        no_match="none",
        motion="low",
        grain="low",
        subject_motion="low",
    ),
    "calmstage": atLevels(
        brightness="low",
        brightness_changes="some",
        brightness_jump="mid",
        contrast="low",
        repeats="some",
        no_match="none",
        motion="low",
        grain="mid",
        subject_motion="mid",
    ),
    "darkflashes": atLevels(
        brightness="low",
        brightness_changes="lots",
        brightness_jump="high",
        contrast="low",
        repeats="some",
        no_match="some",
        motion="high",
        grain="mid",
        subject_motion="high",
    ),
    "gradient": {"no_match": (0.9, 1), "contrast": (40, 80)},
    "skyobject": {"motion": (0, 0.5), "contrast": (5, 30), "grain": (0, 8)},
}


def traitRanges(name: str) -> dict[str, tuple[float, float]]:
    """The ranges a clip's measured traits must fall in."""
    return {**(STEADY_TRAITS if CLIPS[name].steady else SHAKY_TRAITS), **TRAITS[name]}


def windowPath(steady: bool, shake: float = 6.0, pan: float = 40.0) -> list[tuple[int, int]]:
    """The window's top-left corner per frame: a slow pan plus seeded shake, or a fixed spot."""
    rng = random.Random(1)
    path = []
    jitterX = jitterY = 0.0
    for frame in range(FPS * SECONDS):
        t = frame / FPS
        jitterX = 0.5 * jitterX + rng.gauss(0, shake)
        jitterY = 0.5 * jitterY + rng.gauss(0, shake)
        path.append((round(80 + pan * t + jitterX), round(120 + 10 * math.sin(t) + jitterY)))
    return [path[0]] * len(path) if steady else path


def makeShakyClip(ffmpeg: str, name: str, folder: Path) -> Path:
    """The clip, made once per folder. Safe when several processes share the folder: each writes its
    own files and moves the clip into place whole."""
    clip = CLIPS[name]
    video = folder / f"shaky-{name}.mp4"
    if video.exists():
        return video
    path = windowPath(clip.steady, clip.shake, clip.pan)
    frames = FPS * SECONDS
    stem = f"shaky-{name}.{os.getpid()}"
    commands = folder / f"{stem}.cmd"
    # exact=1 keeps the crop on odd pixels too, where yuv420 would round it to even
    commands.write_text(
        "".join(f"{i / FPS:.6f} crop x {x}, crop y {y};\n" for i, (x, y) in enumerate(path)),
        encoding="utf-8",
    )
    still = (
        f"{clip.base},trim=end_frame={frames}"
        if clip.base
        else (
            f"testsrc2=s={BASE_WIDTH}x{BASE_HEIGHT}:r={FPS}:d=1,trim=end_frame=1,loop=loop=-1:size=1,"
            f"noise=alls=30:allf=0,trim=end_frame={frames},setpts=N/{FPS}/TB"
        )
    )
    rotation = ""
    if clip.rotates:
        rng = random.Random(2)
        angles = folder / f"{stem}.rotate.cmd"
        angles.write_text(
            "".join(
                f"{i / FPS:.6f} rotate angle {rng.gauss(0, 0.012) if i else 0:.5f};\n"
                for i in range(frames)
            ),
            encoding="utf-8",
        )
        rotation = f",sendcmd=f='{angles.name}',rotate=angle=0:c=none"
    x0, y0 = path[0]
    graph = clip.graph and f"{clip.graph},trim=end_frame={frames}"
    if not graph:
        graph = (
            f"{still}{clip.scene}{rotation},sendcmd=f='{commands.name}',"
            f"crop=w={WIDTH}:h={HEIGHT}:x={x0}:y={y0}:exact=1{clip.after}"
        )
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", graph, "-frames:v", str(frames),
         "-c:v", "libx264", *clip.encode, "-pix_fmt", "yuv420p", f"{stem}.mp4"],
        check=True, cwd=folder,
    )  # fmt: skip
    (folder / f"{stem}.mp4").replace(video)
    return video


def mediaFolder(ffmpeg: str) -> Path:
    """A folder kept between test runs for the clips, named for what makes them: this file's recipes
    and the ffmpeg version. A changed recipe or ffmpeg gets a new folder."""
    version = subprocess.run(
        [ffmpeg, "-version"], capture_output=True, text=True, check=True
    ).stdout.splitlines()[0]
    key = hashlib.sha256(Path(__file__).read_bytes() + version.encode()).hexdigest()[:16]
    root = Path(tempfile.gettempdir()) / "yt_clipper-shaky-media"
    folder = root / key
    folder.mkdir(parents=True, exist_ok=True)
    # Marked as used, so another version's cleanup keeps it: workspaces may run different recipes
    os.utime(folder)
    for other in root.iterdir():
        if (
            other != folder
            and other.is_dir()
            and time.time() - other.stat().st_mtime > UNUSED_FOLDER_SECONDS
        ):
            shutil.rmtree(other, ignore_errors=True)
    return folder
