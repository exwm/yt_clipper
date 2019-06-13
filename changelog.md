# yt_clipper Changelog

## Markup Script Changelog

- v0.0.79

  - <a href="https://openuserjs.org/install/elwm/yt_clipper.user.js">Click to install markup script</a>
  - Use with `v3.4.1` of the `clipper script` installation. See [Clipper Script Installation](#clipper-script-installation).
  - Add automatic disabling of browser default and add-on hotkeys when yt_clipper hotkeys are enabled.
  - Add activation of yt_clipper on all YouTube pages and load yt_clipper on navigation to a video.
    - Still requires refreshing the browser when navigating to a new video.
  - Add **alt+Q** for capturing frame at current time of video.
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
