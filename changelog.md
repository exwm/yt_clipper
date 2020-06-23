# yt_clipper Changelog

## Markup Script Changelog

v0.0.90-beta.3.9.0-alpha.7 `[2020.06.22]`:

- Add locking last crop point's crop to second last's crop when they are initially the same and modifying second last point. Modifying the last point will always break the lock.
  - This should simplify the common workflows of creating dynamic crops.
- Force update crop string when inhering crop point crops (**Ctrl+Alt+Shift+Mousewheel**) and ignore constraints.
- Fix switching settings editors not opening new editor when currently selected crop point was not the first point.
- Fix overwriting some video properties in settings when loading markers.
  - This is useful when loading markers from a different video.

v0.0.90-beta.3.9.0-alpha.7 `[2020.06.20]`:

- Add **Alt+F** to open the YouTube subtitles editor in a new tab. This allows creating, downloading, and uploading subtitle files. Note that some videos have this feature disabled.
- Update shortcuts reference table with recently added and changed shortcuts.

v0.0.90-beta.3.9.0-alpha.3 `[2020.06.12]`:

- Add **Ctrl+Shift+Click** crop point for toggling point ease in function between instant (dimmed out) and auto.
  - The crop will jump instantly to the crop value of an instant point when the point ends a section.
- Add **Shift+A** for setting crop component of all crop points preceding currently selected point.
- Change **a** for setting crop component of all crop points to only points following currently selected point.
- Update shortcuts reference table with recently added and changed shortcuts.
- Fix YouTube side bar buttons and content blocked along with side bar pull out gesture when markup script is active.
- Fix deleting currently selected crop point improperly changing crop of other points.
- Fix crop input field not updated when selected crop point changes with video time.

v0.0.90-beta.3.9.0-alpha.1 `[2020.05.24]`:

- Add Ctrl+D for toggling dynamic crop between pan-only mode and zoompan mode.
- Shrink crop chart point size and reduce hover animations.
- Fix auto blurring when typing 'i', 'w', or 'h' in crop input field.
- Remove some unnecessary data from markers json output.

v0.0.90-beta.3.8.1 `[2020.05.24]`:

- Add 0.9 opacity level to cycle crop dim (**Ctrl+X**).
- Fix updating charts when loading new marker pair editors.
- Fix updating crop chart view when current crop chart point or section changes.
- Fix crop chart not updated when a crop point's crop changes.
  - Note that manipulating crop with mouse will not update the crop chart until the action is complete for performance.

v0.0.90-beta.3.8.0 `[2020.05.21]`:

- Add jumping to marker pair start or end when clicking the corresponding marker pair numbering with Left-Mouse.
- Add dragging marker numberings to change marker time with **Alt+LeftClick**.
  - Drag upwards to increase the precision of the numbering drag.
- Add minimum video opacity (0.2) when fade loop preview is on.
- Change default fade loop duration from 0.5 s to 0.7 s.
- Several performance improvements especially when using charts.

v0.0.90-beta.3.7 `[2020.05.13]`:

- Add blocking of pull out side bar in YouTube when markup script hotkeys are enabled.
- Add **Shift+F** for flattening VR videos. This allows easier cropping of VR videos.
- Fix current crop chart section not looping when interacting with crop with mouse and crop chart invisible.
- Fix crop chart section and thus dynamic crop preview not updating when crop chart is invisible.
- Fix YouTube search not disabling hotkeys on focus.

v0.0.90-beta.3.6 `[2020.04.04]`:

- Add additional detail to motion interpolation tooltips.
- Rename Enabled mode of motion interpolation to Numeric and Disabled to None.

v0.0.90-beta.3.6 `[2020.04.04]`:

- Add additional detail to motion interpolation tooltips.
- Rename Enabled mode of motion interpolation to Numeric and Disabled to None.

v0.0.90-beta.3.5 `[2020.04.04]`:

- Add motion interpolation to gui.
- Add using global new marker crop in frame capturer when global settings editor is open.
- Fix merge list validation holes.

v0.0.90-beta.3.4 `[2020.01.31]`:

- Fix mouse editing crops of crop points.

v0.0.90-beta.3.3 `[2020.01.31]`:

- Add seek on crop point drag start.
- Fix force set speed not working due to improperly updating speed input label.
- Fix drawing and dragging new marker default crop.
- Fix toggling off editor while also mouse dragging crop not closing crop overlay.

v0.0.90-beta.3.2 `[2020.01.26]`:

- Improve chart performance, especially when seeking video with the chart and cropping with crop chart open.

v0.0.90-beta.3.1 `[2020.01.26]`:

- Fix crop chart section inconsistently maintained when dragging or selecting crop points.
- Block context menu ending crop chart time annotation drag (**Right-MouseClick**).

v0.0.90-beta.3 `[2020.01.24]`:

- Add auto video time seeking when using **Alt+Shift+Mousewheel** to adjust marker time.
- Add auto video time seeking on crop point drag.
- Add dragging/scrubbing video time with **Right-MouseClick** using any chart.
- Add horizontally (**Shift**) and vertically (**Alt**) fixed crop drag when holding modifier keys.
- Add selecting marker pair with **Shift+Mouseover** on the end marker number.
- Add force setting video speed toggle (**Q**).
- Move cycling video speed down shortcut from **Q** to **Alt+Q**.
- Increased chart point time granularity from 0.05 s to 0.01 s.
- Add highlighting of essential shortcuts in shortcuts table.

v0.0.90-beta.2.1 `[2019.12.12]`:

- Fix marker pair looping not working when crop is static.
- Fix crop constraint not enforced when crop is static.

v0.0.90-beta.2 `[2019.12.11]`:

- Add **Ctrl/Alt+Mouseover** to select crop point as start/end of crop section.
- Change **Alt+Mousewheel** to toggle start/end mode.
  - Start mode means the currently selected crop point is the start of the current section.
  - End mode means the currently selected crop point is the end of the current section.
  - **Alt+MousewheelDown** also selects prev point if already in end mode.
  - **Alt+MousewheelUp** also selects prev point if already in end mode.
- Add **a** contextual hotkey for updating a cromp component of all crop points.
  - Works only when the cursor is inside the crop input field of the marker pair editor.
  - The crop component is selected by moving the cursor to that component.
- Fix multiple bugs with toggling and using dynamic crop chart.


v0.0.90-beta.1 `[2019.11.18]`:
- Add **Alt+D** for toggling dynamic crop chart.
- Add **Ctrl+Shift+C** for toggling dynamic crop chart preview.
- Add **Alt+Mousewheel** for selecting next/prev crop point.
- Add **Ctrl+Alt+Shift+Mousewheel** for copying crop of prev/next crop point to currently selected point.
- Note that the dynamic crop chart supports only panning for now.

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

v3.7.0-beta.3.9.0-alpha.7 `[2020.06.22]`

- Add support for `.sbv` and `.srt` subtitle files.
- Fix crash when writing clipped subtitles files because of missing `subs` directory.
- Fix `--delay` for shifting marker timings not being applied to speed map and crop map.
- Tweak automatic encode settings.
- Increase ffprobe retry delay from 1 to 2 seconds.

v3.6.3 `[2020.06.21]`:

- Note that this release is directly on top of `v3.6.2`.
- Use with `v0.0.89` or higher of the markup script.
- Update youtube-dl dependency to [`2020.06.16.1`](https://github.com/ytdl-org/youtube-dl/releases/tag/2020.06.16.1) to fix extractor errors when trying to download YouTube videos.
- Disable youtube-dl caching to avoid http 403 errors from stale signatures.
- Update ffmpeg dependency to latest mainline version (`4.2.3`).

v3.7.0-beta.3.9.0-alpha.6 `[2020.06.20]`

- Add initial support for burning (hardcoding) subtitles into clipped videos.
  - Use `--auto-subs-lang`/`-asl` and specify a two-letter language code (eg en, fr, kr, ja) to automatically fetch subs from YouTube.
  - Use `--subs-file`/`-sf` to specify a local subtitles file (only vtt format is supported for now).
  - Use `--subs-style`/`-ss` to change the style of the subs (see the clipper help output for more details).

v3.7.0-beta.3.9.0-alpha.5 `[2020.06.15]`

- Fix some loss of output video smoothness when slowing down video to non-integer multiples of the source fps.
  - This primarily impacted low fps source videos. Dynamic speed should also see smoothness improvements with this change.
- Change `--enable-vp8`/`-vp8` to use libvorbis for audio encoding instead of libopus for better compatibility.
- Update youtube-dl dependency from `v2020.5.8` to `v2020.06.16.1`.
  - This fixes some issues with the YouTube extractor (see https://github.com/ytdl-org/youtube-dl/releases)

v3.7.0-beta.3.9.0-alpha.3 `[2020.06.12]`

- Add audio fading using `--audio-fade`/`-af` with fade duration specified in seconds.
- Fix (remove) improper frame alignment correction in dynamic speed and dynamic crop filters. Frame alignment correction needs further investigation.
- Tweak automatic encode settings.
  
v3.7.0-beta.3.9.0-alpha.2 `[2020.05.25]`

- Fix dynamic crop detection using crop map. This may have caused a static crop to be used instead of a panning or zoompan crop.

v3.7.0-beta.3.9.0-alpha.1 `[2020.05.25]`

- Add zooming support to dynamic crop.
- Fix not accounting for first frame delay in dynamic crop filter. This may have led to incorrect timing of the dynamic crop by ~1 frame.
- Fix improperly rotating output video when rotate value was set to the string "0".

v3.7.0-beta.3.8.0 `[2020.05.13]`

- Add `--enable-vp8`/`-vp8` flag for using vp8 codec over the default vp9. Note that yt_clipper is not yet optimized for vp8.
- Add success log message when motion interpolation enhancements are enabled.
- Add forcing key frames at the average video frame rate.
- Add `--remove-duplicate-frames`/`-rdf` flag.
- Add `--remove-metadata`/`-rm` flag.
  - The only metadata added when this flag is not enabled is the videoTitle property from the markers .json data file.
- Add `--extra-ffmpeg-args` argument for passing extra options to ffmpeg. These are included after other options set by yt_clipper.
- Renamed `ffmpeg_elwm.exe` to [`ffmpeg_ytc.exe`](https://mega.nz/file/9SBwGSQJ#Gvge0IIQchK3nVYgkdiaQIBjk2D8BAHOrZvK23b3o9Y) and reduced its file size.
- Optimized interaction between video stabilization and motion interpolation improving speed and quality when used together.
- Reverted motion interpolation search parameter from 128 to 64.
- Fix ffmpeg from path not being used when running yt_clipper from source rather than the installation.

v3.7.0-beta.3.7.1 `[2020.05.13]`

- Fix motion interpolation (minterp) being disabled when using minterp enhancements (-eme).
  - This would cause the video to simply be sped up instead of being interpolated.

v3.7.0-beta.3.7 `[2020.05.13]`

- Adjusted minterp parameters for better results on average.
- Put minterp enhancements behind `--enable-minterp-enhancements`/`-eme` flag.
  - Requires downloading [`ffmpeg_elwm.exe`](https://mega.nz/file/NTg1SZ7R#wCTJK4nOCCvGs0VJCOJfyAaooWmIDCHPMFAYBfobs5Y) and placing it in the `./bin folder.`
  - Enhancements include skipping sections already at the target fps and forcing inclusion of original video frames. The latter increases performance at the cost of some smoothness.
- Add bitrate adjustment factors for the speed and fps of the output video.
- Add additional tweaks and parameters to vp9 encoding that optimize file size and quality better for a larger range of input videos.
- Add force key frame generation. This improves seeking and may improve playback of output video on some devices.
- Fix global settings not logged when using input video.
- Update youtube-dl dependency to `v2020.05.08`.

v3.7.0-beta.3.7-alpha.4 `[2020.04.25]`

- Add experimental changes to motion interpolation for a possible minor reduction in artifacting.
- Fix video speeding up when motion interpolation fps was set above max speed, for example when using MaxSpeedx2 mode.
- Add automatic duplicate frame removal before applying motion interpolation to avoid stuttering in low fps video sources.
- Remove minimum fps limit on motion interpolation fps.
- Disable youtube-dl caching to avoid http 403 errors from stale signatures.

v3.7.0-beta.3.7-alpha.3 `[2020.04.25]`

- Fix crash when there is a vertical section in the dynamic speed chart.
- 
v3.7.0-beta.3.7-alpha.2 `[2020.04.25]`

- Fix crash when motion interpolation is disabled.
- Increase motion interpolation scene change detection threshold.
  - This can help avoid disabling motion interpolation when there is rapid motion.
- Switch from frame duplication to pass-through for disabled sections of motion interpolation.
  - This helps avoid unnecessary frame duplication and stuttering.

v3.7.0-beta.3.7-alpha.1 `[2020.04.08]`

- Add experimental performance improvements to motion interpolation.
  - Skip interpolation of sections of source video already at target fps.

v3.7.0-beta.3.6 `[2020.04.04]`

- Add flags `--minterp-mode` and `--minterp-fps` for controlling motion interpolation settings on the command line.
- Add logging of motion interpolation settings.
- Fix missing default mode Numeric for motion interpolation.
- Fix extra video filters provided via -evf or --extra-video-filters not applying in fwrev loop mode.
- Fix VideoSpeedx2 motion interpolation mode not doubling.

v3.7.0-beta.3.5 `[2020.04.04]`

- Add better support for motion interpolation.
-  Motion interpolation is now applied after speed filters.
  - This allows smooth slow motion when combined with dynamic speed unlike when applying motion interpolation using `--extra-video-filters`/`-evf`.
- Add prompt to continue merging despite ffmpeg errors. Useful if you suspect a false positive.
- Add summary report logging.
- Revert to cubic fade loop easing and tweak smoothness using other parameters.
- Add `--only` and `--except` flags for fine-grained inclusion and exclusion of marker pairs to be processed.
  - Both options take a comma-separated list of marker pair numbers or ranges (similar to merge list).
- Add finer-grained auto encode settings.
- Add automatic retrying for fetching video info with ffprobe.
- Fix some marker pair encode setting overrides being shadowed by global settings.

v3.7.0-beta.3 `[2020.01.24]`

- Update youtube-dl and ffmpeg dependencies to match `v3.6.2` of the clipper (fixes youtube-dl extractor errors).
- Improve fade loop smoothness using circle easing.
- Add `--extra-audio-filters`/`-eaf` option for injecting extra audio filters into generated ffmpeg command.
- Add colored logging.

v3.6.2 `[2020.01.23]`:

- Use with `v0.0.89` or higher of the markup script.
- Update youtube-dl dependency to [`2020.01.24`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.01.24) to fix extractor errors when trying to download YouTube videos.
- Update ffmpeg dependency to latest nightly version (`20200121-fc6fde2`) which includes an update to libvpx-vp9 (`1.8.2`).

v3.7.0-beta.2 `[2019.12.11]`

- Switched to partially automatic builds via GitHub Actions.

v3.7.0-beta.1 `[2019.11.18]`

- Add support for dynamic crop maps.

v3.6.1 `[2019.10.25]`:

- Use with `v0.0.89` or higher of the markup script.
- Fix crash on printing help with `--help` or `-h` or using the `yt_clipper_options` helper scripts.
- Add `yt_clipper_auto_interpolate` helper scripts for motion interpolating output video to 60 fps.
  - See [Additional Helper Scripts](#additional-helper-scripts) for more info.
- Fix `Very Weak` denoise preset causing crash.
- Fix strongest video stabilization preset producing unpredictable results due to an excessively high smoothing value.
- Update ffmpeg dependency to latest stable version (`4.2.1`).
- Update youtube-dl dependency to [`2019.10.22`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.10.22).

v3.6.0 `[2019.08.03]`:

- Use with `v0.0.86` or higher of the markup script.
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
- Fix speed map filter being improperly calculated and producing unsmooth video.
  - Changed default speed map rounding to 0 (disabled) as it now produces smoother results than rounding.
- Fix audio sync issues.
- Fix audio not disabled in preview mode when streaming (caused preview to crash as this is not supported).
- Update youtube-dl dependency to [`2019.06.27`](https://github.com/ytdl-org/youtube-dl/releases/tag/2019.06.27).

v3.5.1:

- Use with `v0.0.82` or higher of the markup script.
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
