import { stripIndent } from 'common-tags';

export namespace Tooltips {
  export const markerPairNumberTooltip = stripIndent`
    Enter a new marker pair number here to reorder marker pairs.
    `;

  export const speedTooltip = stripIndent`
    Toggle speed previewing with C.
    Note that speeds below 0.25 cannot be previewed as YouTube does not support it.
    Also note that when audio is enabled, speeds below 0.5 are not yet supported.
    `;

  export const cropTooltip = stripIndent`
    Crop values are given as x-offset:y-offset:width:height.
    Each value is a positive integer in pixels.
    Width and height can also be iw and ih respectively for input width and input height.
    Use Ctrl+Click+Drag on the crop preview to adjust the crop with the mouse instead.
    Increment/decrement with the up/down keys by ±10.
    The cursor position within the crop string determines the crop component to change.
    Use modifier keys to alter the change amount: Alt: ±1, Shift: ±50, Alt+Shift: ±100.
    `;

  export const titlePrefixTooltip = stripIndent`
    Specify a title prefix to be prepended to the tile suffix of the file name generated by this marker pair.
    `;

  export const titleSuffixTooltip = stripIndent`
    Specify a title suffix to be appended to the title prefixes specified for each marker pair.
    The title suffix is then followed by the marker pair number to make up the final file name for each marker pair.
    `;

  export const cropResolutionTooltip = stripIndent`
    The crop resolution specifies the scaling of crop strings, which should match the input video's resolution.
    The script will automatically scale the crop resolution if a mismatch with the input video's resolution is detected.
    Lower crop resolutions can be easier to work with.
    `;

  export const rotateTooltip = stripIndent`
    Correct video rotation by rotating the input video clockwise or counterclockwise by 90 degrees.
    Note that the YouTube video rotate preview using the R/Alt+R shortcut does NOT affect the output video. 
    `;

  export const mergeListTooltip = stripIndent`
    Specify which marker pairs if any you would like to merge/concatenate.
    Each merge is a comma separated list of marker pair numbers or ranges (e.g., '1-3,5,9' = '1,2,3,5,9').
    Multiple merges are separated with semicolons (e.g., '1-3,5,9;6-2,8' will create two merged webms).
    `;

  export const audioTooltip = stripIndent`
    Enable audio.
    Not yet compatible with special loop behaviors or time-variable speed.
    `;

  export const encodeSpeedTooltip = stripIndent`
    Higher values will speed up encoding at the cost of some quality.
    Very high values will also reduce bitrate control effectiveness, which may increase file sizes.
    `;

  export const CRFTooltip = stripIndent`
    Constant Rate Factor or CRF allows the video bitrate to vary while maintaining roughly constant quality.
    Lower CRF values result in higher quality but larger file sizes.
    A CRF around 20 (~25 for 4k) usually results in file size compression that does not visibly reduce quality.
    When the target bitrate is set to 0 (unlimited), the bitrate is unconstrained and operates in constant quality mode .
    When the target bitrate is set to auto or a positive value in kbps, the script operates in constrained quality mode.
    Constrained quality mode keeps file sizes reasonable even when low CRF values are specified.
    `;

  export const targetBitrateTooltip = stripIndent`
    Specify the target bitrate in kbps of the output video.
    The bitrate determines how much data is used to encode each second of video and thus the final file size.
    If the bitrate is too low then the compression of the video will visibly reduce quality.
    When the target bitrate is set to 0 for unlimited, the script operates in constant quality mode.
    When the target bitrate is set to auto or a positive value in kbps, the script operates in constrained quality mode.
    Constrained quality mode keeps file sizes reasonable even when low CRF values are specified.
    `;

  export const twoPassTooltip = stripIndent`
    Encode in two passes for better quality and smaller file sizes.
    Significantly reduces encode speed.
    `;

  export const gammaTooltip = stripIndent`
    A gamma function is used to map input luminance values to output luminance values or vice versa.
    The gamma value is an exponent applied to the input luminance values.
    A gamma value of 1 is neutral and does not modify the video.
    A gamma value greater than 1 can be used to darken the video and enhance highlight detail.
    A gamma value less than 1 can be used to lighten the video and enhance shadow detail.
    Even small changes in gamma can have large effects (smallest possible change is 0.1).
    Use the gamma preview toggle (Alt+C) to set the gamma to taste.
    `;

  export const expandColorRangeTooltip = stripIndent`
    This filter tries to enhance the vividness of colors, make shadows darker, and make highlights brighter.
    The result may not be accurate and your mileage will vary depending on the input video.
    `;

  export const denoiseTooltip = stripIndent`
    Reduce noise, static, and blockiness at the cost of some encoding speed.
    Improves compression efficiency and thus reduces file sizes.
    `;

  export const vidstabTooltip = stripIndent`
    Video stabilization tries to smooth out the motion in the video and reduce shaking.
    Usually requires the cropping and zooming of the video.
    Higher strength presets result in more cropping and zooming.
    Low contrast video or video with flashing lights may give poor results.
    If the video includes a logo or other static element within the cropped region, \
    video stabilization may cause the logo to shake.
    `;

  export const dynamicZoomTooltip = stripIndent`
    Allow cropping and zooming of video to vary with the need for stabilization over time.
    `;

  export const speedMapTooltip = stripIndent`
    Time-variable speed maps are enabled by default, but can be force enabled/disabled with this setting.
    A speed map may be specified using the speed chart (toggled with D).
    `;
  export const loopTooltip = stripIndent`
    Enable one of the special loop behaviors.
    fwrev loops will play the video normally once, then immediately play it in reverse.
    fade loops will crossfade the end of the video into the start of the video.
    fade loops can make short clips easier on the eyes and reduce the perceived jerkiness when the video repeats.
    `;

  export const fadeDurationTooltip = stripIndent`
    The duration to cut from the beginning and end of the output video to produce the crossfade for fade loops.
    Will be clamped to a minimum of 0.1 seconds and a maximum of 40% of the output clip duration.
    Only applicable when loop is set to fade.
    `;
}