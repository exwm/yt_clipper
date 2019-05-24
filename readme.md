# yt_clipper

## Browser Support

- Works best on Chrome with YouTube video in theater mode.
- You may need to refresh the video page and ensure this user script is active.
- Firefox, Opera, and most Chromium-based browsers not fully tested, but reportedly work as intended.
- Other browsers may or may not work as intended.

## Related Scripts

- Check out the companion script for copying gfy links from gfycat as reddit markdown at <https://openuserjs.org/scripts/elwm/gfy2md>.

## Source Code

- The version-controlled source code is available at <https://github.com/exwm/yt_clipper>.

## Table of Contents

- [yt_clipper](#ytclipper)
  - [Browser Support](#browser-support)
  - [Related Scripts](#related-scripts)
  - [Source Code](#source-code)
  - [Table of Contents](#table-of-contents)
  - [Terminology](#terminology)
  - [Markup Script Hotkeys](#markup-script-hotkeys)
    - [Marker Hotkeys](#marker-hotkeys)
    - [Cropping Hotkeys](#cropping-hotkeys)
    - [Video Playback and Preview Hotkeys](#video-playback-and-preview-hotkeys)
    - [Save and Upload Hotkeys](#save-and-upload-hotkeys)
  - [Useful YouTube Controls](#useful-youtube-controls)
  - [Tips](#tips)
    - [User Script Tips](#user-script-tips)
    - [Clipper Script Tips](#clipper-script-tips)
  - [Encoding Settings Guide](#encoding-settings-guide)
    - [Articles on CRF and vp9 Encoding](#articles-on-crf-and-vp9-encoding)
    - [Tips](#tips-1)
    - [Gamma Correction](#gamma-correction)
  - [Clipper Script Usage](#clipper-script-usage)
  - [Clipper Script Installation](#clipper-script-installation)
  - [Clipper Script Dependencies](#clipper-script-dependencies)
  - [Markup Script Change Log](#markup-script-change-log)
  - [Clipper Script (Installation) Change Log](#clipper-script-installation-change-log)

## Terminology

- `Markup script` refers to this user script and is used to mark up YouTube videos before creating webm clips.
- `Clipper script` refers to the python script or installation that consumes marker data (either as .json or embedded into the script) to generate webm clips.

## Markup Script Hotkeys

### Marker Hotkeys

**alt+shift+A:** Toggle hotkeys on/off.

**A:** Add marker at current time (start = green, end = yellow, selected = black center). Multiple marker pairs can be added.

**Z:** Undo last marker.

**shift+Z:** Redo last undone marker.

**shift+mouseover:** Toggle marker pair editor. Must be done over an end marker (yellow). Selected marker pairs have a black center.

- Edit pair crop or speed multiplier.
- Edit `Title Prefix` that will be prepended to the `Title Suffix` and used in the webm name for the marker pair.

<img src="https://i.imgur.com/XfD4Yy5.png">

- While a pair is selected use **shift+Q/shift+A** to move the start/end marker to current time.
  - Adjust marker position more precisely using the **<** and **>** keys to view YouTube videos frame by frame.
- While a pair is selected use **alt+Z** to delete the pair.

**W:** Global settings editor:

<img src="https://i.imgur.com/FGCxAiq.png">

1. Change default new marker speed or crop. Any new markers added will use these defaults, but this will not update existing markers. To update existing markers to the default new marker speed/crop use **shift+E/shift+D**.
2. Specify crop resolution (automatically scales any existing crops on change). This resolution must match the downloaded videos resolution, by default the maximum available.
   - The `clipper script` will auto scale the crop resolution if a mismatch with the video resolution is detected.
   - Use `--no-auto-scale-crop-res` to disable this behavior.
3. Specify any webms you want to merge from the clipped webms. Very fast as it does not require reencoding videos. The format is similar to that for print ranges: comma separated marker pair numbers or ranges (eg '1-3,5,7'). Marker pairs (clips) are merged in the order they are listed. Use semicolons to separate merged webms (eg '1-3,5,7;4-6,9' will create two merged webms).
4. Specify `Title Suffix` that will be appended to any `Title Prefix` and will be followed by the marker pair number to produce webm file names. By default this is the YouTube video ID. The `Title Suffix` is also the name of the folder containing all generated webms.

**shift+W:** Open additional settings when the global settings editor or a marker pair editor is open.

- Settings left blank with a placeholder of `Auto` will be automatically calculated based on the video bitrate and other settings. This is the recommended default.
- Marker pair settings are overrides that if set will override
- Marker pair settings set to `Inherit` will get their value from the global settings.
- Global settings set to `Inherit` will get their value from the command line options or the `yt_clipper_auto_all_options.bat` prompt.
- See [Encoding Settings Guide](#encoding-settings-guide) for more information and tips about the possible settings.
- Marker Pair Overrides: ![Marker Pair Overrides](https://i.imgur.com/6h84cce.png)
- Global Encode Settings: ![Global Encode Settings:](https://i.imgur.com/UfrTPzc.png)

**shift+E/D:** Update all existing markers to default new marker speed(**E**)/crop(**D**). Set the default new marker speed or crop using **W**.

### Cropping Hotkeys

**X:** When marker or defaults editor is open, begin drawing crop. **Shift+click** in the video to set the top left crop boundary and then **shift+click** again to set the bottom right. Any other click action (eg ctrl+click) will stop drawing.

- Crop is given as x-offset:y-offset:width:height. Each value is a positive integer in pixels. Width and height can also be iw and ih respectively for input width and input height.

**shift+X:** Like **X**, begin drawing a crop but set only the left and right boundaries on **shift+click**. Vertically fills the crop, that is, it sets the top to 0 and the bottom to the video height.

### Video Playback and Preview Hotkeys

**shift+G:** Toggle auto video playback speed adjustment based on markers. When outside of a marker pair the playback speed is set back to 1 (and cannot be changed without toggling off auto speed adjustment).

**alt+G:** Toggle auto looping of currently selected marker pair.

**shift+alt+G:** Toggle auto previewing gamma correction setting when between a marker pair.

**R/alt+R:** to toggle between a 90 degree clockwise/counter-clockwise rotation and no rotation.

- Works only when in fullscreen mode or theater mode.
- **Note that this does not yet work with drawing and previewing crops and should be disabled when doing so.**
- **This feature is only for watching or previewing the video, and does not affect webm output.**

**Q:** Decrease video playback speed by 0.25. If the speed falls below 0 it will cycle back to 1.

### Save and Upload Hotkeys

**S:** Save markers info to a file (.json). Use ctrl+alt+s on `Firefox` to avoid interfering with built-in shortcuts. Can be used with the `clipper script` using `--json` or with the installation.

**alt+S:** Copy markers json data to clipboard. Useful if saving breaks.

**G:** Toggle markers .json file upload for reloading markers (must be from the same video). Click `Choose File`, pick your markers .json file, then click `Load`.

<img src="https://i.imgur.com/19rao2O.png">

**alt+C:** Upload anonymously to gfycat (only supports slowdown through the gfycat url).

**alt+shift+C(Disabled):** Open gfycat browser authentication and upload under account (auth server must be running). Same caveats as **alt+C** for anonymous uploading.

## Useful YouTube Controls

1. Use **[space_bar]** or **K** to pause/play the video.
2. Use **<** and **>** to view a video frame by frame.

## Tips

### User Script Tips

1. If you're new to userscripts check out <https://openuserjs.org/about/Userscript-Beginners-HOWTO> for instructions.
2. Check out the companion script for copying gfy links from gfycat as reddit markdown at <https://openuserjs.org/scripts/elwm/gfy2md>.
3. The script can be slow to load sometimes, so wait a bit before adding markers.
4. Refresh the page if the script doesn't load and to clear markers when switching videos in the same window.
5. Videos can be marked up and the markers json or clipper script can be saved before higher quality levels are available, but the final generated webm quality depends on the quality formats available.

### Clipper Script Tips

1. The `clipper script` skips regenerating any existing webms.
   1. This makes it easy to delete webms you want regenerated and by rerunning the script.
   2. Use this to work incrementally, saving markers data, starting a batch encode, continuing to mark up, overwriting the markers data, and then rerunning the encoding.

## Encoding Settings Guide

### Articles on CRF and vp9 Encoding

1. [Basic crf guide](https://slhck.info/video/2017/02/24/crf-guide.html)
2. [ffmpeg vp9 encoding guide](https://trac.ffmpeg.org/wiki/Encode/VP9)
3. [Google vp9 basic encoding](https://developers.google.com/media/vp9/the-basics/)
4. [vp9 encoding tests](https://github.com/deterenkelt/Nadeshiko/wiki/Tests.-VP9:-encoding-to-size,-part%C2%A01)

### Tips

1. The `clipper script` is set to use the vp9 encoder by default (encoding used for webm videos on YouTube).
2. When using the installation with a markers .json file or `--json`, the `clipper script` will automatically select encoding settings based on the detected bitrate of the input video.
3. Override the default encoding settings using the **shift+W** additional settings editors.
4. The `clipper script` uses constrained quality mode where an automatically determined target max bitrate is set to keep file sizes reasonable. A target max bitrate of 0 forces constant quality mode which is likely to increase file sizes for a small increase in quality.
5. If encoding is slow, use set `encode speed` to a higher value (max 5) to speed it up at the cost of some quality.
6. Enable `denoise` to reduce noise, static, and blockiness at the cost of some encoding speed.
7. Enable `two pass encoding` if you want even better quality at the cost of significant encoding speed.

### Gamma Correction

Play around with the `gamma` setting to bring back shadow or highlight detail. A value of 1 does nothing. Use a value between 0 and 1 to bring back shadow detail and a value greater than 1 to bring back highlight detail. Refer to this [gamma correction guide](https://www.cambridgeincolour.com/tutorials/gamma-correction.htm) for more details.

## Clipper Script Usage

```sh
python ./clip.py -h # Prints help. Details all options and arguments.

python ./clip.py ./clip.webm

python ./clip.py ./clip.webm --overlay ./overlay.png

python ./clip.py ./clip.webm --format bestvideo[width<=1080]

python ./clip.py --json markers.json # automatically generate webms using markers json
```

## Clipper Script Installation

There is an installation that does not require the dependencies below.

1. Extract the appropriate zip file anywhere:
   - On Windows download this [zip file (win_v3.2.0)](https://mega.nz/#!AXhT2QjA!5OSHYWLak_BLyX420_G4kmRRNPjxhhnRSmyHlpBJE7c)
   - On Mac download this [zip file (mac_v3.2.0)](https://mega.nz/#!5LxVXIiS!cSW_gBSLp_oCexZQsIO6dBU3fJGxLjsWQc6QomxO6hw)
   - The install is **not compatible** with `v0.0.71` or lower of the `markup script`
2. Use the `markup script` on YouTube as usual, but use **S** to save the markers .json to the extracted `yt_clipper` folder.
3. Simply drag and drop the markers .json file onto the `yt_clipper.bat` file on Windows or the `yt_clipper_auto.app` file on Mac.
4. All generated clips will be placed in `./webms/<markers-json-filename>`.
5. Windows uses may require [Microsoft Visual C++ 2010 Redistributable Package (x86)](https://www.microsoft.com/en-US/download/details.aspx?id=5555).

For windows there are some alternative bat files for more options. They all work by dropping the markers json onto them:

- Use `yt_clipper_auto_clock.bat` and `yt_clipper_auto_counterclock.bat` to rotate the generated webms by 90 degrees clockwise or counter clockwise respectively.
- Use `yt_clipper_auto_audio.bat` to include audio in the generated webms.
- Use `yt_clipper_auto_all_options.bat` to print all the available options and to be prompted for a string with additional options before running the script. This allows you to combine options (eg include audio and rotate and denoise).

The bat files have a simple format. Copy and edit `yt_clipper_auto.bat` to create custom automated versions.
Just add options after the `%%A` on line 6 as in the example below where several options have been added.

```bat
@echo off
chcp 65001
cd /D "%~dp0"

FOR %%A IN (%*) DO (
  .\yt_clipper.exe --json %%A --denoise --audio --rotate clock
)

pause
```

## Clipper Script Dependencies

These dependencies are not required by the windows installation above.

- ffmpeg must be in your path for the python script (<https://www.ffmpeg.org>).
- `--url` requires youtube-dl
  - `pip install youtube-dl`
- `--gfycat` requires urllib3
  - `pip install urllib3`

## Markup Script Change Log

- v0.0.75:

  - Use with `v3.2.0` of the `clipper script` installation. See [Clipper Script Installation](#clipper-script-installation).
  - Add experimental feature for rotating YouTube video into a custom vertical theater mode.
    - Use **R** to toggle between a 90 degree clockwise rotation and no rotation.
    - Use **alt+R** to toggle between a 90 degree counter-clockwise rotation and no rotation.
    - Works only when in fullscreen mode or theater mode.
    - **Note that this does not yet work with drawing and previewing crops and should be disabled when doing so.**
    - **This feature is only for watching or previewing the video, and does not affect webm output.**

- v0.0.74:

  - Use with `v3.1.0` of the `clipper script` installation.
  - Fix bug with crop y direction offset sometimes not accounting for variable video padding.

- v0.0.73:

  - Use with `v3.1.0` of the installation. Reinstall if necessary.
  - Add jumping to next/previous marker or marker pair with **ctrl+LeftArrow**/**ctrl+RightArrow**.
    - Jumps to next or previous marker when no marker pair is selected.
    - When a marker pair is selected, selects the next or previous pair and jumps to its start marker.
  - Add video stabilization option (access with **shift+W** additional settings editor).
  - Add hotkey **alt+S** for copying markers json data to clipboard. Useful if saving breaks.

- v0.0.72:

  - Use with `v3.0.2` of the installation.
    - Mac install added to instructions.
  - Add global encode settings editor (toggle with **shift+W** when global settings editor is open). See [Encoding Settings Guide](#encoding-settings-guide).
  - Add per marker pair encode settings overrides (toggle with **shift+W** when marker pair editor is open).
  - Add visual clarity to selected marker pair (now colored black in the center).
  - Increase width of all editors in YouTube theater mode and improve editor visual clarity.
  - Rename `Title Prefix` in global settings editor to `Title Suffix`.
  - Add `Title Prefix` input in marker pair editor.
  - Generated webms are now named as follows: `Title Prefix` followed by `Title Suffix` followed by marker pair number.
  - Fix title suffix being rewrapped in square brackets when toggling global settings editor.
  - Remove generating of clipper script with **S** and copying.
  - Move saving markers json hotkey from **alt+S** to **S**.
  - Add auto previewing gamma correction with **shift+alt+G**.

- v0.0.71:

  - Use with `v2.0.0` of the installation.
  - The installation is now leaner, using a single file for the `yt_clipper.exe`.
  - Add reporting of fetched YouTube video info (title, fps, width, height, bitrate).
  - Automatically set encoding settings based on detected video bitrate using constrained quality mode.
    - This will keep file sizes for high bitrate videos under control and speed up encoding across the board.
    - **The markers .json format has changed to accommodate this and is not compatible with earlier versions.**
  - Add summary report of generated webms (successful, failed, or skipped).
  - Add automatic reconnect for greater resiliency against network errors.
  - Fix streaming and encoding long audio segments when using `--audio`.
  - Fix fetching video info multiple times.
  - Add crop resolution to markers .json data.
  - Automatically detect and fix mismatch of crop resolution and video resolution.
  - Add two-pass encoding option, enabled with `--two-pass` or `-tp`. Disabled by default.
  - Add target max bitrate option for constrained quality mode using `-b <bitrate>` where bitrate is in kb/s.

## Clipper Script (Installation) Change Log

- v3.2.0:

  - Use with `v0.0.75` of the markup script.
  - Add automatic scaling of target bitrate with marker pair cropped resolution.
    - Avoids inflating cropped webm file size.
  - Now Automatically scales crop res if a mismatch is detected without user prompt.
    - Use the `--no-auto-scale-crop-res` flag if you want to disable this behavior.
  - (Windows) Add dragging and dropping the `.json` marker data from _any location_ onto a `.bat` file.
  - (Windows) Add dragging and dropping _multiple_ `.json` marker data files to be processed _sequentially_.
  - (Windows) Add `yt_clipper_auto_simult.bat` for processing _multiple_ `.json` files _simultaneously_.
  - Note that mac by default runs multiple `.json` marker files simultaneously.

- v3.1.0:

  - Use with `v0.0.73` of the markup script.
  - Fix extra dash prepended to title suffix when title prefix is not present.
  - Add video stabilization option.
  - Fix bug with video titles with double quotes not being properly escaped.

- v3.0.2:

  - Use with `v0.0.72` of `markup script`.
  - Fixed bugs with settings inheritance and overriding.

- v3.0.0:
  - Use with `v0.0.72` of `markup script`.
  - Fix handling of DASH video and audio.
  - Fix large audio files taking very long to begin encoding.
  - Add additional logging for global and per marker pair settings.
  - Generate log file saved alongside generated webms.
  - Fix detecting mismatch of crop res height and video height.
