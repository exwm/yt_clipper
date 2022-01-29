# yt_clipper Changelog (Post-Version-Unification)

This changelog records all the changes to `yt_clipper` after version numbers between the markup and clipper script were unified (ie since v3.7.0-beta.3.9.0-alpha.10 `[2020.08.14]`).

- [yt_clipper Changelog (Post-Version-Unification)](#yt_clipper-changelog-post-version-unification)
  - [v5.8.0 `[2022.05.08]`](#v580-20220508)
    - [Markup Changes](#markup-changes)
    - [Clipper Changes](#clipper-changes)
  - [v5.7.1 `[2022.03.20]`](#v571-20220320)
    - [Clipper Changes](#clipper-changes-1)
  - [v5.7.0 `[2022.02.10]`](#v570-20220210)
    - [Clipper Changes](#clipper-changes-2)
  - [v5.6.0 `[2022.01.23]`](#v560-20220123)
    - [Clipper Changes](#clipper-changes-3)
    - [Documentation Changes](#documentation-changes)
  - [v5.5.2 `[2021.12.25]`](#v552-20211225)
    - [Clipper Changes](#clipper-changes-4)
  - [v5.5.1 `[2021.12.25]`](#v551-20211225)
    - [Clipper Changes](#clipper-changes-5)
  - [v5.5.0 `[2021.12.24]`](#v550-20211224)
    - [Clipper Changes](#clipper-changes-6)
  - [v5.4.2 `[2021.12.16]`](#v542-20211216)
    - [Markup Changes](#markup-changes-1)
  - [v5.4.1 `[2021.12.14]`](#v541-20211214)
    - [Clipper Changes](#clipper-changes-7)
  - [v5.4.0 `[2021.12.09]`](#v540-20211209)
    - [Clipper Changes](#clipper-changes-8)
  - [v5.3.1 `[2021.11.11]`](#v531-20211111)
    - [Clipper Changes](#clipper-changes-9)
  - [v5.3.0 `[2021.10.26]`](#v530-20211026)
    - [Clipper Changes](#clipper-changes-10)
  - [v5.2.1 `[2021.10.12]`](#v521-20211012)
    - [Clipper Changes](#clipper-changes-11)
  - [v5.2.0 `[2021.10.09]`](#v520-20211009)
    - [Markup Changes](#markup-changes-2)
    - [Clipper Changes](#clipper-changes-12)
  - [v5.1.4 `[2021.07.21]`](#v514-20210721)
    - [Clipper Changes](#clipper-changes-13)
  - [v5.1.3 `[2021.07.19]`](#v513-20210719)
    - [Clipper Changes](#clipper-changes-14)
  - [v5.1.2 `[2021.04.30]`](#v512-20210430)
    - [Markup Changes](#markup-changes-3)
  - [v5.1.1 `[2021.04.29]`](#v511-20210429)
    - [Markup Changes](#markup-changes-4)
    - [Clipper Changes](#clipper-changes-15)
  - [v5.1.0 `[2021.04.27]`](#v510-20210427)
    - [Markup Changes](#markup-changes-5)
    - [Clipper Changes](#clipper-changes-16)
  - [v5.0.0 `[2021.04.15]`](#v500-20210415)
    - [General Changes](#general-changes)
    - [Clipper Changes](#clipper-changes-17)
  - [v3.7.0-beta.4.8.3 `[2021.04.01]`](#v370-beta483-20210401)
    - [Markup Changes](#markup-changes-6)
  - [v3.7.0-beta.4.8.2 `[2021.03.31]`](#v370-beta482-20210331)
    - [Clipper Changes](#clipper-changes-18)
  - [v3.7.0-beta.4.8.1 `[2021.03.07]`](#v370-beta481-20210307)
    - [Markup Changes](#markup-changes-7)
  - [v3.7.0-beta.4.8.0 `[2021.03.05]`](#v370-beta480-20210305)
    - [Markup Changes](#markup-changes-8)
    - [Clipper Changes](#clipper-changes-19)
  - [v3.7.0-beta.4.7.0 `[2021.01.12]`](#v370-beta470-20210112)
    - [Clipper Changes](#clipper-changes-20)
  - [v3.7.0-beta.4.6.0 `[2020.12.18]`](#v370-beta460-20201218)
    - [Markup Changes](#markup-changes-9)
    - [Clipper Changes](#clipper-changes-21)
  - [v3.7.0-beta.4.5.0 `[2020.12.11]`](#v370-beta450-20201211)
    - [Markup Changes](#markup-changes-10)
    - [Clipper Changes](#clipper-changes-22)
  - [v3.7.0-beta.4.4.0 `[2020.11.04]`](#v370-beta440-20201104)
    - [Markup Changes](#markup-changes-11)
    - [Clipper Changes](#clipper-changes-23)
  - [v3.7.0-beta.4.3.0 `[2020.11.03]`](#v370-beta430-20201103)
    - [Markup Changes](#markup-changes-12)
  - [v3.7.0-beta.4.2.0 `[2020.11.01]`](#v370-beta420-20201101)
    - [Markup Changes](#markup-changes-13)
    - [Clipper Changes](#clipper-changes-24)
  - [v3.7.0-beta.4.1.0 `[2020.10.03]`](#v370-beta410-20201003)
    - [Markup Changes](#markup-changes-14)
    - [Clipper Changes](#clipper-changes-25)
  - [v3.7.0-beta.4.0.1 `[2020.09.20]`](#v370-beta401-20200920)
    - [Markup Changes](#markup-changes-15)
    - [Clipper Changes](#clipper-changes-26)
  - [v3.7.0-beta.4.0.0 `[2020.09.19]`](#v370-beta400-20200919)
    - [Markup Changes](#markup-changes-16)
    - [Clipper Changes](#clipper-changes-27)
  - [v3.7.0-beta.3.9.0 `[2020.09.14]`](#v370-beta390-20200914)
    - [Markup Changes](#markup-changes-17)
    - [Clipper Changes](#clipper-changes-28)
  - [v3.7.0-beta.3.9.0-alpha.13 `[2020.08.31]`](#v370-beta390-alpha13-20200831)
    - [Clipper Changes](#clipper-changes-29)
  - [v3.7.0-beta.3.9.0-alpha.12 `[2020.08.23]`](#v370-beta390-alpha12-20200823)
    - [Markup Changes](#markup-changes-18)
    - [Clipper Changes](#clipper-changes-30)
  - [v3.7.0-beta.3.9.0-alpha.11 `[2020.08.17]`:](#v370-beta390-alpha11-20200817)
    - [Markup Changes](#markup-changes-19)
    - [Clipper Changes](#clipper-changes-31)
  - [v3.7.0-beta.3.9.0-alpha.10 `[2020.08.14]`](#v370-beta390-alpha10-20200814)
    - [Markup Changes](#markup-changes-20)
    - [Clipper Changes](#clipper-changes-32)

## v5.8.0 `[2022.05.08]`

### Markup Changes

- Add button to download auto-saved markers data in marker data commands menu (**G**).
- Add error flash message on failure to save markers data to browser local storage.
- Fix: Use common-tags safeHtml over html on innerHTML injection to reduce xss surface, e.g. on loading markers data.

### Clipper Changes

- Fix requiring all youtube_dl alternatives to be installed.
  - Fatally log if no youtube_dl alternatives are available or if the specified youtube_dl alternative is unavailable.
  - Note: Use the  `--youtube-dl-alternative`/`-ytdla` option to switch the alternative used (current default is `yt_dlp`).
- Update `yt_dlp` dependency from  `2022.03.08.2` to `2022.4.08`.
  - See <https://github.com/yt-dlp/yt-dlp/releases>.
- Update `ffmpeg` dependency from  `5.0` to `5.0.1`.

## v5.7.1 `[2022.03.20]`

### Clipper Changes

- Fix failing to generate clips when titleSuffix has single quotes or unicode (e.g. CJK) chars and video stabilization is enabled.
  - This fix uses a new `temp` folder in the `yt_clipper` folder with intermediate files needed for the two-pass nature of video stabilization.
  - The `temp` folder may be used for other intermediate files in the future if similar workarounds are required for issues with ffmpeg.
- Update `yt_dlp` dependency from  `2022.02.04` to `2022.03.08.2`.
  - See <https://github.com/yt-dlp/yt-dlp/releases>.

## v5.7.0 `[2022.02.10]`

### Clipper Changes

- Add `--format-sort`/`-S` option for specifying the sorting used to determine the best audio and video formats to download.
  - The sorting is specified as a comma-separated list of sort fields that describe audio/video formats.
  - This option is ignored by `youtube_dl` but is supported by `yt_dlp`.
  - See <https://github.com/yt-dlp/yt-dlp#sorting-formats> for details and descriptions on available sort fields.
  - The default value of `--format-sort`/`-S` is set to use a sort closer to the behavior of `youtube_dl`.
    - The sort is similar to the default of `yt_dlp` but favors higher filesize and bitrate over specific codecs.  
- Update `yt_dlp` dependency from  `2021.12.27` to `2022.02.04`.

## v5.6.0 `[2022.01.23]`

### Clipper Changes

- Add `preprocess_hevc` utility script that quickly processes `hevc` video files so they are compatible.
  - This utility script should only be necessary with some `hevc` input videos.
  - If you see errors like `Invalid data found when processing input` from ffmpeg try this utility script.
- Fix corruption/artifacting of `av1` video inputs with video stabilization enabled.
  - This required removing a sharpening filter intended to reduce blur introduced by video stabilization.
- Fix failure to merge clips with single quotes in file path.
- Update `youtube_dl` dependency from `v2021.06.06` to `v2021.12.17`.
- Update `ffmpeg` dependency from `v4.4.1` to `v5.0`.

### Documentation Changes

- Add section on `utility scripts` that work without `yt_clipper`. For example, the `merge` utility script for merging input videos with ffmpeg.
  - Previously, `utility scripts` were grouped with helper scripts.
  - To add distinction between helper scripts that wrap `yt_clipper` and these other scripts, the term `utility script` was introduced.

## v5.5.2 `[2021.12.25]`

### Clipper Changes

- (vlive) Fix crash on logging audio and video format information.
- Update `yt_dlp` dependency from `v2021.12.01` to `v2021.12.27`.
  - See <https://github.com/yt-dlp/yt-dlp/releases/tag/2021.12.25> and <https://github.com/yt-dlp/yt-dlp/releases/tag/2021.12.27>.

## v5.5.1 `[2021.12.25]`

### Clipper Changes

- Fix crash when using input video mode (`--input-video`/`-iv` option or  `yt_clipper_auto_input_video` helper script).

## v5.5.0 `[2021.12.24]`

### Clipper Changes

- Fix some YouTube audio/video formats unavailable when the format uses MPEG-DASH.
- Add additional logging of audio/video format info (codec, id, mpeg-dash usage).
- Update ffmpeg from `20200831-4a11a6f` to `v4.4.1`.
  - This includes a fix to ffmpeg crashing on large videos that use MPEG-DASH.
  - This includes an update to libvpx-vp9 `v1.11.0`.
  - macOS ffmpeg builds switched to static and will take up more space on disk. Shared builds are no longer readily available.

## v5.4.2 `[2021.12.16]`

### Markup Changes

- Fix marker pair looping crash on video resolution change

## v5.4.1 `[2021.12.14]`

### Clipper Changes

- (Mac) fix ssl errors when downloading video

## v5.4.0 `[2021.12.09]`

### Clipper Changes

- Update `yt_dlp` dependency from `v2021.11.10` to `v2021.12.01`.
  - See <https://github.com/yt-dlp/yt-dlp/releases/tag/2021.12.01>.

## v5.3.1 `[2021.11.11]`

### Clipper Changes

- Update `yt_dlp` dependency from `v2021.10.22` to `v2021.11.10`.
  - See <https://github.com/yt-dlp/yt-dlp/releases/tag/2021.11.10>.

## v5.3.0 `[2021.10.26]`

### Clipper Changes

- Change default youtube-dl alternative (`--youtube-dl-alternative`) to `yt_dlp`.
- Update `yt_dlp` dependency from `v2021.10.10` to `v2021.10.22`.
  - See <https://github.com/yt-dlp/yt-dlp/releases/tag/2021.10.22>.

## v5.2.1 `[2021.10.12]`

### Clipper Changes

- Fix `yt_dlp` alternative not being used even when set using  `--youtube-dl-alternative yt_dlp` or `-ytdla yt_dlp`. 
- Update `yt_dlp` dependency from `v2021.09.26` to `v2021.10.10`.
  - Includes some fixes to downloading YouTube video information.
  - See <https://github.com/yt-dlp/yt-dlp/releases/tag/2021.10.09> and <https://github.com/yt-dlp/yt-dlp/releases/tag/2021.10.10>.
  - Note: You can set `--youtube-dl-alternative yt_dlp` to be used by default inside the `default_args.txt` file included in the `clipper` script folder.

## v5.2.0 `[2021.10.09]`

### Markup Changes

- Fix markers with a start or end time of `0` incorrectly loaded from markers json files.
- Remove unused `outputDuration` key from saved markers json.

### Clipper Changes

- Add `--youtube-dl-alternative`/`-ytda` option.
  - The options currently are `youtube_dl` or `yt_dlp`.
  - The `yt_dlp` alternative is currently being more regularly updated and includes some fixes over `youtube_dl`.
    - For example, some slowdown issues when downloading videos seem to be fixed in `yt_dlp`.
    - This `yt_clipper` release includes `yt_dlp` `v2021.09.26`.
  - Usage of `yt_dlp` is currently experimental and may have unexpected behavior.
    - See <https://github.com/yt-dlp/yt-dlp#differences-in-default-behavior> for more information.
- Show default option values when printing help with `--help` or the `yt_clipper_options` helper script.
- Fix incorrect `--preview` help string.

## v5.1.4 `[2021.07.21]`

### Clipper Changes

- (Win) Fix false positive warnings from anti-virus software.
  - Fixed pyinstaller version to `v4.3`.

## v5.1.3 `[2021.07.19]`

### Clipper Changes

- Update youtube_dl dependency from [`v2021.04.26`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.04.26) to [`v2021.06.06`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.06.06)

## v5.1.2 `[2021.04.30]`

### Markup Changes

- Fix marker pair looping bypassed when manipulating crop and crop chart not yet initialized.

## v5.1.1 `[2021.04.29]`

### Markup Changes

- (YouTube) Fix failing to load due to recent changes to YouTube.

### Clipper Changes

- (Mac) Fix helper scripts not recognized as executables (lacking executable permissions).

## v5.1.0 `[2021.04.27]`

### Markup Changes

- Fix markers data commands menu not automatically closed after loading data.
- Fix forced current crop chart section looping bypassed when manipulating crop.
- Fix: reduce frequency of extra frames being played before seeking to start in loop previewing.

### Clipper Changes

- Fix ffmpeg crash on long YouTube dash manifests by skipping the manifest.
- Update youtube_dl dependency from [`v2021.04.07`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.04.07) to [`v2021.04.26`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.04.26)

## v5.0.0 `[2021.04.15]`

### General Changes

- Merge all beta changes into mainline.
- Update readme.

### Clipper Changes

- Update youtube_dl dependency from [`v2021.04.01`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.04.01) to [`v2021.04.07`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.04.07).

## v3.7.0-beta.4.8.3 `[2021.04.01]`

### Markup Changes

- (vlive) Fix failing to load video info on video post urls with a path like `/post/0-9999`.

## v3.7.0-beta.4.8.2 `[2021.03.31]`

### Clipper Changes

- Fix crash on printing help.
- Update youtube_dl dependency from [`v2021.03.03`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.03.03) to [`v2021.04.01`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.04.01).

## v3.7.0-beta.4.8.1 `[2021.03.07]`

### Markup Changes

- Fix some functionality (e.g. loading comments) on YouTube breaking under certain conditions.
  - Caused by lack of sandboxing leading to dependency conflicts between YouTube and yt_clipper.
- Fix crop crosshair not updated when toggled on.
- Fix crop crosshair not updated when manipulating global new marker crop

## v3.7.0-beta.4.8.0 `[2021.03.05]`

### Markup Changes

- Add crop crosshair toggled with **Ctrl+Shift+X**.
- Add interpolation of speed and crop when moving markers (i.e. adjusting marker times).
  - Moving markers now largely preserves the existing dynamic speed/crop.
- Fix moving markers not removing chart points at target time.
  - This could crash processing of speed/crop filters due to multiple points at the same time.
- Fix aspect ratio reported in settings editor not updated when changing selected crop point.
- Fix crop chart not updated when chart section changes (but selected point does not).

### Clipper Changes

- Update youtube_dl dependency to [`v2021.03.03`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.03.03).

## v3.7.0-beta.4.7.0 `[2021.01.12]`

### Clipper Changes

- Add `--video-stabilization-max-angle`/`-vsma` to set the per-frame maximum angle in degrees for rotation-based stabilization when video stabilization is enabled.
  - The default value is changed from -1 for unlimited degrees to 0 degrees as video stabilization tends to introduce erroneous rotation.
  - If your source video has wobble and needs rotation-based stabilization use this option.
- Add `--video-stabilization-max-shift`/`-vsms` to set the per-frame maximum shift in pixels for shift-based stabilization when video stabilization is enabled.
  - The default value remains -1 for unlimited shift.
- Fix crash on long ffmpeg commands due to length limits on some shells, for example when using dynamic crop with many crop points.
- Update to latest youtube_dl dependency [`v2021.01.08`](https://github.com/ytdl-org/youtube-dl/releases/tag/2021.01.08).

## v3.7.0-beta.4.6.0 `[2020.12.18]`

### Markup Changes

- Fix reopening marker pair editor does not show dynamic speed duration estimate when speed is dynamic.
- Fix marker pair speed not synced with first speed point when manipulating speed chart.
- Fix marker pair crop not synced with first crop point when crop points are auto updated to meet crop constraints.

### Clipper Changes

- Add `--no-remove-duplicate-frames`/`-nrdf` flag to force disable duplicate frame removal.
  - Duplicate frames are automatically removed for low fps video when motion interpolation is enabled.
- Fix various bugs with motion interpolation due to automatic duplicate frame removal.
  - Fix stutter in some videos when using zoompan and motion interpolation together.
  - Fix automatic duplicate frame removal not aggressive enough for low fps video with frame stutter.
  - Fix automatic duplicate frame removal speeding up fake high fps videos that use frame doubling via frame duplication.
- Fix input omission regex in ffmpeg command print out not applied to multiple inputs.

## v3.7.0-beta.4.5.0 `[2020.12.11]`

### Markup Changes

- Add auto saving markers data to browser local storage in markers data commands menu (**G**).
  - Auto saving is started only after a marker pair has been created.
  - Markers data is automatically saved every 5 seconds, overwriting the last save.
  - Browser local storage is preserved across tab restarts.
  - Browser local storage is only preserved across browser restarts when not in private/incognito mode.
  - Private/incognito mode browsing does not share local storage with normal mode.
- Add clearing all markers data files from local storage in markers data commands menu (**G**).

### Clipper Changes

- Add `--version`/`-v` flag for printing current yt_clipper and youtube_dl versions.
- Add youtube_dl version to logging and report output when running yt_clipper.
- Switch back to latest youtube_dl dependency [`v2020.12.09`](https://github.com/ytdl-org/youtube-dl/releases/tag/2020.12.09).

## v3.7.0-beta.4.4.0 `[2020.11.04]`

### Markup Changes

- (vlive) Add support for video post urls with a path like `/post/0-9999`.
- (vlive) Add more responsive UI and video width when markup script is active.
- (vlive) Remove left side bar when markup script is active.

### Clipper Changes

- (vlive) Fix extracting and downloading videos.
  - Temporarily switched to a custom build of youtube_dlc, a community fork of youtube_dl.

## v3.7.0-beta.4.3.0 `[2020.11.03]`

### Markup Changes

- Fix marker pair duration text in UI not updated on speed input change or speed chart change.
- Fix mouse manipulation of new marker crop incorrectly expecting to save marker pair undo state.
  - This would break mouse manipulation of new marker crop when no marker pairs had previously been selected.
  - If a marker pair had been previously selected, it would add a redundant undo state to its undo history on crop mouse manipulation end.
- (vlive) Fix left side bar blocking video on small width browser windows.

## v3.7.0-beta.4.2.0 `[2020.11.01]`

### Markup Changes

- Add mouse scrubbing/seeking video time.
  - Use **Alt+Click+Drag** on video left/right to seek backward/forward.
- Add use of pointer events over mouse events for better pointer device compatibility.
- Fix start marker numbering not moving when start marker moved.
- Fix speed map and speed chart not synced in some cases.
- (youtube) Fix speed chart blocking player progress bar.
- (vlive) Add larger vlive theater mode after script is activated.
- (vlive) Fix script incompatibilities with new vlive interface.
- (vlive) Fix invalid crop resolution when script loaded before video.
  - Note that for now the script will silently refuse to activate until the video page is ready.

### Clipper Changes

- Tweak audio encoding settings.
- Fix input video omission regex from ffmpeg command print out
- Update youtube-dl from `v2020.09.20` to [`v2020.11.01`](https://gitlab.com/dstftw/youtube-dl/-/blob/master/ChangeLog).
  - This includes some fixes for youtube but not yet for vlive.

## v3.7.0-beta.4.1.0 `[2020.10.03]`

### Markup Changes

- Fix media type for markers json download causing incorrect extension `.txt` on some systems.
- Fix frame capture not scaling correctly when video resolution does not match crop resolution.
- Fix crop resolution could be invalid if script loaded before video.
- (youtube) Fix script-based video seeking not updating progress bar when paused.
- (youtube) Fix video overscaled and cut off in some cases.
- (youtube) Fix rotated video not properly centered and scaled.

### Clipper Changes

- Fix crash due to incorrect bit rate extraction for dash video.
- Tweak audio encoding settings.
- Update youtube-dl from `v2020.09.06` to [`v2020.09.20`](https://github.com/ytdl-org/youtube-dl/releases/tag/2020.09.20).

## v3.7.0-beta.4.0.1 `[2020.09.20]`

### Markup Changes

- Fix video and crop overlay not realigned when video container is resized.
- Fix space key blocked on inputs.
- (vlive) Fix player controls gradient/shadow not hidden when mouse manipulation crops.
- (vlive) Fix radio and choose file inputs not displayed.
- (vlive) Fix top region of crop area blocked from manipulation.
- (vlive) Fix unable to mouse over end marker to select pair.
- (vlive) Fix search and chat text inputs triggering yt_clipper hotkeys.

### Clipper Changes

- Fix crash when audio enabled for a marker pair but not enabled globally.

## v3.7.0-beta.4.0.0 `[2020.09.19]`

### Markup Changes

- Add initial vlive.tv support.
- Change default Title Suffix format from `[videoID]` to `[platform@videoID]`.

### Clipper Changes

- Add initial vlive.tv support.

## v3.7.0-beta.3.9.0 `[2020.09.14]`

### Markup Changes

- Add per-markerpair undo/redo for speed and crop changes to **Alt+Z/Alt+Shift+Z**
- Add **Ctrl+Shift+A** for duplicating the currently or previously selected marker pair.
- Add accounting for browser window scroll position when mouse manipulating crops.
- Add dimmed grey font color to inherited setting values.
- Increase speed chart transparency.
- Reduce settings editor size so more of the UI can fit into the browser window.
- Change all inherited setting value options from `Inherit (...)` to simply `(...)`.
- Normalize dropdown menu option order in settings editors.
  - Options are now in descending order by effect strength.
- Fix red chart time bar not properly updating in some cases.
- Fix chart loop markers not rendering (invisible).

### Clipper Changes

- Add `--notify-on-completion`/`-noc` flag that provides a notification when yt_clipper completes a run.
- Add `--overwrite/-ow` flag that enables regenerating and overwriting existing clips.
- Add unknown arguments list in summary report.
- Fix `--video-stabilization-dynamic-zoom`/`-vsdz` not behaving as a flag.
  - This option used to expect an argument like `True`.
- Update ffmpeg from `v20200814-a762fd2` to `v20200831-4a11a6f`.
- Update youtube-dl from `v2020.07.28` to [`v2020.09.06`](https://github.com/ytdl-org/youtube-dl/releases/tag/2020.09.06).
  - (youtube) Fix age gate content detection.
  - (youtube:user) Extend URL regular expression.

## v3.7.0-beta.3.9.0-alpha.13 `[2020.08.31]`

### Clipper Changes

- Fix auto scaling crops incorrect when crop resolution is greater than video resolution.
- Fix printing summary report failing to encode utf-8 when writing to log file on some systems.

## v3.7.0-beta.3.9.0-alpha.12 `[2020.08.23]`

### Markup Changes

- Add per-marker-pair zoompan mode setting.
- Add tooltip for marker pair duration display.
- Remove speed maps enable/disable setting from markup gui.
- Fix deleting speed points doesn't update speed input properly.
- Fix highlighting speed and crop settings in markup gui.
- Fix crop constraints not applied when manipulating last point of a static, 2-point crop map.
- Fix minimum crop size constraint not enforced when drawing crop.
- Fix minor deviations in final crop when ending mouse-based resize/draw.
- Fix crop constraints sometimes not maintained when manipulating crop with mouse.
- Fix marker pair output duration estimate always assuming variable speed.
- Remove **Ctrl+D** hotkey for toggling global crop chart mode between pan-only and zoompan mode.

### Clipper Changes

- Add `--args-files` for reading `yt_clipper` arguments from 1 or more files.
  - By default this is set to `default_args.txt` which is included with the clipper install.
  - For more information on how to use such arg files see the comments inside `default_args.txt`.
- Add `--target-size`/`-ts` argument for restricting the file size of generated clips.
  - Takes a target file size in megabytes and automatically calculates an appropriate constant bitrate for encoding each marker pair.
- Add additional logging and log levels/colors.
- Fix color codes present in log file summary report.
- Fix logging of ffmpeg command mangled in some rare cases.
  
## v3.7.0-beta.3.9.0-alpha.11 `[2020.08.17]`:

### Markup Changes

- Fix drawing crop sometimes breaks due to use of incorrect crop map index.

### Clipper Changes

- Fix incorrect crops resulting from crop resolution not being auto scaled.
- Add `vid2gif` helper script. Use as usual with 1 or more video file inputs.

## v3.7.0-beta.3.9.0-alpha.10 `[2020.08.14]`

### Markup Changes

- Revamp internal cropping system.
  - Manipulating crops should now always maintain the correct constraints. The mechanism for this has changed.
    - Most notably, when zoompan is enabled all crop points will maintain the same aspect ratio.
    - When resizing a crop point in pan-only mode or reshaping (changing aspect ratio) in zoompan mode, all other crop points will now be resized and panned as necessary to match.
  - Aspect-ratio-locked resizing (from a corner) and drawing is now smoother.
- Add **Shift** modifier for center-out resizing and drawing of crops with the mouse.
  - Note that this can be combined with aspect-ratio locking.
- Fix seeking video to current video time causing video buffering spinner to show on YouTube.
  - This may have caused imprecise crop aspect ratios being reported.
- Fix unable to draw and resize global new marker crop in some cases.
- Fix shortcuts table and frame capturer zip progress not working.
- Fix editing crop input field could improperly apply constraints.
- Stabilize build process to support most browsers since 2019 rather than the most recent ~4 browser versions.
- Remove vertical-fill drawing of crops (**Shift+X**).

### Clipper Changes

- Add warning for unknown arguments provided to `clipper` script.
- Add handling of mixed input video file extensions in `merge` helper script.
- Add clarification of required format of start and end time inputs to `fast_trim` helper script.
- (Mac) Add `merge` and `fast_trim` helper scripts.
- Fix crop panning and zooming jitter.
- Fix removing useful frames when using `-rdf` or minterp due to low mpdecimate thresholds.
- Fix `merge` helper script always using `webm` container even when all inputs use some other format.
- (Win) Fix  `fast_trim` helper script outputting video file with extra `.` before extension.
- (Mac) Fix `yt_clipper_preview` helper script crashing due to syntax error.
- (Mac) Fix helper scripts could mangle backslashes when reading user input.
- Tweak automatic encode settings.
- Remove gfycat anonymous uploading feature (`--gfycat`).
- Rename `yt_clipper_merge` and `yt_clipper_fast_trim` helper scripts to simply `merge` and `fast_trim`.
- Update ffmpeg dependency to latest nightly version (`20200814-a762fd2`).
