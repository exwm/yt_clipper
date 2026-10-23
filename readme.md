# yt_clipper

yt_clipper is a relatively simple way to clip videos from popular platforms (for now YouTube, WeVerse, Naver TV, and AfreecaTV).
It provides a graphical UI for video editing that creates instructions in `json` format for clipping the video.
These instruction files are small and in plain text so they can be easily read, modified, and shared with others.
The `clipper script` component provides a way to process these instructions and generate the clips you want.

# Video Tutorials

- For a video quickstart check out this video: <https://imgur.com/a/gQ4KItt>
- For a video covering the dynamic crop feature see: <https://files.catbox.moe/cakyfg.mp4>

# Quick Start Guide

Visit [this quickstart guide](https://github.com/exwm/yt_clipper/blob/master/quickstart.md) to get up and running with `yt_clipper`.

The contents of the quickstart guide are included here for convenience:

1) First install a user script extension (preferably Tampermonkey) for your browser (preferably chrome).
   - See [this article](https://greasyfork.org/en/help/installing-user-scripts) for more information.
2) Next install the `markup script` component of `yt_clipper` from [its Greasy Fork page](https://greasyfork.org/en/scripts/543460-yt-clipper). Your user script extension keeps it updated from there.
3) Install the standalone `clipper script` component of `yt_clipper` by visiting [Clipper Script Installation](https://github.com/exwm/yt_clipper#clipper-script-installation).
4) Visit a YouTube video page. Check that the `markup script` is [active on the page](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_active_on_page.png). Refresh the page if it is not active.
5) Press **Alt+Shift+A** to activate the `markup script` and its hotkeys. You should see a [flash message](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_hotkeys_activated.png) below the video.
   - Use the various hotkeys to add marker pairs and edit settings to specify how to clip the video.
     - **A** to add markers, **Z** to undo markers, **Shift+Mouseover** a yellow end marker to open [its settings editor](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_marker_pair_editor.png).
     - **W** to open global settings editor, **Shift+W** to toggle additional settings.
   - Click the [shortcuts reference toggle](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_shortcuts_table.png) in the video player bar for an overview of all shortcuts.
   - Hover over an option in a settings editor to see a [tooltip](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_tooltip.png) describing the option.
6) Use the **S** key to save markers data in `.json` format.
7) Generate webms using the saved markers data and the `clipper script`.
   - **Windows:** Drag and drop the saved markers data onto the `yt_clipper_auto.bat`.
   - **Mac:** Launch the `yt_clipper_auto` program, drag and drop the saved markers data onto the terminal, and hit **Enter**.
   - Find generated webms in `yt_clipper/webms/title-suffix` folder where `title-suffix` is the file name stem of the markers data file.
   - See [this section](https://github.com/exwm/yt_clipper#additional-helper-scripts) for details on the other helper scripts available.
8) See the [full instructions](https://github.com/exwm/yt_clipper) for more detail and advanced usage as well as changelogs.
9) The `markup script` updates itself. Check for a newer `clipper script` with the `yt_clipper_check_for_updates` helper script. See [Updating](https://github.com/exwm/yt_clipper#updating) for how to update it.
10) Join the [`yt_clipper` discord server](https://discord.gg/5RVGNCU) if you want further help or want to contribute.

# Notices

- Windows users getting ffmpeg crashes may want to try the following:
  - Update visual c++ redistributables:
    - For 64-bit Windows: <https://aka.ms/vs/16/release/vc_redist.x64.exe>
    - For other Windows versions and older redistributables check this page: <https://support.microsoft.com/help/2977003/the-latest-supported-visual-c-downloads>.
  - Switch to static ffmpeg build: <https://github.com/BtbN/FFmpeg-Builds/releases> and find the latest release titled something like `ffmpeg-N-101776-gd4575982f4-win64-gpl.zip`.
    - Copy the contents of the `bin` folder in the ffmpeg zip into `yt_clipper_win_*/bin/video-tools`, replacing the existing files.

# Browser Support

- Works best on Chrome with the Tampermonkey extension and YouTube video in theater mode.
- You may need to refresh the video page and ensure this user script is active.
- FireFox, Opera, and most Chromium-based browsers not fully tested, but reportedly work as intended.
  - FireFox audio slowdown stutters and in mainline FireFox has a min speed of 0.5.
- Other browsers may or may not work as intended.

# Video Platform Support

YouTube is the primary video platform supported by yt_clipper. Other supported platforms are listed below.

1. YouTube
2. Weverse (at least Weverse Lives)
3. Naver TV
4. AfreecaTV (at least VODs)
5. Local storage videos (<https://exwm.github.io/yt_clipper/>)
    1. If the platform you want to use isn't directly supported, you can download the video manually and then use the yt_clipper generic video platform.
    2. Load a video from local storage by dragging and dropping the video onto the player, then activate the yt_clipper markup script as usual.

## AfreecaTV Support Notes

* AfreecaTV clips use the hls (http live streaming) protocol which is not as reliable as other protocols.
* Short AfreecaTV clips (about 1 second or shorter) may produce empty video files when.
* AfreecaTV VODs come in multiple video file parts and clips that span multiple parts are not currently supported.

# Table of Contents

- [yt\_clipper](#yt_clipper)
- [Video Tutorials](#video-tutorials)
- [Quick Start Guide](#quick-start-guide)
- [Notices](#notices)
- [Browser Support](#browser-support)
- [Video Platform Support](#video-platform-support)
  - [AfreecaTV Support Notes](#afreecatv-support-notes)
- [Table of Contents](#table-of-contents)
- [Terminology and Installation](#terminology-and-installation)
- [Markup Script Shortcuts](#markup-script-shortcuts)
  - [General Shortcuts](#general-shortcuts)
  - [Marker Editing Shortcuts](#marker-editing-shortcuts)
  - [Marker Timing Shortcuts](#marker-timing-shortcuts)
  - [Marker Navigation Shortcuts](#marker-navigation-shortcuts)
  - [Global Settings Editor Shortcuts](#global-settings-editor-shortcuts)
  - [Settings Editor Toolbar](#settings-editor-toolbar)
  - [Cropping Shortcuts](#cropping-shortcuts)
  - [Playback Shortcuts](#playback-shortcuts)
  - [Preview Shortcuts](#preview-shortcuts)
  - [Frame Capturer Shortcuts](#frame-capturer-shortcuts)
  - [Saving and Loading Shortcuts](#saving-and-loading-shortcuts)
  - [Miscellaneous Shortcuts](#miscellaneous-shortcuts)
  - [Dynamic Speed and Crop Shortcuts](#dynamic-speed-and-crop-shortcuts)
    - [General Chart Shortcuts](#general-chart-shortcuts)
    - [Speed Chart Shortcuts](#speed-chart-shortcuts)
    - [Crop Chart Shortcuts](#crop-chart-shortcuts)
    - [ZoomPan Mode Crop Chart Shortcuts](#zoompan-mode-crop-chart-shortcuts)
    - [Dynamic Crop Tips](#dynamic-crop-tips)
    - [Reframe Mode (WYSIWYG Dynamic Cropping)](#reframe-mode-wysiwyg-dynamic-cropping)
- [Useful YouTube Controls](#useful-youtube-controls)
- [Tips](#tips)
  - [User Script Tips](#user-script-tips)
  - [Clipper Script Tips](#clipper-script-tips)
- [Encoding Settings Guide](#encoding-settings-guide)
  - [Video Codecs](#video-codecs)
  - [Articles on CRF and vp9 Encoding](#articles-on-crf-and-vp9-encoding)
  - [Sample-Guided Encoding](#sample-guided-encoding)
  - [Preview Format Generation](#preview-format-generation)
  - [Tips and Settings](#tips-and-settings)
    - [Markup Script Tips](#markup-script-tips)
    - [Clipper Script Tips](#clipper-script-tips-1)
  - [Gamma Correction](#gamma-correction)
- [Clipper Script Source](#clipper-script-source)
- [Clipper Script Usage](#clipper-script-usage)
  - [Cookies for Sign-in-Required Videos](#cookies-for-sign-in-required-videos)
  - [Clipper Default Arguments Files](#clipper-default-arguments-files)
- [Clipper Script Preview Shortcuts](#clipper-script-preview-shortcuts)
- [Clipper Script Installation](#clipper-script-installation)
  - [Updating](#updating)
  - [Linux Installation](#linux-installation)
  - [Manual and Beta/Alpha Version Installation](#manual-and-betaalpha-version-installation)
  - [Additional Helper Scripts](#additional-helper-scripts)
    - [Utility Scripts](#utility-scripts)
      - [Merge Utility Script](#merge-utility-script)
- [All Releases](#all-releases)
- [Clipper Script Dependencies](#clipper-script-dependencies)
  - [Motion Interpolation](#motion-interpolation)
- [Changelog](#changelog)

# Terminology and Installation

- `Markup script` refers to the user script installed in your browser through a user script extension. It is used to mark up videos (e.g. on YouTube) before creating webm clips.
  - The required user script extension, for example_Tampermonkey_, can be installed from the appropriate add-on store from your browser.
  - See <https://greasyfork.org/en/help/installing-user-scripts> for more information on user scripts.
- `Clipper script` refers to the python script (`.py` )or the installation that consumes marker data in `json` format to generate webm clips.
  - See [Clipper Script Usage](#clipper-script-usage) for usage instructions.
  - See [Clipper Script Installation](#clipper-script-installation) for installation instructions.

# Markup Script Shortcuts

First ensure the script is active on the page by checking your user script extension.

- ![yt_clipper_active_on_page](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_active_on_page.png)

## General Shortcuts

**Alt+Shift+A:** Toggle hotkeys on/off. A green message will flash below the video indicating hotkeys are enabled.

**Shift+E:** Open command palette to search and execute all shortcuts. Can also be opened with the scissors button in the right side of the video player controls.

  ![yt_clipper_command_palette](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_command_palette.png)

A shortcuts reference can also be toggled by clicking the **All shortcuts** button in the footer of the command palette.

**Alt+F:** Toggle the contextual hints bar at the bottom of the window. It shows shortcut chips for what is under the cursor or what you are doing.

- Different chips show while you hover the video, the crop overlay, or a chart point, and during a drag.
- Hold **Ctrl**, **Shift**, or **Alt** to show only the chips that use those keys.
- Hover a chip that ends in `+` to see its related shortcuts.
- Click the arrow on the left edge of the bar to move it between the bottom and the top of the window.
- When there are more chips than fit on screen, scroll the bar horizontally with **click+drag** or the **mouse wheel**.
- The bar's visibility and position persist across page reloads.
- Also toggle the bar from the command palette (**Shift+E**) or with the hints bar button, next to the scissors button in the video player controls.

  ![yt_clipper_hints_bar](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_hints_bar.png)

  ![yt_clipper_hints_button](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_hints_button.png)

## Marker Editing Shortcuts

**A:** Add marker at current time (start = green, end = yellow, selected = black center). Multiple marker pairs can be added simultaneously.

**Z:** Undo last marker.

**Shift+Z:** Redo last undone marker.

**Ctrl+Shift+Alt+Z:** Delete currently selected marker pair. Does nothing if no pair selected.

**Shift+Mouseover End Marker (Yellow) or Left-Click Any Marker Numbering:** Toggle marker pair editor. Selected marker pairs have a black center.
  ![yt_clipper_marker_pair_editor](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_marker_pair_editor.png)

- Modified marker pair settings are accented orange while settings redundant with a global setting are accented red.
- Reorder marker pairs using the input box in the title of the marker pair settings panel.
- Navigate to the adjacent marker pair by number using the **◄ Prev** and **Next ►** buttons in the panel title. The buttons are greyed out at the first and last pair.
- Edit pair crop or speed multiplier.
- Edit `Title Prefix` that will be prepended to the `Title Suffix` and used in the webm name for the marker pair.

**Shift+W:** Toggle marker pair overrides editor when a marker pair is selected.

**Ctrl+Shift+A:** Duplicate selected or previously selected marker pair.

**Alt+Z:** Undo time, speed, and crop changes of selected pair.

**Alt+Shift+Z:** Redo time, speed, and crop changes of selected pair.

- Undo/redo history is kept separately for each marker pair.

## Marker Timing Shortcuts

**Shift+Q:** Move start marker of selected pair to current time.

**Shift+A:** Move end marker of selected pair to current time.

- Adjust marker position more precisely by first using the **<** and **>** keys to seek videos frame by frame.

**Alt+Shift+Mousewheel:** Move marker one frame forward/backward.

- When performed on the left half of the window moves the start marker and on the right half the end marker.

**Alt+Click+Drag:** Drag a marker number horizontally to move the marker. The marker follows the cursor on the progress bar.

## Marker Navigation Shortcuts

**Ctrl+Up:** Select/deselect the most recently selected marker pair or else the first available pair.

**Ctrl+Down:** Toggle auto-hiding of unselected marker pairs. Hidden marker pairs cannot be selected with the mouse.

**Ctrl+Left/Right:** Jump to the nearest previous/next marker.

**Alt+Left/Right:** Select the next/previous marker pair relative to the currently or previously selected pair.

**Ctrl+Alt+Left/Right:** Select the next/previous marker pair _and jump to its start marker_.


## Global Settings Editor Shortcuts

**W:** Toggle global settings editor.
  ![yt_clipper_globals_editor](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_globals_editor.png)

1. Modified global settings are accented red.
2. Change default new marker speed or crop.
   - Any new markers added will use these defaults, but this will not update existing markers.
   - To update existing markers to the default new marker speed/crop use **Alt+Shift+Q/Alt+Shift+X**.
3. Specify crop resolution (automatically scales any existing crops on change).
   - This resolution must match the downloaded video's resolution.
   - By default the max available video resolution is downloaded by the `clipper script` and the crop resolution auto-scaled if a mismatch is detected.
4. Specify any webms you want to merge from the clipped webms.
   - Very fast as it does not require re-encoding webms.
   - The format is similar to that for printer page ranges:
     - Each merge is a comma separated list of marker pair numbers or ranges (e.g., '1-3,5,9' = '1,2,3,5,9').
     - Multiple merges are separated with semicolons (e.g., '1-3,5,9;4-6,8' will create two merged webms).
5. Specify `Title Suffix` appended to each marker pair `Title Prefix` to produce its `Full Title`.
   - By default the `Title Suffix` is the YouTube video ID in square brackets (e.g., \[Bey4XXJAqS8\]).
   - The `Title Suffix` is used for the name of the folder containing all generated webms.

**Shift+W:** Open additional encoding settings when the global settings editor or a marker pair editor is open.

- Settings left blank with a placeholder of `Auto` will be automatically calculated based on the input video bitrate and other video properties. This is the recommended default.
- Marker pair settings are overrides that if set will override the global value for that marker pair only.
- Marker pair settings set to `Inherit` will get their value from the global settings.
- Global settings set to `Inherit` will get their value from the command line options or the `yt_clipper_options` helper script prompt.
- See [Encoding Settings Guide](#encoding-settings-guide) for more information and tips about the possible settings.
- Marker Pair Overrides:
  - ![yt_clipper_marker_pair_editor_overrides](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_marker_pair_editor_overrides.png)
- Global Encode Settings:
  - ![yt_clipper_globals_editor_additional_settings](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_globals_editor_additional_settings.png)

**Alt+Shift+Q:** Update all existing markers to default new marker speed.

**Alt+Shift+X:** Update all existing markers to default new marker crop.

- Set the default new marker speed or crop using **W**.

## Settings Editor Toolbar

The marker pair editor and the global settings editor each have a toolbar of icon buttons in their title for common toggles and actions. Each button does the same as an existing shortcut.

  ![yt_clipper_settings_toolbar](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_settings_toolbar.png)

- Active features are highlighted in the editor's accent color (orange for the marker pair editor, red for the global settings editor).
- Badges show the undo/redo history depth, the number of points in a dynamic speed or crop chart, the number of overrides set on a marker pair, the current crop dim opacity, and the current preview rotation.
- The marker pair editor toolbar has: undo/redo pair changes, auto-hide unselected pairs, crop crosshair, cycle crop dim, crop preview, reframe, capture frame, dynamic speed and crop charts, the preview toggles (all, speed, loop, and gamma), and marker pair overrides.
- The global settings editor toolbar has: save, copy, load, and restore markers data, crop crosshair, cycle crop dim, capture frame, reframe, rotate video, the preview toggles, and global overrides.

## Cropping Shortcuts

**X:** When marker or defaults editor is open, begin drawing crop.

- **Click+Drag** on the video to draw a rectangular crop.
- While drawing crop, pressing **X** again will cancel drawing.
- Crop is given as `x-offset:y-offset:width:height`. Each value is a positive integer in pixels. `Width` and `height` can also be `iw` and `ih` respectively for input width and input height.

Click the copy button to the right of the **Crop** label in a settings editor to copy the crop at the current frame. Hover over the button to see the crop.

**Ctrl+X:** Cycle crop dim opacity by 25% (0/25/50/75/100%). The crop dim toolbar button shows the current opacity.

**Ctrl+Shift+X:** Toggle crop crosshair.

**Mouse-Based Crop Adjustment:**

- **Ctrl+Hover:** Indicate potential drag action when hovering over crop.
- **Ctrl+Click+Drag:** Drag and move crop or resize crop in the indicated directions.
  - Can release **Ctrl** after dragging begins. Dragging ends when mouse is released.
- **Ctrl+Alt+Drag:** Approximately aspect-ratio-locked mouse resizing of crop.
- **Ctrl+Shift+Drag:** Center-out resize/draw of crop.
- **Ctrl+Shift+Drag:** Horizontally-fixed (Y-only) drag of crop.
- **Ctrl+Alt+Drag:** Vertically-fixed (X-only) drag of crop.
- **Mousewheel during pan-drag:** Scale the crop around its center. Wheel up zooms in and wheel down zooms out.
  - Combine with pan motion to zoom and reframe in one continuous gesture.
  - In `pan-only` mode every crop point gets the new size. In `zoompan` mode only the dragged point changes size.

  ![yt_clipper_crop_preview.png](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_crop_preview.png)

**Arrow Key Crop Adjustment:**

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

## Playback Shortcuts

**Shift+Mousewheel:** Scroll the mouse wheel up/down over the video to skip/seek forward/backward 1 (default) frames per tick.

**Shift+Mousewheel-Click:** Click the mouse wheel (or middle mouse button) to cycle the frame skip/seek rate between 1 and 3 frames.

**Alt+Click+Drag:** Scrub/seek video time backward or forward by dragging left or right respectively.

**C:** Toggle previewing marker pair speed.

- Video playback speed is automatically set to the speed of the current marker pair.
- When outside of a marker pair the playback speed is force set to 1. Toggle off the speed preview to change the player speed manually.

**Shift+C:** Toggle auto looping of currently selected marker pair.

**Ctrl+Shift+C:** Toggle auto crop chart section looping. This setting takes precedence over auto marker pair looping.

**Q:** Toggle auto force setting of video playback speed. Takes precedence over any marker pair speed. This can be useful to try out different playback speeds without modifying settings.

**Alt+Q:** Cycle the force-set video speed down by 0.25. Use **Q** to toggle force setting video speed.

## Preview Shortcuts

**Shift+X:** Toggle previewing crop in pop-out window.

  <img src="https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_crop_preview_pop_out.png" alt="yt_clipper_crop_preview.png" width="500">

**Ctrl+Alt+X:** Toggle previewing crop in modal window. The modal window can be left-clicked to play/pause and right-clicked to seek the video. The crop preview reflects the current video preview rotation.

**Alt+C:** Toggle auto previewing gamma correction setting when between a marker pair.

**Alt+Shift+C:** Toggle fade loop previewing.

- Note that fade duration defaults to 0.7 seconds and is clamped to a minimum of 0.1 seconds and a maximum of 40% of the output clip duration.

**Ctrl+Alt+Shift+C:** Toggle essential previews.

- If any preview feature is disabled, turns it on. If all preview features are enabled, disables all of them. Excludes dynamic crop chart section looping.
- Works only when in fullscreen mode or theater mode.
- **Note that this does not yet work with drawing and previewing crops and should be disabled when doing so.**
- **This feature is only for watching or previewing the video, and does not affect webm output.**

**R/Alt+R:** Toggle between a 90 degree clockwise/counter-clockwise rotation and no rotation.

- Previewing a rotation also sets the matching output rotation in the global settings editor.
- Setting the rotation in the global settings editor opened with **W** still changes only the output video without rotating the preview.
- The **rotate** button in the global settings editor toolbar cycles the preview rotation through 0, 90, and -90 degrees.

**Shift+R:** Toggle big video previews on video progress bar hover.

## Frame Capturer Shortcuts

**E:** Capture frame at current time of video at currently selected video quality/resolution.

- Frame must be buffered and loaded.
- Opens a pop-up window where captured frames are saved.
  - **Download** and **Delete** buttons are provided above each captured frame.
  - You may need to allow pop-ups from `https://www.youtube.com` in your browser settings.

  ![yt_clipper_frame_capturer](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_frame_capturer.png)

**Alt+E:** Zip and download all captured frames.

## Saving and Loading Shortcuts

**S:** Save markers info to a `.json` file.

- Can be dropped onto the clipper script installation's helper scripts like `yt_clipper_auto` on Windows. On Mac, run the helper script and try dragging and dropping in the window that opens up when prompted.
- When using the python source of the `clipper script` use `--markers-json/-j` and pass the path of the markers data file.

**Alt+S:** Copy markers `json` data to clipboard. Useful if saving breaks.

**G:** Toggle markers data commands UI. Allows for uploading and loading markers data files in `.json` format and for restoring markers data auto-saved in browser local storage.

- To upload and reload markers data, click `Choose File`, pick your markers `json` file, then click `Load`.
  - ![yt_clipper_load_markers](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_load_markers.png)
- A review modal opens before the data is applied. The modal shows a JSON preview and flags any HTML-like content (e.g. `<script>`, `<iframe>`, `onerror=`, `javascript:` URLs).
  - ![yt_clipper_load_markers_review](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_load_markers_review.png)
- The review also removes unexpected fields and blocks reserved JavaScript keys such as `__proto__`. The modal lists these changes before you apply the data.
- Loaded values always show as plain text. Cancel the load if you don't trust the file.
- The same review opens for files dropped onto the player and for restoring auto-saved data from browser local storage.

## Miscellaneous Shortcuts

**Shift+F:** Flatten a VR video to make it easier to crop.

## Dynamic Speed and Crop Shortcuts

### General Chart Shortcuts

**D:** Toggle dynamic speed chart.

**Alt+D:** Toggle dynamic crop chart.

**Shift+Click:** Add a point at the clicked location.

**Alt+A:** Add a point at the current time.

- While dragging or resizing the crop (**Ctrl+Click+Drag** on the crop overlay) with the crop chart visible, **Alt+A** adds a crop point with the current crop. The held point keeps its previous crop, and the new point is selected in start mode.
- Press it at each subject position during one drag to track a moving subject.
- **A** also adds a crop point during a drag or resize when the crop chart is visible.
- In `pan-only` mode every point shares the crop size, so only the X/Y position differs between the added points.

**Alt+Shift+Click:** Delete a point.

**Right-Click:** Seek to time on bottom time-axis when clicking anywhere in chart area.

**Shift/Alt+Right-Click:** Set chart looping start/end marker.

**Shift+D:** Toggle chart loop markers.

- Note that chart loop markers only work when speed previewing is on with **C**.

**Ctrl+Mousewheel:** Zoom in and out of chart.

**Ctrl+Click:** Reset zoom.

**Click+Drag:** Drag a point to move it or drag chart area to pan when zoomed in.

### Speed Chart Shortcuts

See [General Chart Shortcuts](#general-chart-shortcuts) for shortcuts shared between dynamic charts
like adding and removing points.

**D:** Toggle dynamic speed chart.

<img src="https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_speed_chart.jpg" alt="yt_clipper_speed_chart" style="width:500px;"/>

**Notes:**

- Points are auto-sorted based on their time value on adding or removing points or on drag-end when moving points.
- YouTube playback speed can only be set to a multiple of `0.05` and greater than or equal to `0.25`.
- Audio is not compatible with dynamic speed.

### Crop Chart Shortcuts

See [General Chart Shortcuts](#general-chart-shortcuts) for shortcuts shared between dynamic charts
like adding and removing points.

Dynamic crop allows for panning a crop in the default `pan-only` mode.
In `pan-only` mode the crops of all crop chart points are maintained equal.
For zooming and panning, enable `zoompan` mode from the marker pair settings extended options (**Shift+W**).
Zooming a dynamic crop while reframed also turns it on (see [Reframe Mode](#reframe-mode-wysiwyg-dynamic-cropping) below).
In `zoompan` mode crops can change size for a zooming effect, but their aspect ratios are maintained equal.

**Alt+D:** Toggle dynamic crop chart.

The line between two points shows how the crop moves in that section.

- Pan sections are pink, zoom sections are orange, and pan and zoom sections are purple. Static sections are a faint grey line.
- Faster sections are brighter. Slower sections fade toward grey.
- The line is thickest for a full-frame crop and narrows as the crop zooms in.
- A small red arrowhead on the first point of a panning section points the way the crop moves.

![yt_clipper_crop_chart_sections.png](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_crop_chart_sections.png)

Each point's label shows its crop position (`x:y`). The crop size (`WxH`) shows on the first point in `pan-only` mode, and wherever the size changes in `zoompan` mode. A point that holds the same crop as its neighbors has no label.

**Left-Click:** Left-click a crop chart point to seek to its time.

**Left-Click+Drag:** Left-click and drag a crop chart point to change its time and seek/scrub the video.

**Ctrl+Shift+C:** Toggle auto crop chart section looping.

- A crop chart section is any two points on the chart.
- The current section is between a green start point and yellow end point. All other points are red.
- As the video time changes, the current crop chart section is automatically updated.
- Takes precedence over marker pair looping.

**Ctrl/Alt+Mouseover:** Select point as start/end of crop section.

- When the currently selected point is green then you are in start mode, and if it is yellow you are in end mode.
- The selected point's crop is editable and its crop appears more brightly in a matching color (green for the start point, gold for the end point).
- As the video time changes, the currently selected point is automatically updated to the start or end point of the new section maintaining the current mode where possible.
- Selected points have a black border and are square. Unselected points are circular.

**Alt+Mousewheel-Up/Down:** Intelligently toggle modes or select points. More specifically:

- **Alt+Mousewheel-Up:** If in end mode, toggle to start mode. If already in start mode, select next point and toggle to end mode.
- **Alt+Mousewheel-Down:** If in start mode, toggle to end mode. If already in end mode, select previous point and toggle to start mode.

**Ctrl+Alt+Shift+Mousewheel-Up/Down:** Set current crop point's crop to that of the next/previous point's crop.

**Ctrl+Shift+Click:** Toggle crop point easing between auto and instant.

- Points with instant easing enabled are darkened.
- Instant easing means that any pan or zoom from a previous point will happen instantly, causing the crop to jump.
- This is useful if there is a scene change in the video or very fast movement.
- Before version 5.37.0, instant easing would transition to the next (right) crop immediately.
  Typically you would want to hold the previous crop and then transition on the last frame.
  This meant you would need to add an extra point to hold the previous crop.
- Since version 5.37.0, instant easing holds the previous crop and on the last frame instantly transitions to the next crop.
  The recommendation now is to just add a point on the first frame that the scene changes and adjust the crop to match the new scene.

**A/Shift+A:** Set target crop component of all points following/preceding the currently selected point. Select crop components by placing your cursor in the crop input field in the marker pair settings.

- For example, let's say you want to align the X-position of all points following the currently selected point. Place your cursor by clicking in the crop input field in the first value. For example `10|0:100:920:1080` where the `|` represents your cursor. Now hit the **A** key and all following crop points will have an X-Position of `100`.

### ZoomPan Mode Crop Chart Shortcuts

In `zoompan` mode crops can change size for a zooming effect, but their aspect ratios are maintained equal.
The usual crop shortcuts have different effects than usual in this mode as described here.

**Ctrl+Drag:** Resize crop while maintaining aspect ratio.

**Ctrl+Alt+Drag:** Freely resize the crop, updating the aspect ratio of all other crop points to match automatically.

**X:** Draw crop.

- **Click+Drag:** Draw crop while maintaining aspect ratio.
- **Alt+Click+Drag:** Freely draw crop, updating the aspect ratio of all other crop points to match automatically.

### Crop Easing

Use the **Crop Easing** setting to choose how a dynamic crop pans and zooms between crop points. Find it in the global settings editor, and override it per marker pair in the marker pair settings editor.

- **Smooth Track (default):** Use it to follow a moving subject. The crop keeps moving through points without stopping at each one. It does not swing past a point when the subject reverses direction.
- **Cinematic:** Use it for steady, camera-like motion when the crop does not need to hit each point exactly. The crop follows the points within a margin, with steady holds, constant-speed pans, and smooth transitions.
  - Use it to frame a subject through camera shake. To steady the camera itself with your crop points, use Smooth Track or the **Weak** margins.
  - The `markup script` pauses briefly to recompute the path after each edit. Clips also take slightly longer to render.
  - Open the gear button next to **Crop Easing** to set the margins.
  - **Weak**, **Medium** and **Strong** set both margins at once. **Custom** restores the margins you last typed.
  - **Margin (%)** (default 12): How far the crop position may drift from the crop points, as a percentage of the crop's shorter side. The pixels for the crop show below it. Larger margins give fewer, steadier moves. At zero, the crop follows the points exactly.
  - **Zoom Margin (%)** (default 8): How far the crop size may drift, as a percentage of the size.
- **EaseInOut:** The crop easing from before version 5.49.0. Each section eases in and out, so the crop slows to a stop at every point. Use it if Smooth Track or Cinematic does not move the crop as you expect. Markers data saved before version 5.49.0 renders with EaseInOut, and loads in the `markup script` with EaseInOut.

### Dynamic Crop Tips

- Use as few points as possible for smoother motion.
- Try enabling video stabilization to smooth out the motion, especially if many points are used.
- Pause the video and **Right-Click+Drag** to seek/scrub through the video. Use this to preview the crop movement with precise control.
- For motion tracking, drop multiple crop points in one continuous **Ctrl+Click+Drag** on the crop overlay: press **A** (when the crop chart is visible) or **Alt+A** at each subject position to add a crop point and keep dragging. Combine with the mouse wheel during the same drag to zoom the crop in/out (center-out) while panning.

### Reframe Mode (WYSIWYG Dynamic Cropping)

**V:** Toggle reframe mode.

- The current crop is scaled to fill the player and everything outside it is black. This is a what-you-see-is-what-you-get (WYSIWYG) preview of the clip.
- For a dynamic crop, the preview pans and zooms to follow the crop as you scrub.
- The preview never changes the rotation or the output.

![yt_clipper_reframe.png](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_reframe.png)

**Auto-keyframing:** While reframed, crop edits apply at the current time.

- Scrub to a moment and adjust the crop with **Ctrl+Click+Drag** (move or resize) or **Ctrl+Mousewheel** (zoom).
- A crop point is added at that time, or the existing one is updated.
- This works once the crop is dynamic or the crop chart is open (**Alt+D**).

**Ctrl+Mousewheel:** Zoom the crop in/out around its center without grabbing it.

**Auto-zoompan:** The first time you zoom a dynamic crop while reframed, the marker pair switches to `zoompan` mode.

- Zooming means **Ctrl+Mousewheel** or resizing the crop on the player or minimap.
- In `zoompan` mode only the current crop point changes size.
- Turning reframe off keeps `zoompan` mode, so the zooms stay in the output. Switch back with the **ZoomPan** setting.

**Shift+V:** Toggle the navigator minimap while reframed. It shows the whole video with the crop outlined.

- **Ctrl+Drag** on the minimap to move or resize the crop. Without **Ctrl** the minimap is view-only.
- Drag the minimap to any window edge. Close it with its × button.

![yt_clipper_reframe_minimap.png](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_reframe_minimap.png)

**Ctrl+X:** In reframe, cycle the crop dim through 80/90/100% (default 100%, solid black). Below 100% the video shows faintly outside the crop.


# Useful YouTube Controls

1. Use **[space_bar]** or **K** to pause/play the video.
2. Use **<** and **>** to view a video frame by frame.
3. Use **Left-Arrow** and **Right-Arrow** to jump backwards or forwards by 5 seconds.

# Tips

## User Script Tips

1. If you're new to userscripts check out <https://greasyfork.org/en/help/installing-user-scripts> for instructions.
2. Refresh the page if the script doesn't load and to clear markers when switching videos in the same window.
3. Videos can be marked up and the markers json or clipper script can be saved before higher quality levels are available, but the final generated webm quality depends on the quality formats available.

## Clipper Script Tips

1. The `clipper script` skips regenerating any existing webms.
   - This makes it easy to delete webms you want regenerated and by rerunning the script.
   - Use this to work incrementally, saving markers data, starting a batch encode, continuing to mark up, overwriting the markers data, and then rerunning the encoding.
2. When a higher quality format of the video cannot be downloaded, the `clipper script` asks whether to continue with the lower quality format it fell back to.
   - In the printed formats table, the selected formats are green and the formats that cannot be downloaded are red.
   - With your own `--format-sort`, the `clipper script` also asks about a fallback that your sort ranks lower, even another codec at the same resolution.
   - Pass `--accept-lower-quality` to continue without asking, for example in a scheduled run.

   ![yt_clipper_lower_quality_prompt](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_lower_quality_prompt.png)

# Encoding Settings Guide

## Video Codecs

The default video codec used by yt_clipper for encoding video clips is vp9 which is typically stored in a webm container in a file with the `.webm` extension. h264 and the newer h265/hevc are typically stored in an mp4 container.

For vp9, yt_clipper uses libvpx's default `aq-mode` and `tile-rows` (a prior release mistakenly used `aq-mode 4`, the 360°/equirectangular preset). Default-mode vp9 encodes are accordingly ~12-15% larger at the same CRF, but higher quality. Keep this in mind when comparing output sizes across yt_clipper versions.

You can use the `--video-codec` option to change video codecs. The clipper script help text (`yt_clipper --help`) is kept updated with the available video codecs.

Hardware-accelerated codecs use your GPU (or sometimes other hardware like your CPU) for faster encodes at the cost of some quality. Support for these codecs depends on your hardware and your operating system.

The Vulkan technology is supported by Linux and Windows across most modern GPUs (AMD/NVIDIA/Intel). MacOS and iOS are not yet supported. It requires ffmpeg >= 7.1.

Newer NVIDIA drivers may not work with vulkan-accelerated codecs. As of 2025-06-24 at least the following driver versions are confirmed to work:  565.90, 572.16.


yt_clipper supports `h264_vulkan` for Vulkan-based hardware-acceleration of h264 encoding.

yt_clipper also supports `h264_nvenc` for NVIDIA GPU hardware-accelerated h264 encoding. This requires an NVIDIA GPU with NVENC support (most modern NVIDIA GPUs) and ffmpeg compiled with nvenc support. It is supported on Windows and Linux.

yt_clipper supports `av1` for AV1 encoding via libsvtav1, output in an mp4 container (matching the container YouTube serves AV1 in). It compresses better than vp9, but encodes slower at lower preset values. Requires ffmpeg with libsvtav1 (shipped since ffmpeg 4.4).

AV1 support is early. Its default encoding settings are not tuned yet, so expect to adjust them (e.g. the CRF and preset) for your clips.

For consistent output quality regardless of source bitrate, see [Sample-Guided Encoding](#sample-guided-encoding) below. `--sample-guided-encode` tests CRF values on each marker pair and picks one that meets a VMAF quality target, in place of the default CRF picked from the source bitrate.

## Articles on CRF and vp9 Encoding

1. [Basic crf guide](https://slhck.info/video/2017/02/24/crf-guide.html)
2. [ffmpeg vp9 encoding guide](https://trac.ffmpeg.org/wiki/Encode/VP9)
3. [Google vp9 basic encoding](https://developers.google.com/media/vp9/the-basics/)
4. [vp9 encoding tests](https://github.com/deterenkelt/Nadeshiko/wiki/Tests.-VP9:-encoding-to-size,-part%C2%A01)

## Sample-Guided Encoding

`--sample-guided-encode` encodes short samples of each marker pair at a few CRF values. It compares each sample with a CRF 18 reference encode using VMAF NEG, and picks the highest CRF (most compression) that meets the quality target. The full clip is then encoded at that CRF.

Use `--sample-guided-encode` when source bitrate alone isn't a reliable quality predictor.

- The clip is a mix of source qualities (a montage of YouTube downloads at different upload bitrates, for example).
- You want consistent output quality regardless of what kind of source you feed in.
- You're comparing encoder configurations on the same clip and want apples-to-apples bitrate numbers.

The default targets are VMAF NEG mean `>= 95` and 5th-percentile (`p5`) `>= 93`. On very short clips with too few frames for a stable percentile, the low-percentile check is dropped and only the mean is enforced.

**Cost:**

- A first-time search adds 3-5x to encode time per marker pair.
- Trial results are cached on disk per marker pair and encoder settings. A rerun with the same encoder settings reuses the picked CRF.
- Changing other settings (output filename, audio, title suffix, etc.) does not rerun the search.
- Changing the codec, resolution, or other encoder settings reruns the search.

**Output:**

- The aggregate summary table at the end of a run shows one row per marker pair with the picked CRF, VMAF mean and all six low percentiles, trial bitrate, predicted final-encode size, and `kbps@tgt` (the interpolated bitrate at the target VMAF, for comparing encoder settings).
- A "delta vs baseline" line under the table compares the result with yt_clipper's default CRF (the encode without `--sample-guided-encode`).
- Each marker pair also logs VMAF-vs-CRF and bitrate-vs-CRF charts in the terminal: the probed points, the fitted curve, the target line, and the picked CRF.

  ![yt_clipper_sge_plots](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_sge_plots.png)

**Caveat for stabilized clips:**

- Trial encodes skip video stabilization to save time, so the picked CRF is measured without it.
- The final stabilized clip can score slightly below the predicted VMAF.

**Advanced sub-flags:**

- `--target-vmaf-mean`: override the VMAF NEG mean target (default `95`).
- `--target-vmaf-low`: override the low-percentile threshold (default scales with the chosen percentile: `p1=91, p5=93, p10=95, p15=96, p20=96.5, p25=97`).
- `--target-vmaf-low-percentile`: choose which percentile to enforce as the worst-case-frame target (`1`, `5`, `10`, `15`, `20`, or `25`, default `5`). All six are computed and reported.
- `--sample-guided-encode-alg`: `curve-fit` (default) tests a few CRFs and picks the CRF at the knee of the fitted curve. `legacy-bisection` is the older strict pass/fail search, kept for rollback.

## Preview Format Generation

`--preview-format` generates a small animated preview next to each output clip (and each merged clip). Previews have no audio. The default is `none` (no preview).

This is separate from `--preview` (`-p`), which skips clip generation and asks which marker pairs to preview.

Two formats are supported:

- **`avif`**: animated AVIF at reduced resolution. Smallest files for a given quality. Requires ffmpeg `>= 6.1` for the AVIF muxer (libsvtav1 has shipped since ffmpeg 4.4).
- **`webp`**: animated WebP. It plays in more browsers (older Safari, webmail, Firefox `< 113`) and is slightly larger than AVIF. It uses libwebp method 6 (max effort) and takes about 2-3x as long to encode as AVIF.

**Sizing:**

- `--preview-max-dim` overrides the longest-edge target in pixels (aspect ratio preserved). Default `0` = auto, picked from source resolution: 4K→720, 1440p→640, 1080p→540, 720p→480, 480p→360, smaller-than-480p matches source.

**Quality:**

- `--preview-quality` overrides the auto-picked quality. AVIF uses the SVT-AV1 CRF scale (`0-63`, lower is better, auto-picked in the `28-45` band). WebP uses the libwebp quality scale (`0-100`, higher is better, auto-picked in the `60-80` band). The two scales run in opposite directions. Use the scale of the selected format.
- Auto-picked quality scales with downsample ratio, source bitrate, source CRF (when known), and preview long edge.

**Encoder preset (AVIF only):**

- `--preview-preset` controls the SVT-AV1 preset for AVIF previews (`0` = slowest/best quality, `13` = fastest). Default `8`. It has no effect on WebP.

## Tips and Settings

### Markup Script Tips

1. Move between input fields with **Tab** and **Shift+Tab**.
2. Numeric input fields can be set using the **Up/Down** arrow keys or the **Mousewheel**.
3. Access additional settings, including various encoding settings using the **Shift+W** additional settings editors.
4. Hover over settings in the `markup script` to view tooltips describing each setting.
  ![yt_clipper_tooltip](https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/yt_clipper_tooltip.png)

### Clipper Script Tips

1. The `clipper script` is set to use the vp9 encoder by default (encoding used for webm videos on YouTube).
2. Use `--help`, `-h`, or the `yt_clipper_options` helper script for additional options that can be enabled on the command line.
3. Encoding settings will be automatically selected, unless overridden, based on the detected bitrate and other properties of the input video.
4. ffmpeg encodes show a live progress display. **Ctrl+C** during an encode also prints the time since the last frame, to spot a stalled encode.

## Gamma Correction

- Play around with the `gamma` setting to bring back shadow or highlight detail.
- Use **Alt+C** to preview `gamma values` with the `markup script`.
- A value of 1 does nothing. Use a value between 0 and 1 to bring back shadow detail and a value greater than 1 to bring back highlight detail.
- Refer to this [gamma correction guide](https://www.cambridgeincolour.com/tutorials/gamma-correction.htm) for more details.

# Clipper Script Source

- You can find the latest mainline clipper script python source file here: <https://github.com/exwm/yt_clipper/blob/master/src/clipper/yt_clipper.py>

# Clipper Script Usage

On the command line, the clipper script can be be used as a typical CLI program assuming you've installed it and added it to your PATH.

Example commands:

```sh
yt_clipper -h # Prints help. Details all options and arguments.

yt_clipper --markers-json markers.json # automatically generate webms using markers json

yt_clipper -j markers.json --input-video ./clip.webm  # provide a local input video

yt_clipper -j markers.json --preview  # preview marker pairs using ffplay

yt_clipper -j markers.json --format bestvideo[width<=1080] # specify download format used by youtube-dl
```

## Cookies for Sign-in-Required Videos

Some videos require sign-in before yt-dlp can download them (age-restricted or private YouTube videos, or platforms like Weverse). Pass your browser cookies so yt-dlp can authenticate:

- `--cookies <FILE>` (aliases `--cookiefile`, `--cookiesfile`; short `-cf`): path to a Netscape-format cookies file exported from your browser. See the [yt-dlp cookies FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp).
- `--cookies-from-browser <BROWSER>` (short `-cfb`): load cookies directly from a local browser, e.g. `--cookies-from-browser firefox` or `--cookies-from-browser chrome:Default`. Supported: `brave`, `chrome`, `chromium`, `edge`, `firefox`, `opera`, `safari`, `vivaldi`, `whale`. Mutually exclusive with `--cookies`.
  - On Windows, Chrome/Chromium-based browsers often fail due to cookie encryption; prefer `firefox` or a `--cookies` file there.

## Clipper Default Arguments Files

Default arguments for the `clipper` script may be set using a simple file format.
A `default_args.txt` file with comments explaining the usage is provided with the clipper script installation.
Each install also reads `yt_clipper_default_args.txt` in the folder that holds it, so settings in that file carry over when you install a new version next to the old one.
An install's own `default_args.txt` overrides it when both set the same option.
A version skips an option in `yt_clipper_default_args.txt` that it does not know, with a warning (versions before 5.49 stop on it).
Write options as on the command line, with their full names. Join a value that starts with `-` with `=`, for example `--extra-ffmpeg-args="-preset slow"`.
The file contents are copied below for convenience:

```txt
# By default, this args file will be read by yt_clipper to set default arguments.
# To see all arguments read yt_clipper_help.txt, or use the `yt_clipper_options` helper script or the `-h` argument.
# Lines that begin with a `#` in this file are comments and are ignored.
# To use other arg files use the `--arg-files` argument outside of an arg file.
#
# Each new version unzips to a new folder, and its own copy of this file starts empty.
# For settings every version should use (e.g. --cookies), put them in yt_clipper_default_args.txt
# in the folder that holds your yt_clipper install folders. Every install reads that file first,
# then this one, so a setting here overrides the same setting there. Versions from 5.49 on skip an
# option in that file they do not know, with a warning. Older versions stop on it, and every version
# stops on a value it does not know (e.g. a new --video-codec). Put options and values new in this
# version here instead. Versions before 5.49 also do not accept quotes in that file.


# The following commented lines provide an example of how to use this file.
# The lines can be uncommented (by removing the `#`) to test their effects.

# --audio
# --two-pass
# -di -dn 2
# --video-codec h264_vulkan
# --sample-guided-encode
```

# Clipper Script Preview Shortcuts

See <https://ffmpeg.org/ffplay.html#While-playing>.

# Clipper Script Installation

There is an installation that does not require the dependencies below.

1. Extract the appropriate zip file anywhere:
   - Go to <https://github.com/exwm/yt_clipper/releases> and pick a release. In the assets, find the appropriate file for your platform.
   - **Windows users:** The zip bundles [video2x](https://github.com/k4yt3x/video2x) in `bin/video-tools/`, so [motion interpolation](#motion-interpolation) works without extra setup.
2. Simply drag and drop the markers .json file onto the `yt_clipper_auto.bat` file on Windows or at the terminal prompt after executing `yt_clipper_auto` on Mac.
3. Use `Ctrl+C` if you need to cancel the process.
4. All generated webm clips will be placed in `./webms/<markers-json-filename>`.
   - Each run writes its log to the `logs` folder inside it, named by the time the run started.
5. Windows users may require [Microsoft Visual C++ 2010 Redistributable Package (x86)](https://www.microsoft.com/en-US/download/details.aspx?id=5555).

## Updating

The `markup script` updates itself when it was installed from [Greasy Fork](https://greasyfork.org/en/scripts/543460-yt-clipper). Click **Releases** at the bottom right of the command palette (**Shift+E**) to see what changed. The version you have is shown next to it.

To check for a newer `clipper script`, run `yt_clipper_check_for_updates.bat` (Windows) or `yt_clipper_check_for_updates` (Mac), or pass `--check-for-updates`. To update it:

1. Download the new zip from the [GitHub Releases](https://github.com/exwm/yt_clipper/releases) page.
2. Extract it next to your current install, in the same folder.
3. Put settings every version should use (e.g. `--cookies`) in `yt_clipper_default_args.txt` in that folder. Every install reads it.
   - The `clipper script` reminds you if an older install next to it still has settings in its own `default_args.txt`.
4. Clips stay in each install's `webms` folder. To keep them together, move the `webms` folder into the new install. The `clipper script` then skips clips that already exist.

## Linux Installation

The clipper script requires Python version 3.12, while many distros will have a more recent version of python. This can be dealt with using [pipx](https://pipx.pypa.io):
```bash
pipx install git+https://github.com/exwm/yt_clipper --python 3.12 --fetch-missing-python
```

The package can be updated by running `pipx upgrade clipper`.

## Manual and Beta/Alpha Version Installation

**Markup script (js):** (1) Find the `yt_clipper*.js` file in the github release assets, (2) right-click > `copy address`, (3) open user script extension dashboard, (4) find and use option to add a script via url (in tampermonkey, utilities tab > `install from url`; in violentmonkey, `+` button at top > `install from url`).

_Alternatively_, (1) Download the `yt_clipper*.js` file from the github release assets, (2) open user script extension dashboard, (3) open yt_clipper for editing, (4) click inside the editor and select everything with `Ctrl+A`, (5) delete everything with say `backspace`, (6) drag and drop the markup script js file into the editor, (7) `Ctrl+S` to save.

**Clipper script (platform-specific zip):** Install as usual by extracting the zip file to a convenient location.

## Additional Helper Scripts

There are some alternative helper scripts for more options:

- Each release zip includes `yt_clipper_help.txt`, which lists all the options and their help.
- Use `yt_clipper_options` to print all the available options and to be prompted for a string with additional options before running the script. This allows you to combine options (e.g., include audio and rotate and denoise).
  - The other helper scripts provide preconfigured subsets of these options.
- Use `yt_clipper_preview` to locally preview markers `json` data with `ffplay`.
  - _Cannot preview audio, video stabilization, or expanded color range._
- Use `yt_clipper_auto_download` to download video before processing markers.
- Use `yt_clipper_auto_input_video` to specify both markers `json` data and an input video for processing.
  - On Windows simply drag and drop both the `json` and the input video onto `yt_clipper_auto_input_video`.
  - On Mac, `yt_clipper_input_video` prompts for the `json` then the input video.

When the clips are done, the helper scripts ask for the options of another run with the same markers `json` data. Enter all its options, or press **Enter** to finish. The options of the run before do not carry over, and existing clips are skipped unless you add `--overwrite` (for example `--overwrite --audio` remakes the clips with audio). Put quotes around a value with `<`, `>`, `|`, `&` or `;` in it, for example `--format "bv[height>=720]"`. The script then leaves a command prompt open in the yt_clipper folder.

The helper scripts have a simple format. Copy and edit `yt_clipper_auto` in a text editor to create custom automated versions. Add options to the line that runs the `clipper script` with `--markers-json`. For example you could add `--deinterlace` to enable deinterlacing or use `--only 2,5` to process only marker pairs 2 and 5.

### Utility Scripts

There are several utility scripts provided as well that wrap ffmpeg or other tools either for convenience or additional functionality.

1. The `fast_trim` utility script takes a single video file as input and trims it quickly BUT approximately. The script prompts for a start time and an end time to trim the input video file. The output file name will be suffixed with `-trim`.
2. The `vid2gif` utility script converts 1 or more video files to `gif` files with a small file size and resolution. The script prompts for the gif frame rate and size.
3. The `preprocess_hevc` utility script preprocesses an input video file (likely `mp4`) with an `hevc` video stream to ensure compatibility with ffmpeg. You may need to use this script if you see errors like `Invalid data found when processing input` from ffmpeg when using `hevc` with the `--input-video`/`-i` option or the `yt_clipper_auto_input_video` helper script. The preprocessed output file name will be suffixed with `-preproc`.

#### Merge Utility Script

The `merge` utility script can be used to merge any webm files in any order:

- On Mac, follow the prompts after running the utility script, providing the paths of 2 or more input files in the order you want them merged.
- On Windows:
  - Rename the webm files so they sort by name in the order you want. Numbers sort in numeric order (`clip-2` before `clip-10`).
  - Select/highlight all webms to be merged in your file explorer and drag and drop them onto the `merge.bat` script.
  - The output file name is the name of the file you dragged with `-merged` appended.
  - The script prints the files in the order it merges them.

# All Releases

Since clipper script `v3.6.1`, releases can be tracked here: <https://github.com/exwm/yt_clipper/releases>.

# Clipper Script Dependencies

These dependencies must be manually installed when not using the clipper script installation:

- ffmpeg must be in your path: (<https://www.ffmpeg.org/download.html>).
- install required python packages as listed in the `requirements.txt`:
  - `pip install -r ./src/clipper/requirements.txt`

## Motion Interpolation

Motion interpolation (frame rate multiplication using AI) is powered by [video2x](https://github.com/k4yt3x/video2x) and is only supported on **Windows** and **Linux** for now.

To use it, video2x must be in the clipper script installation or on the system PATH if using the script directly:

- **Easiest:** Download the `yt_clipper_win_*.zip` release. video2x is pre-bundled in `bin/video-tools/`, with only the RIFE model the clipper uses (`rife-v4.26`). For its other models (e.g. for upscaling), copy the `models` folder from the matching [yt_clipper build of video2x](https://github.com/exwm/video2x/releases) into `bin/video-tools/`. Only copy the `models` folder: the rest of that zip includes its own copy of the ffmpeg DLLs.
- **Manual:** Download [video2x-qt6-windows-amd64.zip](https://github.com/k4yt3x/video2x/releases/download/6.4.0/video2x-qt6-windows-amd64.zip), extract it, and place the contents in `bin/video2x/` inside your clipper installation directory.

Once installed, enable motion interpolation on a marker pair by setting `FPS Multiplier` to a value greater than 1 (e.g. `2` to double the frame rate). The RIFE model is used for interpolation. Hardware-accelerated encoders do not yet work with video2x.

Note that video2x requires a vulkan-capable GPU. See also <https://github.com/k4yt3x/video2x>.


# Changelog

For a complete changelog, including beta and alpha releases,
see <https://github.com/exwm/yt_clipper/blob/master/changelog.md>.

For pre-version-unification (between `markup` and `clipper` scripts) changelogs see <https://github.com/exwm/yt_clipper/blob/master/changelog-pre-version-unification.md>.
