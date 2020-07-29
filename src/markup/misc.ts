import { deleteElement, flashMessage } from './util';

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
  window.open(url, '_blank');
}
