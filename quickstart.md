# yt_clipper Quick Start Guide

[**Full Instructions**](https://openuserjs.org/scripts/elwm/yt_clipper).

1) First install a user script extension (preferably Tampermonkey) for your browser (preferably chrome).
   - See [this article](https://openuserjs.org/about/Userscript-Beginners-HOWTO) for more information.
2) Next install the `markup script` component of `yt_clipper` by clicking [here](https://openuserjs.org/install/elwm/yt_clipper.user.js).
3) Install the standalone `clipper script` component of `yt_clipper` by visiting [this section](https://openuserjs.org/scripts/elwm/yt_clipper#clipper-script-installation).
   - Alternatively download the python source [here](https://github.com/exwm/yt_clipper/blob/master/src/clipper/yt_clipper.py) and see [this section](https://openuserjs.org/scripts/elwm/yt_clipper#clipper-script-usage) for usage instructions.
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
   - **Mac:** Launch the `yt_clipper_auto.sh` program, drag and drop the saved markers data onto the terminal, and hit **Enter**.
   - Find generated webms in `yt_clipper/webms/title-suffix` folder where `title-suffix` is the file name stem of the markers data file.
   - See [this section](https://openuserjs.org/scripts/elwm/yt_clipper#additional-helper-scripts) for details on the other helper scripts available.
8) See the [full instructions](https://openuserjs.org/scripts/elwm/yt_clipper) for more detail and advanced usage as well as changelogs.
9) Check the [changelogs](https://openuserjs.org/scripts/elwm/yt_clipper#markup-script-changelog) for updates as there is not yet an automated mechanism.
10) Join the [`yt_clipper` discord server](https://discord.gg/5RVGNCU) if you want further help or want to contribute.
