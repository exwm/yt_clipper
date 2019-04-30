# yt_clipper

## Hotkeys

**ctrl+shift+A:** toggle hotkeys on/off

**A:** Add marker at current time (start = green, end = yellow, selected = purple)

**Z:** Undo last marker (disabled if a marker pair is currently selected)

**shift+mouseover:** View marker pair info and edit a pair's speed or crop

* While a pair is selected use **shift+Q/shift+A** to move the start/end marker to current time
* While a pair is selected use **shift+Z** to delete the pair

**W:**

  1. Specify intended download resolution for correctly previewing crops
  2. Specify short title that will be prefixed to output script and webms
  3. Change default new marker speed or crop (output webm fps is **multiplied** by the speed factor)

**shift+E/D:** Update all markers to default new marker speed(E)/crop(D)

**shift+G:** Toggle auto video playback speed ducking based on markers

**Q:** Decrease video playback speed by 0.25. If the speed falls below 0 it will cycle back to 1.

**X:** When marker or defaults editor is open, begin drawing crop. **Shift+click** in the video to set the top left crop boundary and then **shift+click** again to set the bottom right. Any other click action (eg ctrl+click) will stop drawing.

**shift+X(v0.0.57+):** Like **X**, begin drawing a crop but set only the left and right boundaries on **shift+click**. Vertically fills the crop, that is, it sets the top to 0 and the bottom to the video height.

**S:** Save generated script (save it beside input webm)

**shift+S:** copy generated script to clipboard (useful if saving breaks due to network errors)

**alt+S:** save markers to a file (.json)

**G:** toggle markers .json file upload for reloading markers (must be from the same video)

**C:** upload anonymously to gfycat (only supports slowdown through the gfycat url)

**alt+shift+S:** save yt_clipper authorization server script (run it with python ./yt_clipper_auth.py, close it with ctrl+C)

**shift+C:** open gfycat browser authentication and upload under account (auth server must be running)

## Values

Crop is given as x:y:w:h where x:y defines the distance left:top from the top left corner and w:h defines the width:height of the output video. Each value is a positive integer in units of pixels. w and h can also be iw and ih respectively for the input width and input height.

## Tips

  1. If you're new to userscripts checkout the homepage at <https://greasyfork.org> for instructions.
  2. Checkout the companion script for copying gfy links from the gfycat upload results page as markdown at <https://greasyfork.org/en/scripts/369871-gfy2md>
  3. The script can be slow to load sometimes, so wait a bit before adding markers.
  4. Use ',' and '.' or '<' and '>' to view a video frame by frame
  5. Use [space_bar] to pause/play the video
  6. Refresh the page if the script doesn't load and to clear markers when switching videos in the same window

## Output Script Usage

```sh
python ./clip.py -h # Prints help. Details all options and arguments.

python ./clip.py ./filename.webm

python ./clip.py ./filename.webm --overlay ./overlay.png --gfycat

python ./clip.py -./filename.webm --format bestvideo+bestaudio --audio  # bestvideo+bestaudio is the default format 

python ./clip.py --url https://www.youtube.com/watch?v=0vrdgDdPApQ
```

## Dependencies

* ffmpeg must be in your path for the python script (<https://www.ffmpeg.org>)
* passing --url to the python script requires youtube-dl be in your path
  * `pip install youtube-dl`
* urllib3 is required by the python script only with --gfycat:
  * `pip install urllib3`
