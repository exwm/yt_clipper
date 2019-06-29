# yt_clipper

## Notices

- **NOTICE 1:** The namespace of the user script was recently changed and you may have two versions of the script installed simultaneously. Check your user script extension, and if this is the case, delete the older version.

## Browser Support

- Works best on Chrome with the Tampermonkey extension and YouTube video in theater mode.
- You may need to refresh the video page and ensure this user script is active.
- FireFox, Opera, and most Chromium-based browsers not fully tested, but reportedly work as intended.
  - FireFox audio slowdown stutters and in mainline FireFox has a min speed of 0.5.
- Other browsers may or may not work as intended.

## Related Scripts

- Check out the companion script for copying gfy links from gfycat as reddit markdown at <https://openuserjs.org/scripts/elwm/gfy2md>.

## Table of Contents

- [yt_clipper](#ytclipper)
  - [Notices](#notices)
  - [Browser Support](#browser-support)
  - [Related Scripts](#related-scripts)
  - [Table of Contents](#table-of-contents)
  - [Terminology](#terminology)
  - [Markup Script Shortcuts](#markup-script-shortcuts)
    - [Marker Shortcuts](#marker-shortcuts)
    - [Cropping Shortcuts](#cropping-shortcuts)
    - [Video Playback and Preview Shortcuts](#video-playback-and-preview-shortcuts)
    - [Time-Variable Speed Chart Shortcuts](#time-variable-speed-chart-shortcuts)
    - [Frame Capturing Shortcuts](#frame-capturing-shortcuts)
    - [Save and Upload Shortcuts](#save-and-upload-shortcuts)
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
    - [Additional Helper Scripts](#additional-helper-scripts)
      - [Windows Merge Helper Bat Script](#windows-merge-helper-bat-script)
  - [Older Releases](#older-releases)
  - [Clipper Script Dependencies](#clipper-script-dependencies)
  - [Full Changelog](#full-changelog)
  - [Markup Script Changelog](#markup-script-changelog)
  - [Clipper Script (Installation) Changelog](#clipper-script-installation-changelog)

## Terminology

- `Markup script` refers to this user script and is used to mark up YouTube videos before creating webm clips.
  - It requires a user script extension such as _Tampermonkey_ which you can install from your browser's add-ons store.
  - See <https://openuserjs.org/about/Userscript-Beginners-HOWTO> for more information on user scripts.
- `Clipper script` refers to the python script or installation that consumes marker data in `json` format to generate webm clips.
  - See [Clipper Script Usage](#clipper-script-usage] for usage instructions.
  - See [Clipper Script Installation](#clipper-script-installation) for installation instructions.

## Markup Script Shortcuts

First ensure the script is active on the page by checking your user script extension.

- ![yt_clipper_active_on_page](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_active_on_page.png)

### Marker Shortcuts

**Alt+Shift+A:** Toggle hotkeys on/off. A green message will flash below the video indicating hotkeys are enabled.

A shortcuts reference can be toggled by clicking the scissor icon in the video controls bar.

- ![yt_clipper_shortcuts_table](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_shortcuts_table.png)

**A:** Add marker at current time (start = green, end = yellow, selected = black center). Multiple marker pairs can be added simultaneously.

**Z:** Undo last marker.

**Shift+Z:** Redo last undone marker.

**Alt+Z:** Delete currently selected marker pair. Does nothing if no pair selected.

**Shift+mouseover:** Toggle marker pair editor. Must be done over an end marker (yellow). Selected marker pairs have a black center.

- Edit pair crop or speed multiplier.
- Edit `Title Prefix` that will be prepended to the `Title Suffix` and used in the webm name for the marker pair.
![yt_clipper_marker_pair_editor](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_marker_pair_editor.png)

**Ctrl+Up**: Select/deselect the most recently selected marker pair.

- Adjusting marker position:
  - While a pair is selected use **Shift+Q/Shift+A** to move the start/end marker to current time.
  - Adjust marker position more precisely using the **<** and **>** keys to view YouTube videos frame by frame.

- Jumping to and selecting marker pairs without the mouse
  - **Ctrl+Left/Right:** Jumps to the nearest previous/next marker.
  - **Alt+Left/Right:** When a marker pair is selected, select the next/previous marker pair.
  - **Ctrl+alt+Left/Right:** When a marker pair is selected, select the next/previous marker pair _and jump to its start marker_.

**W:** Global settings editor:
![yt_clipper_globals_editor](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_globals_editor.png)

1. Change default new marker speed or crop.
   - Any new markers added will use these defaults, but this will not update existing markers.
   - To update existing markers to the default new marker speed/crop use **Alt+Shift+Q/alt+Shift+X**.
2. Specify crop resolution (automatically scales any existing crops on change).
   - This resolution must match the downloaded video's resolution.
   - By default the max available video resolution is downloaded by the `clipper script` and the crop resolution auto-scaled if a mismatch is detected.
3. Specify any webms you want to merge from the clipped webms.
   - Very fast as it does not require re-encoding webms.
   - The format is similar to that for printer page ranges:
     - Each merge is a comma separated list of marker pair numbers or ranges (e.g., '1-3,5,9' = '1,2,3,5,9').
     - Multiple merges are separated with semicolons (e.g., '1-3,5,9;4-6,8' will create two merged webms).
4. Specify `Title Suffix` appended to each marker pair `Title Prefix` to produce its `Full Title`.
   - By default the `Title Suffix` is the YouTube video ID in square brackets (e.g., \[Bey4XXJAqS8\]).
   - The `Title Suffix` is used for the name of the folder containing all generated webms.

**Shift+W:** Open additional settings when the global settings editor or a marker pair editor is open.

- Settings left blank with a placeholder of `Auto` will be automatically calculated based on the input video bitrate and other video properties. This is the recommended default.
- Marker pair settings are overrides that if set will override the global value for that marker pair only.
- Marker pair settings set to `Inherit` will get their value from the global settings.
- Global settings set to `Inherit` will get their value from the command line options or the `yt_clipper_options` `.bat/.app` prompt.
- See [Encoding Settings Guide](#encoding-settings-guide) for more information and tips about the possible settings.
- Marker Pair Overrides:
  - ![yt_clipper_marker_pair_editor_overrides](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_marker_pair_editor_overrides.png)
- Global Encode Settings:
  - ![yt_clipper_globals_editor_additional_settings](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_globals_editor_additional_settings.png)

**Alt+Shift+Q/alt+Shift+X:** Update all existing markers to default new marker speed (**Q**) or crop (**X**).

- Set the default new marker speed or crop using **W**.

### Cropping Shortcuts

**X:** When marker or defaults editor is open, begin drawing crop.

- **Shift+Click** on the video to set the top left crop boundary, then **Shift+Click** again to set the bottom right.
- Any other click action (eg Ctrl+Click) will stop drawing.
- Crop is given as `x-offset:y-offset:width:height`. Each value is a positive integer in pixels. `Width` and `height` can also be `iw` and `ih` respectively for input width and input height.

**Shift+X:** Like **X**, begin drawing a crop but set only the left and right boundaries on **Shift+Click**.

- Vertically fills the crop, that is, it sets the top to 0 and the bottom to the video height.

**Arrow Key Crop Adjustment**:

- When a crop input box has focus:
  - **UpArrow/DownArrow:** Increment/decrement the value indicated by the current cursor position by `10`.
- When a crop input box does not have focus:
  - **Alt+X:** Toggle crop adjustment with arrow keys.
  - **UpArrow/DownArrow:** Increment/decrement the `y offset` by `10`.
  - **LeftArrow/RightArrow:** Increment/decrement the `x offset` by `10`.
  - **Ctrl** modifier key changes target from `y offset` to `height` or from `x offset` to `width`.
- The **Alt** and **Shift** modifier keys alter the increment/decrement amount.
  - **Alt** sets the amount to `1`, **Shift** to `50`, **Alt+Shift** to `100`.
- The resulting crop values are clamped to valid values.

### Video Playback and Preview Shortcuts

**Shift+mouse-wheel:** Scroll the mouse wheel up/down over the video to skip forward/backward one frame per tick.

**D:** Toggle auto video playback speed adjustment based on markers. When outside of a marker pair the playback speed is set back to 1 (and cannot be changed without toggling off auto speed adjustment).

**Shift+D:** Toggle auto looping of currently selected marker pair.

**Alt+D:** Toggle auto previewing gamma correction setting when between a marker pair.

**R/alt+R:** Toggle between a 90 degree clockwise/counter-clockwise rotation and no rotation.

- Works only when in fullscreen mode or theater mode.
- **Note that this does not yet work with drawing and previewing crops and should be disabled when doing so.**
- **This feature is only for watching or previewing the video, and does not affect webm output.**

**Shift+R:** Toggle big video previews on video progress bar hover.

**Q:** Decrease video playback speed by 0.25. If the speed falls to or below 0 it will cycle back to 1.

### Time-Variable Speed Chart Shortcuts

**C:** Toggle time-variable speed chart.

**Right-Click:** Seek to time on bottom time-axis when clicking anywhere in chart area.

**Ctrl+Right-Click/Alt+Right-Click:** Set speed chart looping start/end marker.

**Shift+C:** Toggle speed chart looping (note speed chart looping only works when speed previewing is on with **D**).

**Alt+Shift+C:** Reset speed chart looping markers.

**Click+Drag:** Drag a speed point to move it or drag chart area to pan when zoomed in.

**Shift+Click:** Add a speed point.

**Alt+Shift+Click:** Delete a speed point.

**Ctrl+mouse-wheel:** Zoom in and out of speed chart. **Ctrl+Click:** Reset zoom.

Points are auto-sorted based on their time value on adding or removing points or on drag-end when moving points.

YouTube playback speed can only be set to a multiple of `0.05`. The transitions between speed points are thus set to round the easing to the nearest multiple of `0.05` by default. This provides in-browser previews that better match final output. The rounding can be changed in the global or marker pair settings editors with the `Round Easing` input.

![yt_clipper_speed_chart](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_speed_chart.jpg)

### Frame Capturing Shortcuts

**E:** Capture frame at current time of video at currently selected video quality/resolution.

- Frame must be buffered and loaded.
- Opens a pop-up window where captured frames are saved.
  - **Download** and **Delete** buttons are provided above each captured frame.
  - You may need to allow pop-ups from `https://www.youtube.com` in your browser settings.

  ![yt_clipper_frame_capturer](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_frame_capturer.png)

**Alt+E** Trigger zipping of all captured frames for download.

### Save and Upload Shortcuts

**S:** Save markers info to a `.json` file.

- Can be dropped onto the installation's `yt_clipper_auto.bat` or `.bat` files to generate webms.
- Can be passed to the `clipper script` using `--json`.

**Alt+S:** Copy markers `json` data to clipboard. Useful if saving breaks.

**G:** Toggle markers `json` file upload for reloading markers (must be from the same video).

- Click `Choose File`, pick your markers `json` file, then click `Load`.
  - ![yt_clipper_load_markers](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_load_markers.png)

**Alt+V:** Upload anonymously to gfycat.

- The quality is not generally good.
- Most encoding settings are not used, including speed adjustments.

**Alt+Shift+V(Disabled):** Open gfycat browser authentication and upload under account (auth server must be running).

- Same caveats as **Alt+V** for anonymous uploading.

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
3. Override the default encoding settings using the **Shift+W** additional settings editors.
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
- Use **Alt+D** to preview `gamma values` with the `markup script`.
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
   - On _Windows_ download this [zip file (win_v3.5.1)](https://mega.nz/#!1WIwkAKQ!999ObtZWfu5IG7IfLSGyynYCJanQdcn7Eb4QYh3cNLU)
   - On _Mac_ download this [zip file (mac_v3.5.1)](https://mega.nz/#!kaY2nAbZ!x249wT-K3RqydZVEkdw1ZA2zZQi-_aERy9ZbVLv2yeM)
   - The latest install (`v3.5.1`) is **not compatible** with `v0.0.75` or lower of the `markup script`
2. Simply drag and drop the markers .json file onto the `yt_clipper_auto.bat` file on Windows or at the terminal prompt after executing `yt_clipper_auto` on Mac.
3. Use `Ctrl+C` if you need to cancel the process.
4. All generated webm clips will be placed in `./webms/<markers-json-filename>`.
5. Windows users may require [Microsoft Visual C++ 2010 Redistributable Package (x86)](https://www.microsoft.com/en-US/download/details.aspx?id=5555).

### Additional Helper Scripts

There are some alternative helper scripts for more options:

- Use `yt_clipper_options` to print all the available options and to be prompted for a string with additional options before running the script. This allows you to combine options (e.g., include audio and rotate and denoise).
  - The other helper scripts provide preconfigured subsets of these options.
- Use `yt_clipper_preview` to locally preview markers `json` data with `ffplay`.
  - _Cannot preview audio, video stabilization, or expanded color range._
- Use `yt_clipper_auto_download` to download video before processing markers.
- Use `yt_clipper_auto_input_video` to specify both markers `json` data and an input video for processing.
  - On Windows simply drag and drop both the `json` and the input video onto `yt_clipper_auto_input_video`.
  - On Mac, `yt_clipper_auto_input_video` will prompt for the `json` then the input video.

The helper scripts have a simple format. Copy and edit `yt_clipper_auto` in a text editor to create custom automated versions.

- On Windows:

  ```bat
  @echo off
  chcp 65001
  cd /D "%~dp0"

  FOR %%A IN (%*) DO (
    REM add options after %%A of the next line as shown
    .\yt_clipper.exe --json %%A --denoise --audio --rotate clock
  )

  pause
  ```

- On Mac

  ```bash
  #!/bin/bash
  cd "$(dirname "$0")"

  read -p "First enter the paths of 1 or more markers json data files (you may be able to drag and drop files at the prompt): " JSONPROMPT

  IFS=$'\n' JSONS=( $(xargs -n1 <<< "$JSONPROMPT") )

  for JSON in "${JSONS[@]}"
  do
    if [ -f "$JSON" ]; then
      # add options after $JSON of the next line as shown
      ./yt_clipper --markers-json "$JSON"
    else
      echo "$JSON does not exist"
    fi
  done
  ```

#### Windows Merge Helper Bat Script

The `yt_clipper_merge.bat` can be used to merge any webm files in any order:

- Rename the webm files so they sort in ascending lexicographic order.
- Select/highlight all webms to be merged in your file explorer and drag and drop them onto the `bat`.
- The output file will be `-merged` appended to the first input file.
- Check the `merge.txt` file to confirm the correct videos were merged in the correct order.

## Older Releases

You can find old releases in this folder: <https://mega.nz/#F!4HYDAKDS!NqS5Nk9heN7QBxvQapudeg>.

## Clipper Script Dependencies

These dependencies are not required by the windows installation above.

- ffmpeg must be in your path for the python script (<https://www.ffmpeg.org>).
- `--url` and `--json` require youtube-dl as a python package
  - `pip install youtube-dl`
- `--gfycat` requires urllib3
  - `pip install urllib3`

## Full Changelog

See <https://github.com/exwm/yt_clipper/blob/master/changelog.md>.

## Markup Script Changelog

- v0.0.82

  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
  - Use with `v3.5.1` of the `clipper script` installation. See [Clipper Script Installation](#clipper-script-installation).
  - Revert enabling crop adjustment with arrow keys hotkey to **Alt+X**.
  - Add version tag to generated markers `json` data.
  - Fix readme table of contents not working on openuserjs.com.
  - Added folder for old releases of `markup script` at [Older Releases](#older-releases).

- v0.0.81

  - Use with `v3.5.0` of the `clipper script` installation.
  - Fix some default C key bindings (eg Ctrl+C for copying) being wrongly disabled.
  - Add shortcuts reference toggle button (scissor icon) to video controls on hotkeys enable.
  - Add time-variable speed chart for making webms with variable speed.
    - See [Time-Variable Speed Chart Shortcuts](#time-variable-speed-chart-shortcuts) for usage instructions
    - Note that mainline FireFox does not seem to support audio slowdown well (stutters) and has a min audio speed of 0.5.
  - Increase frequency of preview updates (speed, looping, and gamma) for more accurate previews.
  - Fix markers not showing in mainline FireFox due to lack of svg 2.
  - Fix script crash on new, unprocessed videos.
  - Fix being able to add or move end marker before start marker and vice versa.
  - Reorganized hotkeys:
    - Update all markers to default new marker speed/crop:
      - Speed: **Shift+E** -> **Alt+Shift+Q**, Crop: **Shift+D** -> **Alt+Shift+X**.
    - Previewing:
      - Speed: **Alt+G** -> **D**, Looping: **Alt+G** -> **Shift+D**, Gamma: **Alt+Shift+G** -> **Alt+D**.
    - Frame capturer:
      - Capture frame: **Alt+Q** -> **E**, Zip and download all captured frames: **Alt+Shift+Q** -> **Alt+E**.
    - Uploading: **Alt+C** -> **Alt+V** and **Alt+Shift+C** -> **Alt+Shift+V**.

- v0.0.80

  - Use with `v3.4.2` of the `clipper script` installation.
  - Add cropping of **Alt+Q** captured video frames based on currently selected marker pair's crop.
  - Fix speed adjusted marker pair duration not updating on speed change.
  - Add duration before speed adjustment to marker pair editor.
  - **NOTICE:** The namespace of the user script was recently changed and you may have two versions of the script installed simultaneously. Check your user script extension, and if this is the case, delete the older version.

- v0.0.79

  - Add automatic disabling of browser default and add-on hotkeys when yt_clipper hotkeys are enabled.
  - Add activation of yt_clipper on all YouTube pages and load yt_clipper on navigation to a video.
    - Still requires refreshing the browser when navigating to a new video.
  - Add **Alt+Q** for capturing frame at current time of video at currently selected video quality/resolution.
    - Frame must be buffered and loaded.
    - Opens a pop-up window where captured frames are saved.
      - **Download** and **Delete** buttons are provided above each captured frame.
      - You may need to allow pop-ups from `youtube.com` in your browser settings.
    - **Alt+Shift+Q** triggers zipping of all captured frames for download.

- v0.0.78

  - Fix auto looping of marker pairs even when no marker pair is selected.

## Clipper Script (Installation) Changelog

- v3.5.1:

  - See [Clipper Script Installation](#clipper-script-installation) for installation instructions.
  - Use with `v0.0.82` or higher of the markup script.
    - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
  - Fix compatibility with latest markers json format (`v0.0.81`)
  - Fix backwards compatibility with older markers json formats.
  - Fix potential input videos including `.part` files and other multi-extension file names.
  - Mac: Switched `clipper script` installation from `.app`-based system to executable `bash script` system.
    - Fixes translocation issues with Mac.
    - Use by double-clicking or otherwise executing one of the executable `bash scripts`.
    - At the prompt type or drag and drop `json` data files and then hit enter.
    - Now processes multiple marker `json` data files sequentially and from any location.
    - See [Additional Helper Scripts](#additional-helper-scripts) for more info.

- v3.5.0:

  - Use with `v0.0.81` or higher of the markup script.
  - Add support for time-variable speed.
  - Add new `clipper script` flags and `bat/app` scripts for accessing new functions.
    - Add local previewing of markers (using ffplay) with `--preview/-p`, `yt_clipper_preview` .bat or .app file.
    - Add downloading of video before processing markers with `--download-video/-dv`, `yt_clipper_auto_download` .bat or .app file.
    - Add automatic detection of potential input videos with path stem `./webms/titleSuffix/titleSuffix-full`.
    - Add `--input-video` for manually specifying a an input video path or URL.
      - Windows: Add `yt_clipper_auto_input_video.bat` onto which a markers .json and video file can be dropped for processing.
  - Windows: Simplified `yt_clipper_merge.bat` usage by auto-sorting file list received on drop.
    - See the updated [Merge Helper Bat Script Instructions](#windows-merge-helper-bat-script).
  - Fix some characters breaking merge list processing due to merge inputs txt file not being encoded with utf-8.

- v3.4.2:

  - Use with `v0.0.77` or higher of the markup script.
  - Update `youtube-dl` dependency to version [`2019.06.21`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.06.21).
    - Fixes automatic fetching of YouTube videos.
  - Windows: Add `yt_clipper_merge.bat` for merging webm video files on disk.
    - See the [Merge Helper Bat Script Instructions](#windows-merge-helper-bat-script).

- v3.4.1:

  - Use with `v0.0.77` or higher of the markup script.
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
