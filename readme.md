# yt_clipper

## Browser Support

- Works best on Chrome with the Tampermonkey extension and YouTube video in theater mode.
- You may need to refresh the video page and ensure this user script is active.
- FireFox _Nightly_, Opera, and most Chromium-based browsers not fully tested, but reportedly work as intended.
  - Main channel FireFox does not display markers.
- Other browsers may or may not work as intended.

## Related Scripts

- Check out the companion script for copying gfy links from gfycat as reddit markdown at <https://openuserjs.org/scripts/elwm/gfy2md>.

## Table of Contents

- [yt_clipper](#ytclipper)
  - [Browser Support](#browser-support)
  - [Related Scripts](#related-scripts)
  - [Table of Contents](#table-of-contents)
  - [Terminology](#terminology)
  - [Markup Script Hotkeys](#markup-script-hotkeys)
    - [Marker Hotkeys](#marker-hotkeys)
    - [Cropping Hotkeys](#cropping-hotkeys)
    - [Video Playback and Preview Hotkeys](#video-playback-and-preview-hotkeys)
    - [Frame Capturing Hotkeys](#frame-capturing-hotkeys)
    - [Save and Upload Hotkeys](#save-and-upload-hotkeys)
  - [Useful YouTube Controls](#useful-youtube-controls)
  - [Tips](#tips)
    - [User Script Tips](#user-script-tips)
    - [Clipper Script Tips](#clipper-script-tips)
  - [Encoding Settings Guide](#encoding-settings-guide)
    - [Articles on CRF and vp9 Encoding](#articles-on-crf-and-vp9-encoding)
    - [Tips and Settings](#tips-and-settings)
    - [Gamma Correction](#gamma-correction)
  - [Clipper Script Source](#clipper-script-source)
  - [Clipper Script Usage](#clipper-script-usage)
  - [Clipper Script Installation](#clipper-script-installation)
  - [Older Clipper Script Installation Releases](#older-clipper-script-installation-releases)
  - [Clipper Script Dependencies](#clipper-script-dependencies)
  - [Markup Script Changelog](#markup-script-changelog)
  - [Clipper Script (Installation) Changelog](#clipper-script-installation-changelog)

## Terminology

- `Markup script` refers to this user script and is used to mark up YouTube videos before creating webm clips.
  - It requires a user script extension such as Tampermonkey which you can install from your browser's add-ons store.
  - See <https://openuserjs.org/about/Userscript-Beginners-HOWTO> for more information on user scripts.
- `Clipper script` refers to the python script or installation that consumes marker data in `json` format to generate webm clips.
  - See [Clipper Script Usage](#clipper-script-usage] for usage instructions.
  - See [Clipper Script Installation](#clipper-script-installation) for installation instructions.

## Markup Script Hotkeys

### Marker Hotkeys

**alt+shift+A:** Toggle hotkeys on/off. A message will flash below the video.

- ![yt_clipper_active_on_page](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_active_on_page.png)

**A:** Add marker at current time (start = green, end = yellow, selected = black center). Multiple marker pairs can be added simultaneously.

**Z:** Undo last marker.

**shift+Z:** Redo last undone marker.

**shift+mouseover:** Toggle marker pair editor. Must be done over an end marker (yellow). Selected marker pairs have a black center.

- Edit pair crop or speed multiplier.
- Edit `Title Prefix` that will be prepended to the `Title Suffix` and used in the webm name for the marker pair.

**ctrl+UpArrow**: Select/deselect the most recently selected marker pair.
![yt_clipper_marker_pair_editor](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_marker_pair_editor.png)

- While a pair is selected use **shift+Q/shift+A** to move the start/end marker to current time.
  - Adjust marker position more precisely using the **<** and **>** keys to view YouTube videos frame by frame.
- While a pair is selected use **alt+Z** to delete the pair.

**ctrl+LeftArrow/RightArrow:** Jumps to the nearest previous/next marker.
**alt+LeftArrow/RightArrow:**: When a marker pair is selected, select the next/previous marker pair.
**ctrl+alt+LeftArrow/RightArrow:** When a marker pair is selected, select the next/previous marker pair _and jump to its start marker_.

**W:** Global settings editor:
![yt_clipper_globals_editor](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_globals_editor.png)

1. Change default new marker speed or crop.
   - Any new markers added will use these defaults, but this will not update existing markers.
   - To update existing markers to the default new marker speed/crop use **shift+E/shift+D**.
2. Specify crop resolution (automatically scales any existing crops on change).
   - This resolution must match the downloaded video's resolution.
   - By default the maximum available resolution is downloaded by the `clipper script`.
   - The `clipper script` will auto scale the crop resolution if a mismatch with the video resolution is detected.
   - Use `--no-auto-scale-crop-res` to disable this behavior.
3. Specify any webms you want to merge from the clipped webms.
   - Very fast as it does not require reencoding webms.
   - The format is similar to that for print ranges:
     - Each merge is a comma separated list of marker pair numbers or ranges (eg '1-3,5,7').
     - Multiple merges are separated with semicolons (eg '1-3,5,7;4-6,9' will create two merged webms).
4. Specify `Title Suffix` to be appended to any `Title Prefix` to produce the `Full Title`.
   - By default the `Title Suffix` is the YouTube video ID.
   - The `Title Suffix` is used for the name of the folder containing all generated webms.
   - The `Full Title` is followed by the marker pair number to produce webm file names.

**shift+W:** Open additional settings when the global settings editor or a marker pair editor is open.

- Settings left blank with a placeholder of `Auto` will be automatically calculated based on the input video bitrate and other video properties. This is the recommended default.
- Marker pair settings are overrides that if set will override the global value for that marker pair only.
- Marker pair settings set to `Inherit` will get their value from the global settings.
- Global settings set to `Inherit` will get their value from the command line options or the `yt_clipper_auto_all_options.bat` prompt.
- See [Encoding Settings Guide](#encoding-settings-guide) for more information and tips about the possible settings.
- Marker Pair Overrides:
  - ![yt_clipper_marker_pair_editor_overrides](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_marker_pair_editor_overrides.png)
- Global Encode Settings:
  - ![yt_clipper_globals_editor_additional_settings](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_globals_editor_additional_settings.png)

**shift+E/D:** Update all existing markers to default new marker speed(**E**) or crop(**D**).

- Set the default new marker speed or crop using **W**.

### Cropping Hotkeys

**X:** When marker or defaults editor is open, begin drawing crop.

- **shift+click** on the video to set the top left crop boundary, then **shift+click** again to set the bottom right.
- Any other click action (eg ctrl+click) will stop drawing.
- Crop is given as `x-offset:y-offset:width:height`. Each value is a positive integer in pixels. `Width` and `height` can also be `iw` and `ih` respectively for input width and input height.

**shift+X:** Like **X**, begin drawing a crop but set only the left and right boundaries on **shift+click**.

- Vertically fills the crop, that is, it sets the top to 0 and the bottom to the video height.

**Arrow Key Crop Adjustment**:

- When a crop input box has focus:
  - **UpArrow/DownArrow:** Increment/decrement the value indicated by the current cursor position by `10`.
- When a crop input box does not have focus:
  - **alt+X:** Toggle crop adjustment with arrow keys.
  - **UpArrow/DownArrow:** Increment/decrement the `y offset` by `10`.
  - **LeftArrow/RightArrow:** Increment/decrement the `x offset` by `10`.
  - **ctrl** modifier key changes target from `y offset` to `height` or from `x offset` to `width`.
- The **alt** and **shift** modifier keys alter the increment/decrement amount.
  - **alt** sets the amount to `1`, **shift** to `50`, **alt+shift** to `100`.
- The resulting crop values are clamped to valid values.

### Video Playback and Preview Hotkeys

**shift+mouse-wheel:** Scroll the mouse wheel up/down to skip forward/backward one frame per tick.

**shift+G:** Toggle auto video playback speed adjustment based on markers. When outside of a marker pair the playback speed is set back to 1 (and cannot be changed without toggling off auto speed adjustment).

**alt+G:** Toggle auto looping of currently selected marker pair.

**shift+alt+G:** Toggle auto previewing gamma correction setting when between a marker pair.

**R/alt+R:** Toggle between a 90 degree clockwise/counter-clockwise rotation and no rotation.

- Works only when in fullscreen mode or theater mode.
- **Note that this does not yet work with drawing and previewing crops and should be disabled when doing so.**
- **This feature is only for watching or previewing the video, and does not affect webm output.**

**shift+R:** Toggle big video previews on video progress bar hover.

**Q:** Decrease video playback speed by 0.25. If the speed falls to or below 0 it will cycle back to 1.

### Frame Capturing Hotkeys

**alt+Q:** Capture frame at current time of video at currently selected video quality/resolution.

- Frame must be buffered and loaded.
- Opens a pop-up window where captured frames are saved.
  - **Download** and **Delete** buttons are provided above each captured frame.
  - You may need to allow pop-ups from `youtube.com` in your browser settings.
    ![yt_clipper_frame_capturer](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_frame_capturer.png)

**alt+shift+Q** Trigger zipping of all captured frames for download.

### Save and Upload Hotkeys

**S:** Save markers info to a `.json` file.

- Can be dropped onto the installation's `yt_clipper_auto.bat` or `.bat` files to generate webms.
- Can be passed to the `clipper script` using `--json`.

**alt+S:** Copy markers `json` data to clipboard. Useful if saving breaks.

**G:** Toggle markers `json` file upload for reloading markers (must be from the same video).

- Click `Choose File`, pick your markers `json` file, then click `Load`.
  - ![yt_clipper_load_markers](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_load_markers.png)

**alt+C:** Upload anonymously to gfycat.

- The quality is not generally good.
- Most encoding settings are not used, including speed adjustments.

**alt+shift+C(Disabled):** Open gfycat browser authentication and upload under account (auth server must be running).

- Same caveats as **alt+C** for anonymous uploading.

## Useful YouTube Controls

1. Use **[space_bar]** or **K** to pause/play the video.
2. Use **<** and **>** to view a video frame by frame.

## Tips

### User Script Tips

1. If you're new to userscripts check out <https://openuserjs.org/about/Userscript-Beginners-HOWTO> for instructions.
2. Check out the companion script for copying gfy links from gfycat as reddit markdown at <https://openuserjs.org/scripts/elwm/gfy2md>.
3. Refresh the page if the script doesn't load and to clear markers when switching videos in the same window.
4. Videos can be marked up and the markers json or clipper script can be saved before higher quality levels are available, but the final generated webm quality depends on the quality formats available.

### Clipper Script Tips

1. The `clipper script` skips regenerating any existing webms.
   - This makes it easy to delete webms you want regenerated and by rerunning the script.
   - Use this to work incrementally, saving markers data, starting a batch encode, continuing to mark up, overwriting the markers data, and then rerunning the encoding.

## Encoding Settings Guide

### Articles on CRF and vp9 Encoding

1. [Basic crf guide](https://slhck.info/video/2017/02/24/crf-guide.html)
2. [ffmpeg vp9 encoding guide](https://trac.ffmpeg.org/wiki/Encode/VP9)
3. [Google vp9 basic encoding](https://developers.google.com/media/vp9/the-basics/)
4. [vp9 encoding tests](https://github.com/deterenkelt/Nadeshiko/wiki/Tests.-VP9:-encoding-to-size,-part%C2%A01)

### Tips and Settings

1. The `clipper script` is set to use the vp9 encoder by default (encoding used for webm videos on YouTube).
2. When using the installation with a markers .json file or `--json`, the `clipper script` will automatically select encoding settings based on the detected bitrate of the input video.
3. Override the default encoding settings using the **shift+W** additional settings editors.
4. The `clipper script` uses constrained quality mode where an automatically determined target max bitrate is set to keep file sizes reasonable. A target max bitrate of 0 forces constant quality mode which is likely to increase file sizes for a small increase in quality.
5. If encoding is slow, use set `encode speed` to a higher value (max 5) to speed it up at the cost of some quality.
6. Enable `denoise` to reduce noise, static, and blockiness at the cost of some encoding speed.
   - Higher strength denoise can further reduce noise at the cost of sharpness.
7. Enable `video stabilization` to smoothen the motion of the video.
   - This usually results in some cropping/zooming of the final video.
   - Higher strength presets use more cropping/zooming.
8. Enable `expand color range` to make the colors more vivid, shadows darker and highlights brighter.
   - Note that the result may not always be desirable and may look artificial.
   - Videos with blown out shadows or highlights may become further blown out. Try adjusting the `gamma` value to compensate.
9. Enable `two pass encoding` if you want even better quality at the cost of significant encoding speed.

### Gamma Correction

- Play around with the `gamma` setting to bring back shadow or highlight detail.
- Use **alt+shift+G** to preview `gamma values` with the `markup script`.
- A value of 1 does nothing. Use a value between 0 and 1 to bring back shadow detail and a value greater than 1 to bring back highlight detail.
- Refer to this [gamma correction guide](https://www.cambridgeincolour.com/tutorials/gamma-correction.htm) for more details.

## Clipper Script Source

- You can find the clipper script python source file here: <https://github.com/exwm/yt_clipper/blob/master/src/yt_clipper.py>

## Clipper Script Usage

```sh
python ./yt_clipper.py -h # Prints help. Details all options and arguments.

python ./yt_clipper.py ./clip.webm

python ./yt_clipper.py ./clip.webm --overlay ./overlay.png

python ./yt_clipper.py ./clip.webm --format bestvideo[width<=1080]

python ./yt_clipper.py --json markers.json # automatically generate webms using markers json
```

## Clipper Script Installation

There is an installation that does not require the dependencies below.

1. Extract the appropriate zip file anywhere:
   - On _Windows_ download this [zip file (win_v3.4.1)](https://mega.nz/#!8TY3zCZZ!VF6-7hY9GzOvIRLive91bTzGWk40DfB0PQ3DHzyX8Q8)
   - On _Mac_ download this [zip file (mac_v3.4.1)](https://mega.nz/#!lLAHkChR!oPhA9DWQaftp-UyclKgFp7SeFkoL-i6rhZ02y0SbVQQ)
   - The latest install (`v3.4.1`) is **not compatible** with `v0.0.76` or lower of the `markup script`
2. Simply drag and drop the markers .json file onto the `yt_clipper.bat` file on Windows or the `yt_clipper_auto.app` file on Mac.
3. All generated clips will be placed in `./webms/<markers-json-filename>`.
4. Windows users may require [Microsoft Visual C++ 2010 Redistributable Package (x86)](https://www.microsoft.com/en-US/download/details.aspx?id=5555).

For windows there are some alternative `bat` files for more options. They all work by dropping the markers json onto them:

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

## Older Clipper Script Installation Releases

You can find old releases in this folder: <https://mega.nz/#F!4HYDAKDS!NqS5Nk9heN7QBxvQapudeg>.

## Clipper Script Dependencies

These dependencies are not required by the windows installation above.

- ffmpeg must be in your path for the python script (<https://www.ffmpeg.org>).
- `--url` and `--json` require youtube-dl as a python package
  - `pip install youtube-dl`
- `--gfycat` requires urllib3
  - `pip install urllib3`

## Markup Script Changelog

- v0.0.80

  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
  - Use with `v3.4.1` of the `clipper script` installation. See [Clipper Script Installation](#clipper-script-installation).
  - Add cropping of **alt+Q** captured video frames based on currently selected marker pair's crop.
  - Fix speed adjusted marker pair duration not updating on speed change.
  - Add duration before speed adjustment to marker pair editor.

- v0.0.79

  - Add automatic disabling of browser default and add-on hotkeys when yt_clipper hotkeys are enabled.
  - Add activation of yt_clipper on all YouTube pages and load yt_clipper on navigation to a video.
    - Still requires refreshing the browser when navigating to a new video.
  - Add **alt+Q** for capturing frame at current time of video at currently selected video quality/resolution.
    - Frame must be buffered and loaded.
    - Opens a pop-up window where captured frames are saved.
      - **Download** and **Delete** buttons are provided above each captured frame.
      - You may need to allow pop-ups from `youtube.com` in your browser settings.
    - **alt+shift+Q** triggers zipping of all captured frames for download.

- v0.0.78

  - Fix auto looping of marker pairs even when no marker pair is selected.

- v0.0.77

  - Use with `v3.4.0` of the `clipper script` installation.
  - Fix marker pair merge list errors when the merge list is added and subsequently removed.
  - Fix `markers json` loader poor visibility in YouTube dark mode.
  - Fix gamma value preview not updating based on temporally active marker pair.
  - Fix previewing of nested marker pairs (the shortest duration pair is preferred).
  - Fix rotating of video previews on video progress bar hover in rotate video mode.
  - Add **shift+R** for toggling big video previews on video progress bar hover.
  - Add color range expansion option. YouTube tends to use limited (~16-245) range.
    - May require gamma adjustment to control brightness of highlights for better results.
  - Add strength presets for denoise.
    - Add marker pair numbers in `markers json` output for easier manual editing.
  - Add speed adjusted output duration display to marker pair editor.
  - Add total speed adjusted merge list durations to global settings editor.
  - Add better arrow key movement between markers and marker pairs.
    - **ctrl+LeftArrow/RightArrow**: Jumps to the nearest previous/next marker.
    - **alt+LeftArrow/RightArrow**: When a marker pair is selected, select the next/previous marker pair.
    - **ctrl+alt+LeftArrow/RightArrow**: Select the next/previous marker pair and jumps to its start marker.
  - Add **ctrl+UpArrow** to select/deselect the most recently selected marker pair.
  - Add crop modification with hotkeys:
    - Crop input boxes can now edited with hotkeys.
      - **UpArrow/DownArrow** increment/decrement the value indicated by the current cursor position by `10`.
    - Crops can also be manipulated with hotkeys without focusing the crop input box.
      - **alt+X:** Toggle using the arrow keys to manipulate the crop.
      - **UpArrow/DownArrow:** increment/decrement the `y offset` by `10`.
      - **LeftArrow/RightArrow** increment/decrement the `x offset` by `10`.
      - With the **ctrl** modifier key the target changes from `y offset` to `height` or from `x offset` to `width`.
    - The modifier keys alter the increment/decrement amount.
      - **alt** sets the amount to `1`, **shift** to `50`, **alt+shift** to `100`.
    - The values are clamped to valid values.

- v0.0.76

  - Use with `v3.3.0` of the `clipper script` installation.
  - Add undoing markers with **Z** even when a marker pair is selected.
    - Undoing a currently selected marker pair will unselect it before undoing the end marker.
  - Move _delete-selected-marker-pair_ hotkey from **shift+Z** to **alt+Z**.
  - Add redoing undone markers with **shift+Z**.
  - Add skipping frames using **shift+mouse-wheel**.
    - Scroll the mouse wheel up/down to skip forward/backward one frame per tick.
  - Fix anonymous uploading to gfycat with **alt+C**.
    - Remove appending speed parameter to URL as it is no longer supported by gfycat.

- v0.0.75:

  - Use with `v3.2.0` of the `clipper script` installation.
  - Add experimental feature for rotating YouTube video into a custom vertical theater mode.
    - Use **R** to toggle between a 90 degree clockwise rotation and no rotation.
    - Use **alt+R** to toggle between a 90 degree counter-clockwise rotation and no rotation.
    - Works only when in fullscreen mode or theater mode.
    - **Note that this does not yet work with drawing and previewing crops and should be disabled when doing so.**
    - **This feature is only for watching or previewing the video, and does not affect webm output.**

## Clipper Script (Installation) Changelog

- v3.4.1:

  - See [Clipper Script Installation](#clipper-script-installation) for installation instructions.
  - Use with `v0.0.77` or higher of the markup script.
    - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
  - Fix audio syncing issues where audio start time is always 0 and does not match video start time.
  - Fix color space detection for DASH video.

- v3.4.0:

  - Use with `v0.0.77` of the markup script.
  - Fix ffmpeg reconnect flags not properly being applied to inputs.
    - Fixes some `session invalidation` errors when encoding audio or video.
    - Note: ffmpeg reconnect features are not compatible with DASH audio/video.
  - Fix cleaning of invalid file name characters in title suffix and prefix.
  - Fix command line usage with ffmpeg dependencies on path.
  - Fix two pass encoding being ignored when video stabilization was also enabled.
  - Use original merge list strings in merge webm output filenames.
  - Add more detailed, internal options for video stabilization.
  - Add better organization of video stabilization artifacts (transform files and shaky versions of webms).
  - Add `--extra-video-filters` or `-evf` flag for passing in extra ffmpeg video filters.
  - Add `--expand-color-range` or `-ecr` flag for expanding color range from tv/limited to pc/full.

- v3.3.0:

  - Use with `v0.0.76` of the markup script.
  - Add better bitrate detection using ffprobe.
  - Add logging version of markup script at top of log.
  - Add decreasing ranges in merge list (eg 4-1 will merge pairs 4,3,2,1 in that order).
  - Improve stabilization speed (at the cost of quality of first pass shaky output).
  - Fix marker pair encode settings not being overridden by global settings.
  - Fix mac ssl verification errors. Handling of DASH video and audio especially should now be fixed.

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
