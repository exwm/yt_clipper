# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
