# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
