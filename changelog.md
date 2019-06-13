# yt_clipper Changelog

## Markup Script Changelog

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
