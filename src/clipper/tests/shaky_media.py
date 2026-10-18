"""Small synthetic shaky clips with exact camera motion, for testing video stabilization.

A 640x360 window moves over a still, textured 960x600 frame by a known offset per frame (a slow pan
plus seeded shake), one sendcmd crop per frame. Each variant adds a condition stabilizers struggle
with; steady variants have no camera motion, so any motion a stabilizer adds is wrong.
Used by test_stabilization.py and sandbox/stabilization.
"""

import math
import random
import subprocess
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
    encode: tuple[str, ...] = LOSSLESS


CLIPS = {
    "plain": ShakyClip("textured scene"),
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
    # Distilled from a concert fan cam: a dark stage lit about once a second, rising 2.4 times
    # brighter over 4 frames, holding, and fading over 20, evenly over the whole frame
    "pulse": ShakyClip(
        "a dark scene with a light that pulses over the whole frame",
        after=(
            ",geq=lum='min(255,p(X,Y)*0.45*if(lt(mod(N,32),4),1+0.35*mod(N,32),"
            "if(lt(mod(N,32),12),2.4,2.4-0.07*(mod(N,32)-12))))':cb='p(X,Y)':cr='p(X,Y)'"
        ),
    ),
    "dim": ShakyClip(
        "a low contrast stretch",
        after=",eq=contrast=0.15:brightness=-0.1:enable='between(n,30,60)'",
    ),
    "dark": ShakyClip("underexposed", after=",lutyuv=y='16+val*0.18'"),
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
    # Fancams often carry a channel's logo, which stays put while the camera shakes
    "watermark": ShakyClip(
        "a textured logo fixed in the frame",
        after=(
            f"[shaky];testsrc2=s=200x70:r={FPS},trim=end_frame=1,loop=loop=-1:size=1[logo];"
            "[shaky][logo]overlay=x=40:y=270:shortest=1"
        ),
        scoredRows=(0, 240),
    ),
    # A dance practice in front of a tile wall: the match can lock onto the wrong tile
    "tiles": ShakyClip(
        "a wall of plain tiles smaller than the shake",
        base=f"color=c=0xb0a898:s={BASE_WIDTH}x{BASE_HEIGHT}:r={FPS},drawgrid=w=28:h=28:t=3:c=0x787068,noise=alls=6:allf=0",
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
    "flatgrain": ShakyClip(
        "steady flat gray with moving grain",
        graph=f"color=c=0x707070:s={WIDTH}x{HEIGHT}:r={FPS},noise=alls=14:allf=t",
        steady=True,
    ),
}


def windowPath(steady: bool) -> list[tuple[int, int]]:
    """The window's top-left corner per frame: a 40 px/s pan plus seeded shake, or a fixed spot."""
    rng = random.Random(1)
    path = []
    jitterX = jitterY = 0.0
    for frame in range(FPS * SECONDS):
        t = frame / FPS
        jitterX = 0.5 * jitterX + rng.gauss(0, 6)
        jitterY = 0.5 * jitterY + rng.gauss(0, 6)
        path.append((round(80 + 40 * t + jitterX), round(120 + 10 * math.sin(t) + jitterY)))
    return [path[0]] * len(path) if steady else path


def makeShakyClip(ffmpeg: str, name: str, folder: Path) -> Path:
    """The clip, made once per folder."""
    clip = CLIPS[name]
    video = folder / f"shaky-{name}.mp4"
    if video.exists():
        return video
    path = windowPath(clip.steady)
    frames = FPS * SECONDS
    commands = folder / f"shaky-{name}.cmd"
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
        angles = folder / f"shaky-{name}.rotate.cmd"
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
         "-c:v", "libx264", *clip.encode, "-pix_fmt", "yuv420p", video.name],
        check=True, cwd=folder,
    )  # fmt: skip
    return video
