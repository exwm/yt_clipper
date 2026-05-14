import { deleteElement, flashMessage } from '../util/util';

export function flattenVRVideo(videoContainer: HTMLDivElement, video: HTMLVideoElement) {
  let isVRVideo = true;

  const VRCanvas = videoContainer.getElementsByClassName('webgl')[0];
  VRCanvas != null ? deleteElement(VRCanvas) : (isVRVideo = false);
  const VRControl = document.getElementsByClassName('ytp-webgl-spherical-control')[0];
  VRControl != null ? deleteElement(VRControl) : (isVRVideo = false);

  if (isVRVideo) {
    videoContainer.style.cursor = 'auto';
    video.style.display = 'block';
    flashMessage('Flattened VR video.', 'green');
  } else {
    flashMessage('Not a VR video or already flattened.', 'red');
  }
}
export function openSubsEditor(videoID) {
  const url = `https://www.youtube.com/timedtext_video?ref=player&v=${videoID}`;
  // eslint-disable-next-line local/no-url-attribute-interpolation -- videoID is read from YouTube's DOM via getCurrentPageVideoID(); the host-page trust root governs its value, and the URL scheme is hardcoded https.
  window.open(url, '_blank');
}
