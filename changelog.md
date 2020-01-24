# yt_clipper Changelog

## Markup Script Changelog

v0.0.89 `[2019.10.25]`:

- Use with `v3.6.1` of the `clipper script` installation.
- Fix imprecise marker timing due to imprecise FPS information by skipping frame time estimation.
- Fix moving currently selected end marker when deactivating hotkeys.
- Fix vertical alignment of rotated video preview thumbnail.
- Fix fade preview causing crop overlay to disappear.

v0.0.88 `[2019.08.31]`:

- Use with `v3.6.0` of the `clipper script` installation.
- Add marker move undo (**Alt+Z**) and redo (**Shift+Alt+Z**).
- Add **Alt+Shift+Mousewheel** for moving selected start/end marker by a frame per tick.
  - When performed on the left half of the window moves start marker and on the right half the end marker.
- Add crop aspect ratio display in settings editors.
- Add aspect-ratio-locked mouse resizing of crop with **Ctrl+Alt+Drag**.
- Add previous selected marker pair visual indicator.
- Add defaulting to first available marker pair when toggling or jumping between pairs.
- Add more details to tooltips (particularly for merge list and title suffix inputs).
- Add jumping to start marker not yet part of a marker pair.
- Fix jumping between markers very close together.
- Fix previews not prefering currently selectet marker pair over shortest active pair.
- Fix auto hiding of player controls when manipulating crop with mouse not hiding shadow/gradient.
- Fix missing shortcuts in shortcuts reference.
- Fix reordering marker pairs breaking marker undo.
- Fix toggling off fade preview not restoring video opacity.
- Fix fade preview not disabling when set to none in marker pair overrides and set to fade in global settings.
- Move marker pair delete shortcut from **Alt+Z** -> **Ctrl+Alt+Shift+Z**.

v0.0.87 `[2019.08.25]`:

- Use with `v3.6.0` of the `clipper script` installation.
- Redesign user interface.
  - Improve visual clarity of markers and marker numberings.
  - Add accent colors to quickly differentiate marker pair (orange) and global (red) settings editors.
  - Add accent colors to modified settings.
    - Modified global settings accented red.
    - Modified marker pair settings accented orange.
    - Marker pair settings redundant with a global setting accented red.
- Add reordering/renumbering marker pairs using the input box displayed in the marker pair settings panel.
- Add tooltips for marker pair and global settings.
- Change extra settings toggle (Shift+W) to a global setting for easier use.
- Fix being able to add speed points outside speed chart bounds.
- Fix title suffix being undefined if left blank.
- Fix deleting marker pairs not deleting associated numberings.
- Fix fade loop preview not working when loop set to fade globally only.

v0.0.86 `[2019.08.03]`:

- Use with `v3.6.0` of the `clipper script` installation.(#clipper-script-installation).
- Add special loops: Fade loops and forward-reverse (AKA ping-pong) loops.
  - Note special loops are not compatible with audio.
  - Add fade loop previewing.
- Add shortcut to toggle all previews (**Ctrl+Alt+Shift+C**).
- Add auto-hiding unselected marker pairs toggle (**Ctrl+Down**).
- Add better video stabilization preset strength scaling.
- Add new _Strongest_ level to video stabilization presets.
- Add video stabilization dynamic zoom option.
- Add marker pair numberings in user interface.
- Remove speed map rounding option as it is no longer relevant.
- Fix first and last points of time-variable speed chart not being protected from deletion.
- Improve visual clarity of time-variable speed chart.
- Fix output duration estimation for marker pairs with time-variable speed.
- Swapped previewing shortcuts base key and speed chart base key:
  - Previewing: **C** -> **D**.
  - Speed Chart: **D** -> **C**.

v0.0.85:

- Use with `v3.5.2` of the `clipper script` installation.
- Move mouse-based crop resize and move from **Shift+Click+Drag** to **Ctrl+Click+Drag**.
  - Fixes mouse-based crop shortcuts interfering with marker pair select shortcuts.
- Fix drawing new crop can select text on page.
- Fix editing new marker default crop and updating all marker pair crops.
- Fix updating all marker pair speeds to new marker default crop when the global settings editor is open.
- Fix speed chart visibility not saved when switching marker pair editors.

v0.0.84

- <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
- Use with `v3.5.2` of the `clipper script` installation. See [Clipper Script Installation](#clipper-script-installation).
- Improve crop preview visibility.
- Add **Ctrl+X** for cycling crop dim opacity by +0.25.
- Improve crop drawing experience.
  - **Click+Drag** to draw crop while showing a dynamic preview of the final crop.
  - Can now begin and end draw at any point on screen.
  - Add crosshair cursor while drawing crop.
  - Cancel drawing crop with **X** or **Shift+X**.
- Add mouse-based drag and resize of crop.
  - **Shift+Hover** over crop to get a cursor indicating potential drag action.
  - **Click+Drag** appropriate region to either drag and move crop or resize crop in the indicated directions.

v0.0.83

- Use with `v3.5.2` of the `clipper script` installation.
- Fix backwards compatibility with older markers data format.
  - Loading both new and old format with **G** should now work smoothly

v0.0.82

- Use with `v3.5.1` of the `clipper script` installation.
- Revert enabling crop adjustment with arrow keys hotkey to **Alt+X**.

v0.0.81

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
  - Uploading: **Alt+C** -> **Alt+V** and **Alt+Shift+C** -> **Alt+Shift+V**

v0.0.80

- Use with `v3.4.1` of the `clipper script` installation.
- Add cropping of **alt+Q** captured video frames based on currently selected marker pair's crop.
- Fix speed adjusted marker pair duration not updating on speed change.
- Add duration before speed adjustment to marker pair editor.

v0.0.79

- Use with `v3.4.1` of the `clipper script` installation.
- Add automatic disabling of browser default and add-on hotkeys when yt_clipper hotkeys are enabled.
- Add activation of yt_clipper on all YouTube pages and load yt_clipper on navigation to a video.
  - Still requires refreshing the browser when navigating to a new video.
- Add **alt+Q** for capturing frame at current time of video.
  - Frame must be buffered and loaded.
  - Opens a pop-up window where captured frames are saved.
    - **Download** and **Delete** buttons are provided above each captured frame.
    - You may need to allow pop-ups from `youtube.com` in your browser settings.
  - **alt+shift+Q** triggers zipping of all captured frames for download.

v0.0.78

- Fix auto looping of marker pairs even when no marker pair is selected.

v0.0.77

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

v0.0.76

- Use with `v3.3.0` of the `clipper script` installation.
- Add undoing markers with **Z** even when a marker pair is selected.
  - Undoing a currently selected marker pair will unselect it before undoing the end marker.
- Move _delete-selected-marker-pair_ hotkey from **shift+Z** to **alt+Z**.
- Add redoing undone markers with **shift+Z**.
- Add skipping frames using **shift+mouse-wheel**.
  - Scroll the mouse wheel up/down to skip forward/backward one frame per tick.
- Fix anonymous uploading to gfycat with **alt+C**.
  - Remove appending speed parameter to URL as it is no longer supported by gfycat.

v0.0.75:

- Use with `v3.2.0` of the `clipper script` installation.
- Add experimental feature for rotating YouTube video into a custom vertical theater mode.
  - Use **R** to toggle between a 90 degree clockwise rotation and no rotation.
  - Use **alt+R** to toggle between a 90 degree counter-clockwise rotation and no rotation.
  - Works only when in fullscreen mode or theater mode.
  - **Note that this does not yet work with drawing and previewing crops and should be disabled when doing so.**
  - **This feature is only for watching or previewing the video, and does not affect webm output.**

v0.0.74:

- Use with `v3.1.0` of the `clipper script` installation.
- Fix bug with crop y direction offset sometimes not accounting for variable video padding.

v0.0.73:

- Use with `v3.1.0` of the installation. Reinstall if necessary.
- Add jumping to next/previous marker or marker pair with **ctrl+LeftArrow**/**ctrl+RightArrow**.
  - Jumps to next or previous marker when no marker pair is selected.
  - When a marker pair is selected, selects the next or previous pair and jumps to its start marker.
- Add video stabilization option (access with **shift+W** additional settings editor).
- Add hotkey **alt+S** for copying markers json data to clipboard. Useful if saving breaks.

v0.0.72:

- Use with `v3.0.2` of the installation.
  - Mac install added to instructions.
- Add global encode settings editor (toggle with **shift+W** when global settings editor is open).
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

v0.0.71:

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

## Clipper Script (Installation) Changelog

v3.6.2 `[2020.01.23]`:

- See [Clipper Script Installation](#clipper-script-installation) for installation instructions.
- Use with `v0.0.89` or higher of the markup script.
  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
- Update youtube-dl dependency to [`2020.01.24`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.01.24) to fix extractor errors when trying to download YouTube videos.
- Update ffmpeg dependency to latest nightly version (`20200121-fc6fde2`) which includes an update to libvpx-vp9 (`1.8.2`).

v3.6.1 `[2019.10.25]`:

- Use with `v0.0.89` or higher of the markup script.
  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
- Fix crash on printing help with `--help` or `-h` or using the `yt_clipper_options` helper scripts.
- Add `yt_clipper_auto_interpolate` helper scripts for motion interpolating output video to 60 fps.
  - See [Additional Helper Scripts](#additional-helper-scripts) for more info.
- Fix `Very Weak` denoise preset causing crash.
- Fix strongest video stabilization preset producing unpredictable results due to an excessively high smoothing value.
- Update ffmpeg dependency to latest stable version (`4.2.1`).
- Update youtube-dl dependency to [`2019.10.22`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.10.22).

v3.6.0 `[2019.08.03]`:

- Use with `v0.0.86` or higher of the markup script.
  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
- Add special loop behaviours: Fade loops and forward-reverse (AKA ping-pong) loops.
- Add `--video-stabilization-dynamic-zoom` option.
- Improve time-variable speed filter smoothness and accuracy.
- Fix missing video color space info causing crashes.
- Fix video info fetch with ffprobe not falling back to youtube-dl.
- Update ffmpeg dependency to latest nightly (`20190802`).
- Reduce installation size by ~60% by switching to shared lib version of ffmpeg dependency.
- Update youtube-dl dependency to [`2019.08.02`](https://github.com/ytdl-org/youtube-dl/tree/2019.08.02).

v3.5.2:

- Use with `v0.0.83` or higher of the markup script.
  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
- Fix speed map filter being improperly calculated and producing unsmooth video.
  - Changed default speed map rounding to 0 (disabled) as it now produces smoother results than rounding.
- Fix audio sync issues.
- Fix audio not disabled in preview mode when streaming (caused preview to crash as this is not supported).
- Update youtube-dl dependency to [`2019.06.27`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.06.27).

v3.5.1:

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

v3.5.0:

- Use with `v0.0.81` or higher of the markup script.
  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
- Add support for time-variable speed.
- Add new `clipper script` flags and `bat/app` scripts for accessing new functions.
  - Add local previewing of markers (using ffplay) with `--preview/-p`, `yt_clipper_preview` .bat or .app file.
  - Add downloading of video before processing markers with `--download-video/-dv`, `yt_clipper_auto_download` .bat or .app file.
  - Add automatic detection of potential input videos with path stem `./webms/titleSuffix/titleSuffix-full`.
  - Add `--input-video` for manually specifying a an input video path or URL.
    - Windows: Add `yt_clipper_auto_input_video.bat` onto which a markers .json and video file can be dropped for processing.
- Windows: Simplified `yt_clipper_merge.bat` usage by auto-sorting file list received on drop.
  - See the updated [Merge Helper Bat Script Instructions](#windows-merge-helper-bat-script).
- Fix some characters breaking merge list processing due to merge inputs txt file not being encoded with utf-8

v3.4.2:

- Use with `v0.0.77` or higher of the markup script.
- Update `youtube-dl` dependency to version [`2019.06.21`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.06.21).
  - Fixes automatic fetching of YouTube videos.
- Windows: Add `yt_clipper_merge.bat` for merging webm video files on disk.
  - See the [Merge Helper Bat Script Instructions](#merge-helper-bat-script).

v3.4.1:

- Use with `v0.0.77` or higher of the markup script.
- Fix audio syncing issues where audio start time is always 0 and does not match video start time.
- Fix color space detection for DASH video.

v3.4.0:

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

v3.3.0:

- Use with `v0.0.76` of the markup script.
- Add better bitrate detection using ffprobe.
- Add logging version of markup script at top of log.
- Add decreasing ranges in merge list (eg 4-1 will merge pairs 4,3,2,1 in that order).
- Improve stabilization speed (at the cost of quality of first pass shaky output).
- Fix marker pair encode settings not being overridden by global settings.
- Fix mac ssl verification errors. Handling of DASH video and audio especially should now be fixed.

v3.2.0:

- Use with `v0.0.75` of the markup script.
- Add automatic scaling of target bitrate with marker pair cropped resolution.
  - Avoids inflating cropped webm file size.
- Now Automatically scales crop res if a mismatch is detected without user prompt.
  - Use the `--no-auto-scale-crop-res` flag if you want to disable this behavior.
- (Windows) Add dragging and dropping the `.json` marker data from _any location_ onto a `.bat` file.
- (Windows) Add dragging and dropping _multiple_ `.json` marker data files to be processed _sequentially_.
- (Windows) Add `yt_clipper_auto_simult.bat` for processing _multiple_ `.json` files _simultaneously_.
- Note that mac by default runs multiple `.json` marker files simultaneously.

v3.1.0:

- Use with `v0.0.73` of the markup script.
- Fix extra dash prepended to title suffix when title prefix is not present.
- Add video stabilization option.
- Fix bug with video titles with double quotes not being properly escaped.

v3.0.2:

- Use with `v0.0.72` of `markup script`.
- Fixed bugs with settings inheritance and overriding.

v3.0.0:

- Use with `v0.0.72` of `markup script`.
- Fix handling of DASH video and audio.
- Fix large audio files taking very long to begin encoding.
- Add additional logging for global and per marker pair settings.
- Generate log file saved alongside generated webms.
- Fix detecting mismatch of crop res height and video height.
