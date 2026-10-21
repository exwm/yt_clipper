# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [5.49.0](https://github.com/exwm/yt_clipper/compare/v5.48.0...v5.49.0) (2026-10-31)

### Highlights

#### Crop Easing

Use the **Crop Easing** setting to choose how a dynamic crop moves between crop points. Find it in the global settings editor, and override it per marker pair.

* **Smooth Track (default):** The crop keeps moving through points without stopping at each one. Use it to follow a moving subject.
* **Cinematic:** The crop follows the points within a margin, with steady holds and constant-speed pans. Use it for camera-like motion. Set the margins, or pick **Weak**, **Medium** or **Strong**, with the gear button next to **Crop Easing**. A plot there compares the Cinematic path with the other modes.
* **EaseInOut:** The crop easing from before 5.49.0, which slows to a stop at every point. Markers data saved before 5.49.0 uses it.
* See [this readme section](https://github.com/exwm/yt_clipper#crop-easing) for the full details.

<img src="https://raw.githubusercontent.com/exwm/yt_clipper/v5.49.0/assets/image/yt_clipper_cinematic_settings.png" alt="yt_clipper_cinematic_settings.png" width="388">

#### Hold Points

A hold point keeps the crop of the crop point before it, and follows when that point changes. Hold points have a vertical yellow bar behind them. A new marker pair ends in a hold point.

* **Ctrl+Shift+Click:** Toggle a crop point between hold and normal.
* **Ctrl+Alt+A:** Add a hold point at the current time, or toggle the crop point under the playhead.
* **Ctrl+Alt+Shift+Click:** Toggle crop point easing between auto and instant (moved from **Ctrl+Shift+Click**).
* With Cinematic crop easing, the crop slows evenly into each hold. Set **Hold Points** to **Firm** to let it stop within the **Pan Margin**.
* See [this readme section](https://github.com/exwm/yt_clipper#crop-chart-shortcuts) for the full details.

<img src="https://raw.githubusercontent.com/exwm/yt_clipper/v5.49.0/assets/image/yt_clipper_hold_crop_points.png" alt="yt_clipper_hold_crop_points.png" width="640">

#### Update Checks and Shared Settings

* Run `yt_clipper_check_for_updates.bat` (Windows) or `yt_clipper_check_for_updates` (Mac), or pass `--check-for-updates`, to check for a newer `clipper script`.
* Put settings every version should use (for example `--cookies`) in `yt_clipper_default_args.txt` in the folder that holds your yt_clipper installs. An install's own `default_args.txt` overrides it.
  * Keep your installs in a folder of their own, not in your downloads folder. A `yt_clipper_default_args.txt` saved next to them can set the folders the `clipper script` runs ffmpeg and yt-dlp from.
  * Put options new in 5.49, such as `--accept-lower-quality`, in the install's own `default_args.txt`. Older versions stop on an option they do not know.
* Click **Releases** at the bottom right of the command palette (**Shift+E**) to see what changed.
* See [this readme section](https://github.com/exwm/yt_clipper#updating) for the full details.


### ⚠ BREAKING CHANGES

* **clipper:** clips from existing markers files can start or end one frame differently. A clip now starts on the frame shown at its start marker and ends on the frame shown at its end marker.
* **markup:** **Ctrl+Shift+Click** on a crop point now toggles hold instead of instant easing. Instant easing moved to **Ctrl+Alt+Shift+Click**.
* **clipper:** when an install's `default_args.txt` and the shared `yt_clipper_default_args.txt` set the same option, the install's file now wins.
* **clipper:** the `clipper script` no longer accepts shortened option names, such as `--overwr` for `--overwrite`. Use the full name.
* **clipper:** running the `clipper script` from another folder now also reads the install's own `default_args.txt`. The shared `yt_clipper_default_args.txt` is now read from the folder that holds the installs, not the folder above the working folder.
* **clipper:** when only a lower quality format can be downloaded and nobody can answer the prompt (a scheduled run, or stdin closed), the run now stops with exit code 1. Pass `--accept-lower-quality` to clip at the lower quality without asking, as before.

### Features

* **clipper+markup:** add Cinematic crop easing: the crop follows crop points within a margin, with steady holds and constant-speed pans ([779470a](https://github.com/exwm/yt_clipper/commit/779470aa5222ce10ae8ec6f1266ed43a6550991b))
* **clipper+markup:** add the Crop Easing setting: in its default Smooth Track mode, a dynamic crop keeps moving through crop points instead of stopping at each one ([f87156b](https://github.com/exwm/yt_clipper/commit/f87156bca7e6fd48d4e228617861559c6ef58150))
* **clipper+markup:** Cinematic crop easing holds the crop still at hold points, stopping within the margin or easing evenly into and out of them (`Hold Points`: Loose, Firm or Exact in the Crop Easing settings) ([12351b4](https://github.com/exwm/yt_clipper/commit/12351b41f68e978f699f35c0bff60a6ae7376dcc))
* **clipper+markup:** hold crop points, which show the crop of the crop point before them and follow it when it changes + a new marker pair's end point is a hold point ([38b2897](https://github.com/exwm/yt_clipper/commit/38b2897bf59d90eae2fd55432b0d698fa2d3d220))
* **clipper+markup:** Weak, Medium and Strong presets for the Cinematic margins, which scale with the crop size ([5fe950f](https://github.com/exwm/yt_clipper/commit/5fe950f8ca793b4f0798f144d820e5662c271a0d))
* **clipper:** ask before continuing with a lower quality format when a higher quality one cannot be downloaded (`--accept-lower-quality` continues without asking) + show the selected formats in green and those that cannot be downloaded in red + a video URL with a playlist (`&list=`) clips that video ([22fe9ae](https://github.com/exwm/yt_clipper/commit/22fe9ae2182491e6a845581a4e8ceb04e7a442cf))
* **clipper:** check for a newer `clipper script` with `--check-for-updates` or the `yt_clipper_check_for_updates` helper + keep settings across versions in `yt_clipper_default_args.txt` + warn when a markers JSON comes from a newer `markup script` ([6316009](https://github.com/exwm/yt_clipper/commit/6316009a36a09e61f9dec413e80e6b25e29cc467))
* **clipper:** helper scripts offer to run again with more options, and end at a command prompt in the yt_clipper folder instead of closing ([afbdeaa](https://github.com/exwm/yt_clipper/commit/afbdeaabcf2760618fbcff36a5934ed0f71d49db))
* **clipper:** releases include `yt_clipper_help.txt`, which lists every option and its help + the readme names the `--markers-json` option correctly ([5eb4d5e](https://github.com/exwm/yt_clipper/commit/5eb4d5e64faa9de8bccb634307bfb05e0f832942))
* **clipper:** warn when a markers JSON was saved with another version of the Cinematic crop easing ([e432254](https://github.com/exwm/yt_clipper/commit/e4322542c7bd695a1454c98327b12e2327768563))
* **clipper:** warn when the input video's frame rate varies, since clips then use a constant frame rate and their first or last frame can be a frame off ([e61c9c2](https://github.com/exwm/yt_clipper/commit/e61c9c21802eb22104918fa3c59254c1be1bca3d))
* **markup:** add a command palette toggle that turns off measuring the frame rate from playback, remembered in this browser ([9cbdddc](https://github.com/exwm/yt_clipper/commit/9cbdddc56ab59d03063d33524f435aee672b0b3f))
* **markup:** command palette footer links to the releases and shows the `markup script` version + rename its buttons to All shortcuts and Repo ([363112a](https://github.com/exwm/yt_clipper/commit/363112a198b6a4eead8608625515fa365fcbc05d))
* **markup:** crop chart: label the crop size only where it changes, and leave points that hold the same crop unlabeled ([7afdac4](https://github.com/exwm/yt_clipper/commit/7afdac4982c8010907403ea54e47df9fad8430eb))
* **markup:** flash the video frame rate once it is measured from playback, and again when it changes ([eb234fe](https://github.com/exwm/yt_clipper/commit/eb234fe1addb32e32c8450c9947da80819d8383e))
* **markup:** hold crop points show a yellow bar on the crop chart ([e83fc3a](https://github.com/exwm/yt_clipper/commit/e83fc3a9e5086eeb177f533e0d7165c497d040c4))
* **markup:** plot the crop path against the crop points and the other crop easings in a marker pair's Crop Easing settings, with X, Y and Zoom lanes to show or hide and the margins drawn around the points, and switch between Smooth Track, Cinematic and EaseInOut there to compare them + add sliders for the margins ([5407d9c](https://github.com/exwm/yt_clipper/commit/5407d9cd11036a54e82fb3dd68e778287c3a436c))
* **markup:** Tampermonkey checks each library the `markup script` loads against its pinned sha256 ([5734d72](https://github.com/exwm/yt_clipper/commit/5734d722c3d304335016685c4ba5be2f4c415ca9))
* **markup:** the Crop Easing settings plot shows hold points with a yellow bar, as the crop chart does ([97ac49c](https://github.com/exwm/yt_clipper/commit/97ac49c4386da9e63b15bc5564e0ee808f55e83e))
* **markup:** the marker pair duration also shows its frame count + reads Dur to save space ([ee63622](https://github.com/exwm/yt_clipper/commit/ee636227e0a9d6cf5d5e278596b2e7d1c70fd285))
* **markup:** the Measure button reads Measured with a green border once the frame rate is measured + the readout shows only the rate ([17ec809](https://github.com/exwm/yt_clipper/commit/17ec809845b0a88b55a2f48d19a52be5bd3ca129))
* **markup:** the title prefix field refuses a double quote or backslash, which the clipper replaces with `_` in clip names ([3a2484f](https://github.com/exwm/yt_clipper/commit/3a2484f259214360a7fc97825162c479f7b3717c))
* **markup:** toggle hold on a crop point with ctrl+shift+click or under the playhead with ctrl+alt+a, which also adds a hold crop point at the current time + move the instant easing toggle to ctrl+alt+shift+click ([d7e0879](https://github.com/exwm/yt_clipper/commit/d7e0879b322f61aa90d85fc26c9f6c253de0cba9))


### Bug Fixes

* **clipper:** `--download-video` should work when yt-dlp downloads a single file, which it kept in its own container (such as `.mp4`) instead of `.mkv` + releases should pass yt-dlp a bundled ffmpeg path it can use ([e6142c1](https://github.com/exwm/yt_clipper/commit/e6142c1ba211ab1e0faa27823e38184e6ea8a927))
* **clipper:** `h264_nvenc` clips should use the `-temporal-aq` spelling, which ffmpeg 9 requires and ffmpeg 8 also accepts ([c35897a](https://github.com/exwm/yt_clipper/commit/c35897a81851d347ec531b2d81e37e0fc47d7f14))
* **clipper+markup:** an instant or eased crop point should take effect on the frame it was placed on, not one frame early ([e261eac](https://github.com/exwm/yt_clipper/commit/e261eac8ed7b703d7f209751ec07acf295f30e39))
* **clipper+markup:** instant crop points should cut on the frame the point falls in when the marker pair starts between frames ([b9bdb7c](https://github.com/exwm/yt_clipper/commit/b9bdb7ce231c6b5ff7b70b53fcb101d797dc214d))
* **clipper:** a `--ytdl-password` set in a settings file should not be printed to the console or the log ([23645cc](https://github.com/exwm/yt_clipper/commit/23645cc0e20674dba97f7fbe2be928e5f34924de))
* **clipper:** a clip should start on the frame shown at its start marker and end on the frame shown at its end marker + audio at normal speed should start in sync with the video ([d2a42f6](https://github.com/exwm/yt_clipper/commit/d2a42f6b94adab23e69b0c9cc59db186467e9537))
* **clipper:** a found or typed input video path with square brackets should be logged as it is, not with part of it missing ([ea75b47](https://github.com/exwm/yt_clipper/commit/ea75b47070c0baf769b45ba01019fd383aa81718))
* **clipper:** a run should exit with an error code when a clip fails + end with a clear message instead of a traceback when yt-dlp or another tool fails ([85ab6c6](https://github.com/exwm/yt_clipper/commit/85ab6c60a1f7ee6d8815c60f1acc475d6c95172b))
* **clipper:** a title prefix or markers file name with a double quote or a line break should not add ffmpeg options or merge inputs on macOS and Linux ([7da8046](https://github.com/exwm/yt_clipper/commit/7da80462be03ad2af37c0ba759eb80598acc72d3))
* **clipper:** a video title, page URL or site format id with square brackets should be logged as text instead of stopping the run ([26b908b](https://github.com/exwm/yt_clipper/commit/26b908b01aaf5e6a9ee32a60ef1387aca450d212))
* **clipper:** clipping should fall back to the bit depth from yt-dlp instead of crashing when ffprobe cannot read the video, and clip as 8-bit when yt-dlp does not report the dynamic range + a local video ffprobe cannot read should stop with a clear message ([12cb48b](https://github.com/exwm/yt_clipper/commit/12cb48b2121a073e14748b9da4a5b48ffaccbd88))
* **clipper:** clips cut from a local or downloaded video whose audio starts before its video should start on the marker pair's frame and keep the crop in time ([9df0678](https://github.com/exwm/yt_clipper/commit/9df0678b33c5a7b69f56334f14734ad27d037f5f))
* **clipper:** long video filters, such as a zooming crop with many crop points, should work with ffmpeg 9, which removed `-filter_script`, and in previews on Windows ([ac83a5e](https://github.com/exwm/yt_clipper/commit/ac83a5e119592d56a3cb4ea1a2b7b6bf5a990693))
* **clipper:** markers JSON crops with a zero width or height, values with a trailing newline, and numbers too large to use should be rejected + a markers JSON file that is not UTF-8 should stop with a clear error ([c666bc7](https://github.com/exwm/yt_clipper/commit/c666bc70273f9267c8edaf82cee2eef2ae1af32e))
* **clipper:** previews of a local video whose timestamps start after zero should start at the marker pair start, as the clip does ([24759ab](https://github.com/exwm/yt_clipper/commit/24759ab2e0a15f76e88193a99744dc3bf89916ac))
* **clipper:** settings files should accept quoted paths with spaces, a byte order mark and non-UTF-8 text + settings files and the bundled tools should be found next to the install, whatever folder the clipper runs from ([8771d30](https://github.com/exwm/yt_clipper/commit/8771d30793da630b6f17aae1f038d03a76660e8c))
* **clipper:** subtitles should burn in for a markers file whose name has an apostrophe, comma or semicolon, which also kept that name from adding filters ([4dea20d](https://github.com/exwm/yt_clipper/commit/4dea20d02bf306fe6238a2e2df3831ff7b7a5548))
* **clipper:** the clipper's log messages should follow a log level change made after the first message, as other loggers do ([60daed6](https://github.com/exwm/yt_clipper/commit/60daed6e8c5349f3d97f02c60764b2119d9b84b6))
* **clipper:** the trim, merge, gif and HEVC helper scripts should find the bundled ffmpeg in `bin/video-tools` ([fc281e0](https://github.com/exwm/yt_clipper/commit/fc281e0d1b26417d5f5e5717125483bd6e5a6fb8))
* **clipper:** video stabilization should read and write its transform file for a markers file whose name has a colon, which also kept that name from adding stabilization options ([530bdcf](https://github.com/exwm/yt_clipper/commit/530bdcfbccf147240ab9aa20cd31ef2f23103ffd))
* **markup:** `frameStartOf` should give the frame start on the platform timeline, as crop points are ([1848178](https://github.com/exwm/yt_clipper/commit/1848178d8c42dad98ccc7484046bf35adda5198c))
* **markup:** `getHeldFrame` should drop an implausible read, as the frame clock does ([1508a59](https://github.com/exwm/yt_clipper/commit/1508a59f160f19bb4ca591ac23b25746c2152239))
* **markup:** a captured frame's file name should give the time and number of the frame captured ([9f7a49e](https://github.com/exwm/yt_clipper/commit/9f7a49e38bf6a41ad9b6d7316866d10675a7383f))
* **markup:** a Cinematic preview whose path the frame rate made stale should solve it again at once, not after the edit delay ([b95e72b](https://github.com/exwm/yt_clipper/commit/b95e72bf0e0ebe1868a6c460ce9366e5eb220780))
* **markup:** a crop or speed point added at the playhead should mark the frame shown, not the frame before or after it ([99e12a1](https://github.com/exwm/yt_clipper/commit/99e12a135afdd27929d6a796de9b5dd67f70b2ce))
* **markup:** a frame rate read at seeks should also be dropped when the video's varying frame times play faster than 1x ([9228220](https://github.com/exwm/yt_clipper/commit/9228220d850ae31b61be4b04918b4d700688b72e))
* **markup:** a frame rate read at seeks should be dropped once playback shows the video's frame times vary, as on phone video ([ab9c85b](https://github.com/exwm/yt_clipper/commit/ab9c85b29f575eeb8c097c45780658491ce0f49d))
* **markup:** a frame step right after pausing should move one frame, as placements read the frame on screen ([19a47b3](https://github.com/exwm/yt_clipper/commit/19a47b3d9fd4ac9c15b1790fba10cf8f8a85760a))
* **markup:** a loaded dynamic crop should preview its eased crop before the crop chart is opened ([0a8de13](https://github.com/exwm/yt_clipper/commit/0a8de13fbf499fdd7071a4f643ae4f2f1ed4f53b))
* **markup:** a loaded markers file should drop any invalid global setting a marker pair can override, as it does for the pair ([bdce746](https://github.com/exwm/yt_clipper/commit/bdce746eb1f6adfbd7dbf7eb8b4d5ad71f196178))
* **markup:** a looping marker pair paused in its end frame's second half should turn back, so playing on never shows the frame after it ([6c56d2e](https://github.com/exwm/yt_clipper/commit/6c56d2e46f6fb5677e7341028138edea42887254))
* **markup:** a looping marker pair should hold its end frame for the frame's own duration where the browser reports it, also before the frame rate is measured ([e7d0aef](https://github.com/exwm/yt_clipper/commit/e7d0aeff6178bdc65c51b3ae062d55a092c69bf1))
* **markup:** a looping marker pair should show its end frame for about its full time before turning back ([3054905](https://github.com/exwm/yt_clipper/commit/30549053b209424d80f6e7160d26eac4fbc83fd3))
* **markup:** a marker pair's duration and speed-adjusted duration should count the frame shown at its end marker, as the clipper renders it ([9ba3650](https://github.com/exwm/yt_clipper/commit/9ba36505e70ee73a20071b9ee7ec844794274f86))
* **markup:** a new marker should mark the frame shown when it is added, and moving it by a frame or jumping to it should land on whole frames ([e9ad3f1](https://github.com/exwm/yt_clipper/commit/e9ad3f1513f428cde34651d27c7bb64c8b89d5af))
* **markup:** a speed or crop chart loop should play through the frame shown at its end, and a paused crop preview should snap to a crop point only on its own frame ([b780ffa](https://github.com/exwm/yt_clipper/commit/b780ffad303069c7fd72304222712142a763fc9d))
* **markup:** alt+drag on a marker number should move the marker on sites where the player holds the progress bar, not scrub the video ([c425853](https://github.com/exwm/yt_clipper/commit/c4258536f7d7ccf3b814c7b142e1fffe203e00f7))
* **markup:** Alt+Shift+X, Alt+Shift+Q and rotating the video should cancel a crop drag or draw in progress, as other crop edits do ([3d39f65](https://github.com/exwm/yt_clipper/commit/3d39f6542c82d9e97dedd38d0d8ffba7d856e2ad))
* **markup:** an aspect-locked crop that already has its ratio should keep its size instead of losing a pixel + a locked-ratio crop at the right or bottom edge should stay in the frame instead of failing ([b033059](https://github.com/exwm/yt_clipper/commit/b03305963e7f44d8dae405c2a3883a1adf6820c1))
* **markup:** clamp a reported end frame duration to a frame at the measured rate ([8101c66](https://github.com/exwm/yt_clipper/commit/8101c66dd1c13631d493d5a9d8575b40cd5a135d))
* **markup:** editing a setting while a crop draw waits for its first click should cancel the draw, so the edit is kept ([cf69c15](https://github.com/exwm/yt_clipper/commit/cf69c15f49100e6d68b288c58a48248411e395b8))
* **markup:** loading a markers file should show the loaded settings in an open settings editor and keep the edits made after it ([2ae2f30](https://github.com/exwm/yt_clipper/commit/2ae2f3049a2143c6b9573a9bb11c232cac0414d0))
* **markup:** on Chrome the frame rate should be measured from the video's own frame timing after two seeks, before any playback ([e2a824d](https://github.com/exwm/yt_clipper/commit/e2a824d944615adbf5870e3603943c5dbd8752a4))
* **markup:** on Firefox before the frame rate is measured, a time read after a seek should be the frame shown, not a frame before it ([a5a14a1](https://github.com/exwm/yt_clipper/commit/a5a14a161a6e8101eb448dc80e1c2c9ff5512c9e))
* **markup:** reframe and the crop previews should not shake on a pan at full speed, by drawing every video frame with its own crop ([e80ad4c](https://github.com/exwm/yt_clipper/commit/e80ad4c5d0227c9267cabedf7dd4b5a59070b703))
* **markup:** Shift+mousewheel frame stepping should land in the middle of the next frame, so a step never shows the same frame again ([b80aea0](https://github.com/exwm/yt_clipper/commit/b80aea0fe67221a32e31d8ab42c4ddcbadde9682))
* **markup:** the crop preview modal should draw once per frame + keep fractional crop widths ([f3a3f02](https://github.com/exwm/yt_clipper/commit/f3a3f02b8916ad651c1e678dc057613ddaf1be57))
* **markup:** the crop preview should follow the video frame on screen when a seek or scrub moves less than a frame + step one frame with shift+mousewheel on sites that don't report a frame rate + YouTube 29.97 fps videos step at 29.97 ([90902b5](https://github.com/exwm/yt_clipper/commit/90902b57b5dd29bd4099ba6c45132396be8d69cd))
* **markup:** the frame rate readout should say a rate came from YouTube + the Measure tooltip should not start with a stray n ([da39e8d](https://github.com/exwm/yt_clipper/commit/da39e8d046f49abf7dedc50ae75d8458d57f130b))
* **markup:** the load review should list the settings it dropped from a markers file for invalid values ([0b0b8d3](https://github.com/exwm/yt_clipper/commit/0b0b8d3d35f75e18b6e0add2c84a298410c29f38))
* **markup:** the reframe minimap should not shimmer on fine detail in a large video ([3ef8ebb](https://github.com/exwm/yt_clipper/commit/3ef8ebbdc89d47fbc1282e61640d418f24422647))
* **markup:** undo, redo, pair switches and crop point edits during a crop drag or draw should cancel it instead of corrupting crop points ([804adcd](https://github.com/exwm/yt_clipper/commit/804adcd1b3605c9703190c8283ec4ba7684c0a1d))


### Documentation Updates

* **changelog:** credit @GoyangiPics for the AV1 encoder in the 5.48.0 notes ([e5361c6](https://github.com/exwm/yt_clipper/commit/e5361c64736442b25cfed200eba092df7bdb27fc))
* plainer wording in the readme, tooltips, shortcut descriptions, and `--help` text ([b8f47e9](https://github.com/exwm/yt_clipper/commit/b8f47e9b4c32aa67c02b930b326e4b857fb8a5f5))
* **readme:** a hold point keeps a crop of its own, which it gets back when it stops holding ([5f75245](https://github.com/exwm/yt_clipper/commit/5f752454cc40bc7461461b79272ae1660ae6a5e4))
* **readme:** document crop easing modes, crop chart point labels, and the lower quality format prompt ([3b997d1](https://github.com/exwm/yt_clipper/commit/3b997d11f09612a1ca5d1549dda85083ceb31d9e))
* **readme:** hold crop points, the Hold Points setting and the Cinematic settings dimming while another easing is chosen + call the point under a crop drag the dragged point ([ca801fa](https://github.com/exwm/yt_clipper/commit/ca801fa360beb0e158f3249ca9006049329cecf2))
* **readme:** install the `markup script` from Greasy Fork, which keeps it updated, and end every release's notes with how to update ([032ecea](https://github.com/exwm/yt_clipper/commit/032ecea5cf8fbbbac1447069d1c7c61cdabe675e))
* **readme:** keep the clipper installs out of the downloads folder, as `yt_clipper_default_args.txt` there can choose which ffmpeg and yt-dlp they run ([923e09f](https://github.com/exwm/yt_clipper/commit/923e09f4ea152f4a441aa3da1d75380fbb3a0c68))
* **readme:** note that Chrome can measure the frame rate after two seeks + log the rate's source without calling it measured ([59e2f02](https://github.com/exwm/yt_clipper/commit/59e2f025554a1c801f9f33555efe631bc5afb234))
* **readme:** rename a markers file with `&` in its name before dropping it onto a Windows helper script ([2907065](https://github.com/exwm/yt_clipper/commit/29070650b54fd8153a29a45fc16df03d4772cace))
* **release-notes:** every release should say how to install yt_clipper too, with the Greasy Fork links ([b1efd98](https://github.com/exwm/yt_clipper/commit/b1efd98f9d51fa1c7dd3a786e8d644cc741b9b57))

## [5.48.0](https://github.com/exwm/yt_clipper/compare/v5.47.1...v5.48.0) (2026-10-15)

### Highlights

#### AV1 Video Codec

* yt_clipper supports `av1` (`--video-codec av1`) for AV1 encoding via libsvtav1, output in an mp4 container. It compresses better than vp9, but encodes slower at lower preset values.
* AV1 support is early. Its default encoding settings are not tuned yet, so expect to adjust them (e.g. the CRF and preset) for your clips.
* The ffmpeg bundled with the macOS release does not include libsvtav1 yet.
* Contributed by @GoyangiPics in [#67](https://github.com/exwm/yt_clipper/pull/67).
* See [this readme section](https://github.com/exwm/yt_clipper#video-codecs) for the full details.

#### Crop Chart Section Colors

The line between two points shows how the crop moves in that section.

* Pan sections are pink, zoom sections are orange, and pan and zoom sections are purple. Static sections are a faint grey line.
* Faster sections are brighter. Slower sections fade toward grey.
* The line is thickest for a full-frame crop and narrows as the crop zooms in.
* A small red arrowhead on the first point of a panning section points the way the crop moves.
* See [this readme section](https://github.com/exwm/yt_clipper#crop-chart-shortcuts) for the full details.

![yt_clipper_crop_chart_sections.png](https://raw.githubusercontent.com/exwm/yt_clipper/v5.48.0/assets/image/yt_clipper_crop_chart_sections.png)


### Features

* **clipper:** add AV1 (libsvtav1) encoder by @GoyangiPics in [#67](https://github.com/exwm/yt_clipper/issues/67) ([02318b0](https://github.com/exwm/yt_clipper/commit/02318b0f5ba6b23c8d11eaa13d4581cf83794f77))
* **clipper:** each run writes its own timestamped log file to the clip folder's `logs/` folder ([4855914](https://github.com/exwm/yt_clipper/commit/4855914bdbc3483f31d0782c08a87a5204e54a95))
* **clipper:** the windows release zip bundles video2x with its `rife-v4.26` model (replacing the `_full` zip), and `bin` is split into `bin/video-tools` (ffmpeg, video2x) and `bin/yt-dlp` (yt-dlp, deno) ([f5ce333](https://github.com/exwm/yt_clipper/commit/f5ce33395bff419cdd1d24f6a3574c62da735d31))
* **markup:** make the minimap crop outline visible on both light and dark video ([a5ac6e4](https://github.com/exwm/yt_clipper/commit/a5ac6e470d28fba47e7c750c85279aa225229392))
* **markup:** show the crop at the current frame beside the crop input, ready to copy ([f8ea7e4](https://github.com/exwm/yt_clipper/commit/f8ea7e406464620f9c5a5f96837a6430775e091a))
* **markup:** show the pan, zoom, speed, and pan direction of each crop chart section ([b11b239](https://github.com/exwm/yt_clipper/commit/b11b239b8c76883dad86a7b3d4a1eb5debf1f8a9))


### Bug Fixes

* **clipper:** `--ffmpeg-tools-dir` and `--ytdl-dir` should take effect, including for paths with backslashes or spaces ([c2aef9e](https://github.com/exwm/yt_clipper/commit/c2aef9eba05449db1bd01dcdaca3fe6e6751d392))
* **clipper:** `--print-versions` should print the tool versions without needing `--markers-json` ([01194dc](https://github.com/exwm/yt_clipper/commit/01194dc5dfa920a73e14b9a5cc9eee692f32abb2))
* **clipper:** a merge list should be skipped instead of crashing the run when one of its clips failed to encode before motion interpolation ([1d38949](https://github.com/exwm/yt_clipper/commit/1d38949e0fc2ea34d64018251022fc75b0b2b2c4))
* **clipper:** a YouTube video with non-ASCII text in its formats list (e.g. dubbed audio track names) should not crash the run on Windows ([35f9a86](https://github.com/exwm/yt_clipper/commit/35f9a862226d12e5eba3488ce4f5f7ae79286d9b))
* **clipper:** av1 clips should support motion interpolation, keep their color metadata, and merge without errors ([340d232](https://github.com/exwm/yt_clipper/commit/340d232c83d09e7d08d81155967df0ae83b57c61))
* **clipper:** dynamic zoom clips should zoom at the same pace as the preview ([6221a7c](https://github.com/exwm/yt_clipper/commit/6221a7c28d675859934285de267b2d04dbefa0a5))
* **clipper:** markers json files should only set the settings the markup script saves, and a marker pair with invalid values should be skipped instead of encoded ([5670b9f](https://github.com/exwm/yt_clipper/commit/5670b9f8d7b119479e16748413df55daf85da53a))
* **clipper:** running `yt_clipper.exe` directly with its output redirected should not crash on a non-utf-8 windows console ([dbce3a7](https://github.com/exwm/yt_clipper/commit/dbce3a70ddc4ac2bfc9117612ba6b4a255838879))
* **markup:** activating yt_clipper before the page finishes loading should work without a reload ([ed007cc](https://github.com/exwm/yt_clipper/commit/ed007ccb728028b1a0a3410ff753e47ab66193b5))
* **markup:** after a fast crop chart drag, the video should land on the crop point you stopped on ([b96f876](https://github.com/exwm/yt_clipper/commit/b96f87661b6e5fc166cd9ab3f76c55a8f499faad))
* **markup:** crop and speed charts should keep their zoom after selecting, adding, or deleting a point ([e4f0484](https://github.com/exwm/yt_clipper/commit/e4f048472d9bf24c692577a793cbf23ac11fe29b))
* **markup:** crop chart should appear below the settings editor on the yt_clipper site ([c094301](https://github.com/exwm/yt_clipper/commit/c0943012eb3c97a83cf434d38b7bd98008a818ee))
* **markup:** platform detection should match exact site domains, not any host containing a platform name ([f6fb0ba](https://github.com/exwm/yt_clipper/commit/f6fb0ba67270cde53b4dd36a94059c9bf6b1168b))
* **markup:** reframe crop handles in global settings should match the crop being edited ([d8981be](https://github.com/exwm/yt_clipper/commit/d8981beeeac10f2c183a8c558e395b9ce0f27195))
* **markup:** reframe preview should fill the whole player on the yt_clipper site ([0e85c47](https://github.com/exwm/yt_clipper/commit/0e85c47b3f4d643471c41203aa20f22f4db087d0))
* **markup:** reframe should not freeze for a frame when playback crosses a crop point ([2da9159](https://github.com/exwm/yt_clipper/commit/2da91597250ba4dc75e669410f97c4fc694b820e))
* **markup:** yt: reframe crop handles should line up with the video after the crop chart hides YouTube's top bar ([936c485](https://github.com/exwm/yt_clipper/commit/936c4852105414fa6d87b5a3e06be29b7e230b9e))


### Documentation Updates

* **readme:** document the crop copy button and crop chart section colors + add a reframe minimap screenshot ([1d7a44f](https://github.com/exwm/yt_clipper/commit/1d7a44f9683a43717d4fdecfc601e4773211a9ad))
* **readme:** note that av1 encoding is early and its default settings are not tuned yet ([3018669](https://github.com/exwm/yt_clipper/commit/3018669728a0dad2d0aadff5e40b6ede8e2743f6))
* **readme:** tighten the reframe and rapid crop point sections + fix the auto-keyframing bullets running together ([b188a0d](https://github.com/exwm/yt_clipper/commit/b188a0de31af5ec42647b3da86fa054aeaf29031))

## [5.47.1](https://github.com/exwm/yt_clipper/compare/v5.47.0...v5.47.1) (2026-06-23)


### Bug Fixes

* **markup:** reframe crop grab/resize regions should follow the displayed crop while scrubbing ([3134f73](https://github.com/exwm/yt_clipper/commit/3134f7364b8ecb923ed22511523411fffab8c7d8))


### Documentation Updates

* **readme:** reorganize reframe section after dynamic crop chart shortcuts ([e96d40d](https://github.com/exwm/yt_clipper/commit/e96d40d5e59c8946fcdb0ef4d4f01ba85efd0120))

## [5.47.0](https://github.com/exwm/yt_clipper/compare/v5.46.0...v5.47.0) (2026-06-21)


### Features

* **markup:** declutter the dynamic crop overlay ([d30abfd](https://github.com/exwm/yt_clipper/commit/d30abfdd361a593bbe1fe3cb385c8b0b669d57c0))
* **markup:** empty number settings inputs should step from their placeholder ([b235fa8](https://github.com/exwm/yt_clipper/commit/b235fa8859b133989a80d24772d68083dd8619e8))
* **markup:** reframe crop preview, a WYSIWYG output preview with auto-keyframing ([7107f27](https://github.com/exwm/yt_clipper/commit/7107f276cecaf18ef7e09428c7ad6c1d457cb3dd))
* **markup:** yt: dim the play/pause bezel, and hide it in reframe ([33364f7](https://github.com/exwm/yt_clipper/commit/33364f761204a7e3d679053c5a4020a54c010554))


### Bug Fixes

* **clipper:** dynamic crop should not snap to the corner between closely spaced crop points ([8233779](https://github.com/exwm/yt_clipper/commit/823377928705388c9bb5e3bffc4255546ccd1135))
* **markup:** all-previews toggle should turn everything back off on the second press ([24a1371](https://github.com/exwm/yt_clipper/commit/24a13718423d5092a7989101a4fdb4621d5f8532))
* **markup:** crop chart should cap the video height in theater and default layouts without stretching or gaps ([99d18e4](https://github.com/exwm/yt_clipper/commit/99d18e4c0f270480782ba422cc5ae8a7f42afcad))
* **markup:** crop crosshair should toggle in reframe while the video is paused ([2f44e2c](https://github.com/exwm/yt_clipper/commit/2f44e2ca76490d48b606302b1d73b5080fa3e3a2))
* **markup:** crop label should not show "(Rotated: ...)" for an unrotated iw:ih crop ([5517daa](https://github.com/exwm/yt_clipper/commit/5517daa35f7a5decbf1655f61b1563bcd16eeaf7))
* **markup:** ctrl+A in crop input should select all text instead of blurring focus ([60d9798](https://github.com/exwm/yt_clipper/commit/60d97984ef78b57598ea1a48cfc94d783982a56d))
* **markup:** dynamic crop start/end overlays should rotate and resize with the main crop ([198a4b3](https://github.com/exwm/yt_clipper/commit/198a4b3e117a5f6ab026993ad9a4c21c9dbe52c9))
* **markup:** match dynamic crop preview easing to the rendered output ([1769231](https://github.com/exwm/yt_clipper/commit/17692312a55a352fb14a9413f7d310c30fb2e1cb))
* **markup:** reframe should show the full video when no marker pair is selected ([433d8c8](https://github.com/exwm/yt_clipper/commit/433d8c8de3cb93a5b6ec35a1021db4896fbf8397))


### Documentation Updates

* **readme:** document the reframe crop preview with a screenshot, add its toolbar button, and switch to crop-point terminology ([59c0d3e](https://github.com/exwm/yt_clipper/commit/59c0d3e3dd06806be5c4d67be5c2e9498733e99d))

## [5.46.0](https://github.com/exwm/yt_clipper/compare/v5.45.0...v5.46.0) (2026-06-10)


### Features

* **markup:** prev/next marker pair navigation buttons + keep player controls visible during marker navigation ([6f7a522](https://github.com/exwm/yt_clipper/commit/6f7a52277f1328dac6aa4df7c8032a2524e58968))
* **markup:** settings editor toolbar for quick access to common toggles and actions ([4e6ea24](https://github.com/exwm/yt_clipper/commit/4e6ea24e6a0efb1d1f8bfd77912232fca353a98f))


### Bug Fixes

* **markup:** command palette should run actions that need a modifier key (e.g. toggle auto-hide marker pairs) ([0291d45](https://github.com/exwm/yt_clipper/commit/0291d4507f69dc74f7873dd5dc0849450a83140e))
* **markup:** modal crop preview should match the player's preview rotation ([2328119](https://github.com/exwm/yt_clipper/commit/232811922fffb7b2e0c98e19bd3b9370e9cb1b00))


### Documentation Updates

* **readme:** document settings editor toolbar, prev/next pair nav, and rotation output sync ([64b647d](https://github.com/exwm/yt_clipper/commit/64b647d4ae3ff0a135532bfffeaae8a3095ebafe))

## [5.45.0](https://github.com/exwm/yt_clipper/compare/v5.44.0...v5.45.0) (2026-05-31)


### Features

* **clipper:** accept --cookies/--cookiesfile as aliases for --cookiefile ([d178519](https://github.com/exwm/yt_clipper/commit/d1785194bc76569096fd50a436d242eea7adee84))
* **clipper:** suggest similar flags for unknown arguments ([07d2817](https://github.com/exwm/yt_clipper/commit/07d281793c1a7bad0811e58fb7ce5f026f5f8d84))
* **clipper:** support --cookies-from-browser for yt-dlp ([19c762b](https://github.com/exwm/yt_clipper/commit/19c762b37ff3d51c2f97c83feaff8b0592051f83))
* **markup:** clearer crop rectangle rendering in dynamic crop mode ([e814c17](https://github.com/exwm/yt_clipper/commit/e814c17aa6eefe36d54febc129be7fb0aadd6d35))


### Bug Fixes

* **clipper:** hide confusing "(default: None)"/blank notes in --help ([67a3f6a](https://github.com/exwm/yt_clipper/commit/67a3f6a3cba7b390a354075d2720d629b1cc924b))
* **clipper:** repair missing spaces in argparse help text ([df0b208](https://github.com/exwm/yt_clipper/commit/df0b2084c0d673fd6e98f65d24c172b6ae44a2e3))
* **markup:** cap YouTube video height while crop chart is open ([0c5bd8e](https://github.com/exwm/yt_clipper/commit/0c5bd8e35a3d3666a47e5b46c304fe03a3bafbf9))
* **markup:** keep rotated video correctly sized when switching videos (portrait/landscape) ([e4c21c0](https://github.com/exwm/yt_clipper/commit/e4c21c04410b3969a133f72a00261d479b67d4e4))
* **markup:** prevent fast crop/marker drags from getting stuck while seeking ([4f45b0d](https://github.com/exwm/yt_clipper/commit/4f45b0d535c18cc1eeae1326d9d9597fef196e99))
* **markup:** remove stray internal identifier from flash messages and stale-video banner ([e6e4ff6](https://github.com/exwm/yt_clipper/commit/e6e4ff68a2e6e07d4528e3fe5e31679733ab48c4))

## [5.44.0](https://github.com/exwm/yt_clipper/compare/v5.43.0...v5.44.0) (2026-05-19)


### Features

* **clipper:** sample-guided encoding via `--sample-guided-encode` (`-sge`) ([99d91ee](https://github.com/exwm/yt_clipper/commit/99d91ee9aa7679dbaf33ed799c7576ddb0376004))
  * Probes a few CRF values on short sample windows of each marker pair, measures the trials against a near-transparent reference using VMAF NEG, and picks the highest CRF that clears a perceptual-quality target. The picked CRF is used for the final encode.
  * Per-pair, per-encoder-fingerprint run-cache replays the picked CRF on subsequent invocations with the same encoder settings.
  * Companion flags: `--target-vmaf-mean`, `--target-vmaf-low`, `--target-vmaf-low-percentile`, `--sample-guided-encode-alg`.
* **clipper:** vp9 aq-mode and tile-rows now use libvpx defaults ([9bb110e](https://github.com/exwm/yt_clipper/commit/9bb110e37e01ec7a962dbfd8bd17c67dfc8e0cc9))
  * Discovered during VMAF measurements for sample-guided encoding: yt_clipper was using aq-mode 4 (the EQUATOR360 preset, intended for 360° video) and tile-rows 2, both wrong for standard clips. Now uses libvpx defaults (aq-mode 0, tile-rows 0). Expect default-mode encodes about 12-15% bigger for the same content at the same CRF. Baseline CRFs were not adjusted to compensate.
* **clipper:** structured logging UX overhaul ([130a7d2](https://github.com/exwm/yt_clipper/commit/130a7d2a6dba5a898f36f6ebf2c14954f163dad2))
  * Section rules and sub-phase banners, per-pair contextvar tag on every line, compact `HH:MM:SS` timestamps with a run-start ISO anchor, per-stage timing summary at run end, and `rich.Table` for the sample-guided encode aggregate + auto-delta blocks. Multi-subsystem interleaving stays attributable via subsystem chips.
* **clipper:** live progress display for ffmpeg encodes ([fb16e6f](https://github.com/exwm/yt_clipper/commit/fb16e6f597483829e63d08f01fe54f3128965ae1))
  * Per-encode bar with frame count and ETA. Sample-guided trials share one tracker spanning the whole search instead of resetting between phases.
* **clipper:** animated clip previews via `--preview-format` ([d6971e9](https://github.com/exwm/yt_clipper/commit/d6971e987f259522dd14f1900c572e0d36939a88))
  * Downscaled AVIF or WebP sibling file next to each output webm (and any merged outputs). Tuning via `--preview-max-dim`, `--preview-quality`, `--preview-preset`.
* **markup:** contextual hints bar with chord glyphs and popovers ([accd70f](https://github.com/exwm/yt_clipper/commit/accd70f91ae155cb102e5be89b24a6f4b5902e84))
  * **Alt+F** toggles it. Shortcut chips change with the cursor location and the held modifier keys. Hover a chip that ends in `+` to see its related shortcuts.
* **markup:** rapid crop-keyframe workflow during crop manipulation ([5d43d94](https://github.com/exwm/yt_clipper/commit/5d43d94ad77acc774528e8b9c936e4a09cd8e224))
  * While dragging or resizing the crop (**Ctrl+Drag**) with the crop chart visible, press **Alt+A** (or **A**) to add a crop point at the current position and keep dragging. Use it to track a moving subject with one hand. Scroll the mouse wheel during a pan-drag to zoom the crop around its center.
* **markup:** markers JSON load preview modal + share-url binary compression improvements ([45c4e83](https://github.com/exwm/yt_clipper/commit/45c4e836336f6f2057eb1227c0e56bccbd89aab3))
  * A review modal opens before loaded data is applied. It flags HTML-like content, and you can cancel the load.
* **markup:** Shift+S to save shareable link with markers data ([5b8bd68](https://github.com/exwm/yt_clipper/commit/5b8bd6830371f7baca5ca737b35c2ffa03873794))
  * Behind a feature flag until further testing.


### Bug Fixes

* **markup:** adopt lit-html for safer templated HTML rendering ([c5055af](https://github.com/exwm/yt_clipper/commit/c5055af6bcbbffc8b469b90ffe333b7bbf48606b))
  * All dynamic HTML now uses escape-by-default templates. This complements the new settings editor XSS defense and the markers load review modal.
* **markup:** additional XSS defense for settings editors ([1fc6fca](https://github.com/exwm/yt_clipper/commit/1fc6fcad9591994b41b028e1138574040a46829b))
* **markup:** smooth Alt+Drag marker numbering ([176a1a6](https://github.com/exwm/yt_clipper/commit/176a1a6337bdbfffd51cbc3ce0a4ea9ad3e9434e))
  * No more rubber-banding on fast drags or freezing on diagonal motion.
* **markup:** release stuck mid-drag state on blur, devtools, and right-click ([631b9eb](https://github.com/exwm/yt_clipper/commit/631b9eb66fde9e18de6e3e5bf4c93c96da19ccb7))
* **clipper:** probe clip dims for preview scale, not source dims ([d33ea4d](https://github.com/exwm/yt_clipper/commit/d33ea4d826a1336f8626e1da700f029038e3fb50))


### Major Dependency Upgrades

* **clipper+markup:** upgrade dependencies ([0f9ad83](https://github.com/exwm/yt_clipper/commit/0f9ad83ee30e8dee115425b7814df119b10564e9))


### Documentation Updates

* document new clipper features and align CLI help text ([570e355](https://github.com/exwm/yt_clipper/commit/570e35599ae9cf39aaf4b2e0f82224dc284fc589))

## [5.43.0](https://github.com/exwm/yt_clipper/compare/v5.41.0...v5.43.0) (2026-04-12)


### Features

* **markup:** add searchable command palette (shift+e) ([c7308ef](https://github.com/exwm/yt_clipper/commit/c7308ef0995c9216968d440e8ca479164e1a65ae))
* **markup:** Ctrl+Alt+Shift+C to toggle essential previews now excludes dynamic crop chart looping ([dfac3fe](https://github.com/exwm/yt_clipper/commit/dfac3fe0d67cfe7ff9ba3ee62a29abe538a35341))
* **markup:** make it clearer that (Source) FPS Multiplier targts source video FPS, always show derived clip fps multiplier ([95c0a92](https://github.com/exwm/yt_clipper/commit/95c0a9260b9be1ed4b464d9af252f1bbe8564966))
* **markup:** reorganize command shortcuts and improve command palette ux ([5946cf1](https://github.com/exwm/yt_clipper/commit/5946cf13cb15e75eaa94c3d5208ed8809e6b5c4c))
* **markup:** show warning when navigating to different video after activating yt_clipper ([c93f3ba](https://github.com/exwm/yt_clipper/commit/c93f3ba933bc62d05582d244154a2df853ae762d))


### Bug Fixes

* **markup:** crop crosshair should rotate when video is rotated ([3f7545e](https://github.com/exwm/yt_clipper/commit/3f7545eb5f1b55fd9aa3a243b8997aedc7c620fe))
* **markup:** move marker by frame (alt+shift+mousewheel) should not jump to start when marker pair looping is enabled ([f9f6c23](https://github.com/exwm/yt_clipper/commit/f9f6c23452d180b20d916c9ee26be842c15747f0))
* **markup:** yt: hide yt overlays that may interfere with cropping ([fcc83fa](https://github.com/exwm/yt_clipper/commit/fcc83fa734fea302169efc66747801a3ad5034f5))
* **markup:** move marker by frame (alt+shift+mousewheel) should not jump to start when marker pair looping is enabled ([f9f6c23](https://github.com/exwm/yt_clipper/commit/f9f6c23452d180b20d916c9ee26be842c15747f0))


### Documentation Updates

* **readme:** update shortcuts organization to match new command palette ([2676e66c](https://github.com/exwm/yt_clipper/commit/2676e66cdbd0575cb81bab825889159de209df4c))


## [5.41.0](https://github.com/exwm/yt_clipper/compare/v5.40.0...v5.41.0) (2026-03-26)


### Features

* **clipper+markup:** support dynamic speed with motion interpolation and improve its quality + preserve metadata in interpolated output ([10d234c](https://github.com/exwm/yt_clipper/commit/10d234ce78f35e0561dbf149ea043641d18f34fb))
  * Depends on forked version of video2x (v6.5.0-exwm)

  * BREAKING CHANGE: a value of 0 for FPS multiplier now disables disables motion interpolation.
  * A value of 1 targets the original source video fps, compensating for slowdown.
  * Higher values (e.g. 2) target N x source fps for extra-smooth slow motion.

### Bug Fixes

* **clipper:** unknown args should be logged before exit ([6667332](https://github.com/exwm/yt_clipper/commit/6667332c7466e54eb0f31433696d63b9e49c094d))


### Documentation Updates

* **readme:** minor hotkey fix ([c4c9a50](https://github.com/exwm/yt_clipper/commit/c4c9a50fc6fc65afe0e1d56bc9a92a84c040a0d9))

## [5.40.0](https://github.com/exwm/yt_clipper/compare/v5.39.0...v5.40.0) (2026-03-10)


### Features

* **clipper+markup:** add ai motion interpolation with video2x ([45d1c3c](https://github.com/exwm/yt_clipper/commit/45d1c3ca8939836a09262c4eb4632e59d2dd8619))
* **clipper:** shift+x opens crop preview in pop up window ([48a3e1e](https://github.com/exwm/yt_clipper/commit/48a3e1e679705f8762e2da3802e909e7710edda8))
* **markup:** crop preview (ctrl+alt+x) shows hq gamma preview ([912ffc8](https://github.com/exwm/yt_clipper/commit/912ffc87224642b98bb21a1f8e4bfacf84b23762))


### Bug Fixes

* **markup:** alt+mousewheel should jump to crop points ([d54246f](https://github.com/exwm/yt_clipper/commit/d54246f31ab96c3784c06c7f13fa26870fd618d9))
* **markup:** yt: marker numbers should hide when progress bar hidden ([ec5980d](https://github.com/exwm/yt_clipper/commit/ec5980d94616e432ff8a851b25c15f5be39c0aef))

## [5.39.0](https://github.com/exwm/yt_clipper/compare/v5.38.0...v5.39.0) (2026-01-25)


### Features

* **clipper:** exit when given unknown arguments ([abe881d](https://github.com/exwm/yt_clipper/commit/abe881ddc188ffa4590f8ea407983f0ef2644eb3))


### Bug Fixes

* **clipper:** --download-video not working becuase video url not given in yt-dlp command ([d83e570](https://github.com/exwm/yt_clipper/commit/d83e5704eb2f3821966047afb082ec28c9338509))
* **clipper:** h264 artifacting on 10-bit sdr input ([4ab4ff5](https://github.com/exwm/yt_clipper/commit/4ab4ff5095d6076224b0babc5ef6227f909cd03e))
* **clipper:** h264_vulkan artifacting when going from HDR -> SDR ([b6a5fce](https://github.com/exwm/yt_clipper/commit/b6a5fce36e9c7bd7f3b347169b1bd90cedc78f6a))
* **clipper:** merge clips should use mp4 for h264* codecs ([82dbdaf](https://github.com/exwm/yt_clipper/commit/82dbdaf90d637a96a47da4d8d2f3bbefb739a799))


### Documentation Updates

* **readme:** add dynamic crop video tut link ([840b183](https://github.com/exwm/yt_clipper/commit/840b18329072ba54092f94964afe5c32f9516ef9))

## [5.38.0](https://github.com/exwm/yt_clipper/compare/v5.37.0...v5.38.0) (2025-12-27)


### Bug Fixes

* **clipper:** escape file path in error log when missing required input for merge ([52caa2a](https://github.com/exwm/yt_clipper/commit/52caa2ae2c677304b7e4b374bb876b34f5b426d9))
* **clipper:** ffprobe fps detection could be significantly off for variable frame rate input ([8d8efa7](https://github.com/exwm/yt_clipper/commit/8d8efa7d7e016c96a0af67f60d7ab50f213e7b8a))

## [5.37.0](https://github.com/exwm/yt_clipper/compare/v5.36.0...v5.37.0) (2025-12-04)


### ⚠ BREAKING CHANGES

* **markup+clippera:** instant ease in behaviour and ease in timing changes
may produce slightly different videos with the same markers json

### Bug Fixes

* **markup+clippera:** improve dynamic crop preview accuracy, make instant crop ease in easier to use ([40341b6](https://github.com/exwm/yt_clipper/commit/40341b679b3c34e0a317c6836bf6074d05b77f36))

## [5.36.0](https://github.com/exwm/yt_clipper/compare/v5.34.0...v5.36.0) (2025-12-01)


### Features

* **clipper:** add --ffmpeg-tools-dir option for changing where ffmpeg tools are found ([cca924d](https://github.com/exwm/yt_clipper/commit/cca924df24b845a7daaea407c99c37bc01cf8a1f))
* **clipper:** include deno runtime for yt-dlp youtube extraction ([7c24a62](https://github.com/exwm/yt_clipper/commit/7c24a620290ffe4e7c1b391f83c01f5ce91e4bc1))
* **markup:** cycle frame skip/seek speed (1 to 3 frames) on shift+mousewheel-click ([6e84bdf](https://github.com/exwm/yt_clipper/commit/6e84bdfc2acaa111ca36f981ac34461dae3fe9f1))


### Bug Fixes

* **clipper:** escape merged file name when logging ([90c2f5c](https://github.com/exwm/yt_clipper/commit/90c2f5c0b010c757e3432e719aa12fe7ef691f76))
* **clipper:** security issues with options that change tool ytdl-location ([413e768](https://github.com/exwm/yt_clipper/commit/413e768187ffad77c25edec2685c601da1e3c7b7))


### Major Dependency Upgrades

* **clipper:** update to ffmpeg 8.0.1 ([f22b578](https://github.com/exwm/yt_clipper/commit/f22b5787904f0cbf672d5cb52e6d47b44c4b0487))

## [5.35.0](https://github.com/exwm/yt_clipper/compare/v5.34.0...v5.35.0) (2025-09-01)


### Features

* **clipper:** add --ffmpeg-tools-dir option for changing where ffmpeg tools are found ([279c0fd](https://github.com/exwm/yt_clipper/commit/279c0fd5aa62cb137802249a9963fb8e84d81372))


### Bug Fixes

* **clipper:** security issues with options that change tool ytdl-location ([9c036aa](https://github.com/exwm/yt_clipper/commit/9c036aa46a43f5730f265672e9177c82d072c5c3))


### Major Dependency Upgrades

* **clipper:** update to ffmpeg 8.0 ([779a1ec](https://github.com/exwm/yt_clipper/commit/779a1ece06a7c3c881c453fbb00445826d7c9b8d))

## [5.34.0](https://github.com/exwm/yt_clipper/compare/v5.33.0...v5.34.0) (2025-08-03)


### Bug Fixes

* **clipper:** input videos with display-only rotation should be correctly cropped ([3725886](https://github.com/exwm/yt_clipper/commit/3725886c403ced52641af98991805e799339152c))
* **clipper:** missed escaping of filename in some logs ([a78e90f](https://github.com/exwm/yt_clipper/commit/a78e90f35b25d3e7095ebce1ba60fd53b72f4501))
* **clipper:** vidstabtransform filter should be injected when video stabilization is enabled and video filter is large ([#62](https://github.com/exwm/yt_clipper/issues/62)) ([6ae8704](https://github.com/exwm/yt_clipper/commit/6ae870446d38788cf846b8168c9714d63b94a6ff))

## [5.33.0](https://github.com/exwm/yt_clipper/compare/v5.32.0...v5.33.0) (2025-07-19)


### Features

* **markup:** support previewing rotation on yt_clipper video editor page ([48789d9](https://github.com/exwm/yt_clipper/commit/48789d90357dda9b5fe760a5a9098808242ef308))


### Bug Fixes

* **clipper:** avoid artifacting when hdr input or output is enabled ([cd652b4](https://github.com/exwm/yt_clipper/commit/cd652b49dc91c8194bfaab03d12acc79da2e2412))
* **clipper:** ffprobe should find color_transer in stream data ([31d0885](https://github.com/exwm/yt_clipper/commit/31d0885b87b2b6492a522552793ce6b884929712))
* **markup:** gamma preview should work with html sanitization ([9b13487](https://github.com/exwm/yt_clipper/commit/9b13487bd9627884c7ff8dc4503cfb74d039e9fb))

## [5.32.0](https://github.com/exwm/yt_clipper/compare/v5.31.0...v5.32.0) (2025-06-24)


### Features

* **clipper:** add h264_nvenc codec support by @codedealer in ([#60](https://github.com/exwm/yt_clipper/issues/60)) ([588b542](https://github.com/exwm/yt_clipper/commit/588b542a6d494ed8f70c7da9f6472120848f506e))

### Bug Fixes

* **clipper:** h264_vulkan chroma subsampling artifacting and improve compatibility ([ecd5a1f](https://github.com/exwm/yt_clipper/commit/ecd5a1f93ada1dec479f13a0eb7e02d874125e5b))
* **markup:** crop preview should not use rounded corners ([f577df7](https://github.com/exwm/yt_clipper/commit/f577df77e0f967627eb63470784feca162d5f6d0))

## [5.31.0](https://github.com/exwm/yt_clipper/compare/v5.30.0...v5.31.0) (2025-06-03)


### Features

* **markup:** add Ctrl+Alt+X for previewing crop in modal window ([95693d4](https://github.com/exwm/yt_clipper/commit/95693d43ccffb19637d6c42d93287552006de961))


### Bug Fixes

* **clipper:** clip filenames should be escaped from rich formatting ([5fbdd75](https://github.com/exwm/yt_clipper/commit/5fbdd75cbd99d0fb4f138e6dc89454c35a21751f))
* **site:** all video load handlers should be disabled after load ([650d759](https://github.com/exwm/yt_clipper/commit/650d7592812da76f17042ebaa5815eb3311142b1))

## [5.30.0](https://github.com/exwm/yt_clipper/compare/v5.29.0...v5.30.0) (2025-05-10)


### Features

* **markup:** support crop manipulation and drawing when previewing rotation ([bc8a857](https://github.com/exwm/yt_clipper/commit/bc8a85769ad4624991ea916a9b46455945bc4245))


### Bug Fixes

* **markup:generic:** speedchart should appear in front of video ([8774747](https://github.com/exwm/yt_clipper/commit/8774747d7dd7319fc10c1d1cf5a2947b3610768e))


### Documentation Updates

* minor readme and changelog fixes ([8414e0f](https://github.com/exwm/yt_clipper/commit/8414e0f97fa1dd7756773f89b046d7cdffd9a030))

## [5.29.0](https://github.com/exwm/yt_clipper/compare/v5.28.0...v5.29.0) (2025-05-10)


### Features

* **markup+clipper:** support yt_clipper generic video platform (<https://exwm.github.io/yt_clipper/>) ([ea150e3](https://github.com/exwm/yt_clipper/commit/ea150e3a44559e79e3f25093c0a568447617fb1f))
  * If the platform you want to use isn't directly supported, you can download the video manually and then use the yt_clipper generic video platform.
  * Load a video from local storage by dragging and dropping the video onto the player, then activate the yt_clipper markup script as usual.

## [5.28.0](https://github.com/exwm/yt_clipper/compare/v5.27.0...v5.28.0) (2024-10-25)

### Features

* **clipper:** on failure to parse markers JSON file, print friendlier error messages and debug info ([2c7fc9e](https://github.com/exwm/yt_clipper/commit/2c7fc9e07c52e805187942236f299f0870361a69))


### Bug Fixes

* **clipper:** pass --cookiefile option as --cookies to yt-dlp ([0e43f51](https://github.com/exwm/yt_clipper/commit/0e43f5169e62d7ca74361d1f68a308ff4affb1d9)) by @codedealer in ([#54](https://github.com/exwm/yt_clipper/issues/54))
* **clipper:** set yt-dlp location to bundled yt-dlp for frozen releases ([8a80ac1](https://github.com/exwm/yt_clipper/commit/8a80ac133c8ff3ada1950973fe629a0e6e8b98a1))

## [5.27.0](https://github.com/exwm/yt_clipper/compare/v5.26.0...v5.27.0) (2024-10-11)

### Features

* **clipper:** auto update yt-dlp bundled in frozen releases ([5728875](https://github.com/exwm/yt_clipper/commit/57288752081782d5820af26c5f8a98abd4d58217))
* adds option `--no-ytdl-auto-update` to disable automatic updating of bundled yt-dlp
  * adds option `--ytdl-location` to override the location of yt-dlp
  * changes option `--version` to print only yt_clipper's version
  * adds option `--prin-versions` to print versions of yt_clipper and its major dependencies
* **clipper:** use binary yt-dlp to enable updating yt-dlp dep independently ([9316fd4](https://github.com/exwm/yt_clipper/commit/9316fd44480c0d93c2718d4a624fdd988f5e4a5d))
  * removes legacy youtube-dl support which hasn't been updated in several years
* **clipper:** by default, read args from `../yt_clipper_default_args.txt` for frozen releases ([d00d0b6](https://github.com/exwm/yt_clipper/commit/d00d0b647d8b00e55205efd6ec44233269c7b4dc))
* **clipper:** organize options into groups, use rich-argparse for richer help output ([fa7ac45](https://github.com/exwm/yt_clipper/commit/fa7ac45bf13998722bfa56907d312308c653e93a))

## [5.26.0](https://github.com/exwm/yt_clipper/compare/v5.25.0...v5.26.0) (2024-10-09)

### Features

* **clipper:** add --cookiefile option to pass a cookies file to youtube_dl for video platform login ([33bc588](https://github.com/exwm/yt_clipper/commit/33bc5889c02fd293e86ef9230b2e60171b81be34))
  * for more information on passing cookies, see yt-dlp docs: https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp
* **clipper:** use rich for richer logging ([e673d24](https://github.com/exwm/yt_clipper/commit/e673d24fbf776659199e9c112de50a13a20031db))
* **clipper:** use yt_clipper icon for python exe builds ([1784a07](https://github.com/exwm/yt_clipper/commit/1784a078a9c2f4378648e18e2ad2609681676c20))

### Major Dependency Upgrades

* **clipper:** update yt-dlp dependency to v2024.10.07 ([d9c8dd5](https://github.com/exwm/yt_clipper/commit/d9c8dd5a88af0f2b93b57a611bfcbc0652e92504))

## [5.25.0](https://github.com/exwm/yt_clipper/compare/v5.24.0...v5.25.0) (2024-09-30)


### Features

* **clipper:** add --video-codec option h264_vulkan for hardware accelerated encodes of h264 ([21a060f](https://github.com/exwm/yt_clipper/commit/21a060fc9cb6e105770b1a93be508d0906040e84))
  * Uses hardware acceleration (typically a discrete GPU) for faster encodes at the cost of some quality.
  * h264_vulkan uses the Vulkan technology which is supported on Linux and Windows across most modern GPUs (AMD/NVIDIA/Intel). MacOS and iOS are not yet supported. Requires ffmpeg >= 7.1.
  * If you have issues with hardware acceleration, ensure you have the latest drivers.
* **clipper:** log audio/video formats found by youtube_dl alternative ([7b93636](https://github.com/exwm/yt_clipper/commit/7b93636ff55364ace18c7559227a4a8f8f229c92))


### Bug Fixes

* **clipper:** crash on --fast-trim with local input video file, updates python from 3.8 to 3.12 ([ff9675e](https://github.com/exwm/yt_clipper/commit/ff9675e860c77aab21806b78284fbcf73384d646))


### Major Dependency Upgrades

* **clipper:** update ffmpeg dependency to 7.1 (supports vulkan encodes) ([a5959da](https://github.com/exwm/yt_clipper/commit/a5959da0c7e8bf0b1dd21e1e32b9420f6a9b2e9c))
* **clipper:** update yt-dlp dependency to v2024.09.27 ([d06bf12](https://github.com/exwm/yt_clipper/commit/d06bf12a9fdb339cf3b02ba36bd1116e5bdde600))

## [5.24.0](https://github.com/exwm/yt_clipper/compare/v5.22.0...v5.24.0) (2024-09-08)


### Features

* **clipper+markup:** add `--enable-hdr` option to use high dynamic range for output videos ([75105af](https://github.com/exwm/yt_clipper/commit/75105afa8b019088b5892cb9496ee787ecd5120b))
  * The option is exposed in the markup script UI in global and marker pair encode settings (opened with **Shift+W**).
  * Typically improves image vibrancy and colors at the expense of file size and playback compatibility.
* **clipper:** add `--fast-trim`/`-ft` option to generate outputs quickly without re-encoding ([3dbf0f4](https://github.com/exwm/yt_clipper/commit/3dbf0f4b9c69a3b0183b2be078e900fbd220af4e))
* **markup:** crop manipulation: allow use of meta key (command on mac) instead of ctrl key ([63ddd76](https://github.com/exwm/yt_clipper/commit/63ddd76f22117ec5d17cf2cd0b20ae43e2ce8b58))
* **clipper:** add --log-level option, fix default log level should be VERBOSE not DEBUG ([a1ee47e](https://github.com/exwm/yt_clipper/commit/a1ee47ec9108f4f7753c506ae9352a60736176d0))


### Bug Fixes

* **clipper:** zoompan: disable scaling up input when input is HDR before zooming to avoid artifacting ([2c5d0e6](https://github.com/exwm/yt_clipper/commit/2c5d0e6ba5d5ce63c0691a64b07b98052bc015ad))
* **markup:** videoURL in markers json missing video ID query param ([fa99571](https://github.com/exwm/yt_clipper/commit/fa99571fc59d395bff3ce8817888f2e62c0f196a))

## [5.22.0](https://github.com/exwm/yt_clipper/compare/v5.21.2...v5.22.0) (2024-08-06)


### Bug Fixes

* **markup:** fix crash when trusted types are required.
  * use DOMPurify for more robust html sanitization, use trusted types with browsers that support it ([85cb724](https://github.com/exwm/yt_clipper/commit/85cb72468054f97ef400b53b2bd51a43389dae14))
  * YouTube on Chrome is rolling out content security policies that require trusted types, see <https://developer.chrome.com/blog/trusted-types-on-youtube>


### Major Dependency Upgrades

* **clipper:** update yt-dlp dependency to v2024.08.06 ([20c80f3](https://github.com/exwm/yt_clipper/commit/20c80f3e12201c6097f354c576b6a3bb1a805888))

## [5.21.2](https://github.com/exwm/yt_clipper/compare/v5.21.1...v5.21.2) (2024-08-04)


### Bug Fixes

* **clipper:** making clips with local input video broken due to missing Video Type ([9a14f4d](https://github.com/exwm/yt_clipper/commit/9a14f4d7266b764ff8f2aeb5decb69c1cbb0daeb))

## [5.21.1](https://github.com/exwm/yt_clipper/compare/v5.21.0...v5.21.1) (2024-08-02)


### Bug Fixes

* **clipper:** work around for video stabilization artifacts when input video has low background contrast ([da31b06](https://github.com/exwm/yt_clipper/commit/da31b0646269bba738fba8de99172d6f2f17b3ce))

## [5.21.0](https://github.com/exwm/yt_clipper/compare/v5.20.0...v5.21.0) (2024-08-02)


### Major Dependency Upgrades

* **clipper:** update yt-dlp dependency from v2024.08.01 ([9781979](https://github.com/exwm/yt_clipper/commit/9781979a168b16c9815c98a8aa8a481906fba06b))

## [5.20.0](https://github.com/exwm/yt_clipper/compare/v5.18.0...v5.20.0) (2024-08-01)


### Features

* **clipper+markup:** add initial support for afreecatv platform vods ([a24b80c](https://github.com/exwm/yt_clipper/commit/a24b80c754763513649b5910307ae8b7c3ae4994))
* **clipper:** enable weverse support ([c9d5c84](https://github.com/exwm/yt_clipper/commit/c9d5c844fae43d67633924141d38c774ef6e2ab6))
* **markup:** support for platform tv.naver.com ([6de0da4](https://github.com/exwm/yt_clipper/commit/6de0da4a11b8ae8046c5cd4a0786dbec6630849d))


### Bug Fixes

* **markup:** marker pair selection via mouseover should work on weverse and naver_tv ([8022ac5](https://github.com/exwm/yt_clipper/commit/8022ac5ba6e72b01e76c679bdb6b17fd0650ff38))

### AfreecaTV Support Notes

* AfreecaTV clips use the hls (http live streaming) protocol which is not as reliable as other protocols.
* Short AfreecaTV clips (about 1 second or shorter) may produce empty video files when.
* AfreecaTV VODs come in multiple video file parts and clips that span multiple parts are not currently supported.

### Major Dependency Upgrades

* **clipper:** update ffmpeg to v7.0.1 ([3c3c534](https://github.com/exwm/yt_clipper/commit/3c3c53456ee2c8a2ce3598e438b22fc19a99480d))

## [5.19.0](https://github.com/exwm/yt_clipper/compare/v5.18.0...v5.19.0) (2024-07-29)


### Features

* **clipper:** enable weverse support ([c9d5c84](https://github.com/exwm/yt_clipper/commit/c9d5c844fae43d67633924141d38c774ef6e2ab6))
* **markup:** support for platform tv.naver.com ([6de0da4](https://github.com/exwm/yt_clipper/commit/6de0da4a11b8ae8046c5cd4a0786dbec6630849d))


### Major Dependency Upgrades

* **clipper:** update ffmpeg to v7.0.1 ([3c3c534](https://github.com/exwm/yt_clipper/commit/3c3c53456ee2c8a2ce3598e438b22fc19a99480d))

## [5.18.0](https://github.com/exwm/yt_clipper/compare/v5.17.0...v5.18.0) (2024-07-29)


### Major Dependency Upgrades

* **clipper:** update yt-dlp dependency from v2024.04.09 to v2024.7.25, update pyinstaller from v5.0.1 to v6.9.0 ([a2defb9](https://github.com/exwm/yt_clipper/commit/a2defb927e6cd21fe14cc6e97aefa096ffc148e9))

## [5.17.0](https://github.com/exwm/yt_clipper/compare/v5.16.1...v5.17.0) (2024-04-18)


### Major Dependency Upgrades

* **clipper:** update yt-dlp dependency from v2023.11.16 to v2024.04.09 ([f8a5924](https://github.com/exwm/yt_clipper/commit/f8a592469b6505ee43b3d3e3af7bf3e87c72f359))

### [5.16.1](https://github.com/exwm/yt_clipper/compare/v5.16.0...v5.16.1) (2023-12-08)


### Features

* **clipper/h264:** add --h264-disable-reduce-stutter/--h264-drs flag for opting in to a consistent framerate with duplicate frames when slowing down clips for potentially smoother merged video transitions ([55beecc](https://github.com/exwm/yt_clipper/commit/55beecc52a4ce6c0542a3b19e6c983c7f6c510e9))


### Bug Fixes

* **clipper/h264:** add consistent timescale to reduce hanging when merging clips ([352fc46](https://github.com/exwm/yt_clipper/commit/352fc46a725c8ea951c2100bc6a31f0c6d879def))

## [5.16.0](https://github.com/exwm/yt_clipper/compare/v5.15.0...v5.16.0) (2023-12-06)


### Features

* **platform:** add support for naver_now_watch platform (now.naver.com/watch URLs) ([c77d8a0](https://github.com/exwm/yt_clipper/commit/c77d8a0ca67f3cd121d19548812ae134c969b035))

## [5.15.0](https://github.com/exwm/yt_clipper/compare/v5.14.2...v5.15.0) (2023-11-20)


### Major Dependency Upgrades

* **clipper:** update ffmpeg to v6.1 ([7ce2052](https://github.com/exwm/yt_clipper/commit/7ce2052ec1ded09a8f1eec9397287a9ae843f2e8))
* **clipper:** update yt-dlp dependency from v2023.07.06 to v2023.11.16 ([ccb017a](https://github.com/exwm/yt_clipper/commit/ccb017a45864e28170f68bf024f7fabc6b77c6a0))

### [5.14.2](https://github.com/exwm/yt_clipper/compare/v5.14.1...v5.14.2) (2023-08-23)


### Bug Fixes

* **markup:** marker pair and global settings editors covering up video player ([0e9f06d](https://github.com/exwm/yt_clipper/commit/0e9f06d46d7bfde8df72ac9f0bdc0c7ed45c15a9))

### [5.14.1](https://github.com/exwm/yt_clipper/compare/v5.14.0...v5.14.1) (2023-08-19)


### Bug Fixes

* **clipper:** 0-duration crop point pair at the end of dynamic crop map breaks crop filter ([731d3ab](https://github.com/exwm/yt_clipper/commit/731d3ab9956d5aa7b4cb3254e9e038d834a459da))
* **clipper:** video stabilization fails due to ffmpeg bug ([9255893](https://github.com/exwm/yt_clipper/commit/92558936f57bfaa51dd1ec18ba8835986ccca143))
* **markup:** marker pair and global settings editors not displaying, rotate video doesn't fit video into view properly, settings editors invisible in non-theatre view mode ([8a2a458](https://github.com/exwm/yt_clipper/commit/8a2a458c5dcc10cc6a8a98bbdbe9fc724f1175a5))

## [5.14.0](https://github.com/exwm/yt_clipper/compare/v5.12.0...v5.14.0) (2023-08-12)


### Features

* **clipper:** change default --format-sort option for yt-dlp to prefer premium bitrate formats ([7ab962b](https://github.com/exwm/yt_clipper/commit/7ab962b3a105b196d0ba45500333e0eb9c6530bc))


### Bug Fixes

* **clipper:** add warning and prompt to disable potentially unsupported video download protocols m3u8/m3u8_native ([932368e](https://github.com/exwm/yt_clipper/commit/932368eec74ad6872d8eebb8b79c4dbb7bd49fbf))
* **clipper:** fix ValueError exception with python>=3.11 from ClipperState dataclass decorator ([dc9c937](https://github.com/exwm/yt_clipper/commit/dc9c9375516da7f0393ad46b1d5714493c157856))
* **clipper:** use -fps_mode vfr to fix encoding hang with variable speed mode, add output frameout options for h264 to reduce stutter when video is slowed ([ae3c172](https://github.com/exwm/yt_clipper/commit/ae3c17280dfa8997a68f1d547c1e61afbf75d4a0))
* **markup:** marker pair and global settings editors not displaying, rotate video doesn't fit video into view properly ([3abb89d](https://github.com/exwm/yt_clipper/commit/3abb89d6569acd4fccf1a914c33ef4440a9befad))
* **markup:** marker pair and global settings editors, flash messages (toasts), shortcuts table not injected just below video ([3edb00e](https://github.com/exwm/yt_clipper/commit/3edb00ebc26f6f6bd70019716faec44b883d7f44))
* **markup:** video progress bar and markers should be interactable when speed chart is displaying ([840f078](https://github.com/exwm/yt_clipper/commit/840f07862570f8dc3e3d7bbb5035f360692ff291))


### Major Dependency Upgrades

* **clipper:** update yt-dlp dependency from v2023.03.03 to v2023.07.06 ([69c0b34](https://github.com/exwm/yt_clipper/commit/69c0b3417693bcb9a067045cf0ade8f10e51e2e0))
* **clipper:** ffmpeg dependency updated to v6.0.0 (latest master branch builds)
