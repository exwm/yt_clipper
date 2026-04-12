import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { Crop } from './crop/crop';
import { getPlatform } from './platforms/platforms';
import { appState } from './appState';
import {
  safeSetInnerHtml,
  flashMessage,
  deleteElement,
  toHHMMSSTrimmed,
  getVideoDuration,
} from './util/util';
import { injectProgressBar } from './util/util';
import { getFPS } from './util/videoUtil';
import { multiplyCropString } from './crop-utils';

let frameCaptureViewerWindow: Window;
let frameCaptureViewerDoc: Document;
let isFrameCapturerZippingInProgress = false;

function getFrameCaptureViewerHeadHTML() {
  return `
      <title>yt_clipper Frame Capture Viewer</title>
      <style>
        body {
          margin: 0px;
          text-align: center;
        }
        #frames-div {
          font-family: Helvetica;
          background-color: rgb(160,50,20);
          margin: 0 auto;
          padding: 2px;
          width: 99%;
          text-align: center;
        }
        .frame-div {
          margin: 2px;
          padding: 2px;
          border: 2px black solid;
          font-weight: bold;
          color: black;
          text-align: center;
        }
        figcaption {
          display: inline-block;
          margin: 2px;
        }
        button {
          display: inline-block;
          font-weight: bold;
          margin-bottom: 2px;
          cursor: pointer;
          border: 2px solid black;
          border-radius: 4px;
        }
        button.download {
          background-color: rgb(66, 134, 244);
        }
        button.delete {
          background-color: red;
        }
        button:hover {
          box-shadow: 2px 4px 4px 0 rgba(0,0,0,0.2);
        }
        canvas {
          display: block;
          margin: 0 auto;
          ${appState.videoInfo.aspectRatio > 1 ? 'width: 98%;' : 'height: 96vh;'}
        }
        @keyframes flash {
          0% {
            opacity: 1;
          }
          100% {
            opacity: 0.5;
          }
        }
        .flash-div {
          animation-name: flash;
          animation-duration: 0.5s;
          animation-fill-mode: forwards;
        }
        </style>
      `;
}

const frameCaptureViewerBodyHTML = `\
        <div id="frames-div"><strong></strong></div>
        `;

export async function captureFrame() {
  const currentTime = appState.video.getCurrentTime();
  for (let i = 0; i < appState.video.buffered.length; i++) {
    console.log(appState.video.buffered.start(i), appState.video.buffered.end(i));
    if (
      appState.video.buffered.start(i) <= currentTime &&
      currentTime <= appState.video.buffered.end(i)
    ) {
      break;
    }

    if (i === appState.video.buffered.length - 1) {
      flashMessage('Frame not captured. Video has not yet buffered the frame.', 'red');
      return;
    }
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  let resString: string;
  if (appState.isSettingsEditorOpen) {
    const cropMultipleX = appState.video.videoWidth / appState.settings.cropResWidth;
    const cropMultipleY = appState.video.videoHeight / appState.settings.cropResHeight;
    if (!appState.wasGlobalSettingsEditorOpen) {
      const idx = parseInt(appState.prevSelectedEndMarker.getAttribute('data-idx')!, 10) - 1;
      const markerPair = appState.markerPairs[idx];
      resString = multiplyCropString(cropMultipleX, cropMultipleY, markerPair.crop);
    } else {
      resString = multiplyCropString(cropMultipleX, cropMultipleY, appState.settings.newMarkerCrop);
    }
    const cropRes = Crop.getMultipliedCropRes(
      appState.settings.cropRes,
      cropMultipleX,
      cropMultipleY
    );
    const [x, y, w, h] = Crop.getCropComponents(resString, cropRes);

    canvas.width = w;
    canvas.height = h;
    if (h > w) {
      canvas.style.height = '96vh';
      canvas.style.width = 'auto';
    }
    context.drawImage(appState.video, x, y, w, h, 0, 0, w, h);
    resString = `x${x}y${y}w${w}h${h}`;
  } else {
    resString = `x0y0w${appState.video.videoWidth}h${appState.video.videoHeight}`;
    canvas.width = appState.video.videoWidth;
    canvas.height = appState.video.videoHeight;
    context.drawImage(appState.video, 0, 0, appState.video.videoWidth, appState.video.videoHeight);
  }
  if (!frameCaptureViewerWindow || !frameCaptureViewerDoc || frameCaptureViewerWindow.closed) {
    frameCaptureViewerWindow = window.open(
      '',
      'window',
      `height=${window.innerHeight}, width=${window.innerWidth}`
    )!;
    frameCaptureViewerDoc = frameCaptureViewerWindow.document;
    safeSetInnerHtml(frameCaptureViewerDoc.head, getFrameCaptureViewerHeadHTML(), true);
    safeSetInnerHtml(frameCaptureViewerDoc.body, frameCaptureViewerBodyHTML, true);
  }
  const frameDiv = document.createElement('div');
  frameDiv.setAttribute('class', 'frame-div');
  const frameCount = getFrameCount(currentTime);
  const frameFileName = `${appState.settings.titleSuffix}-${resString}-@${currentTime}s(${toHHMMSSTrimmed(
    currentTime
  ).replace(':', ';')})-f${frameCount.frameNumber}(${frameCount.totalFrames})`;
  safeSetInnerHtml(
    frameDiv,
    `
      <figcaption>Resolution: ${canvas.width}x${canvas.height} Name: ${frameFileName}</figcaption>
      <button class="download">Download Frame</button>
      <button class="delete">Delete Frame</button>
      `
  );
  (canvas as any).fileName = `${frameFileName}.png`;
  frameDiv.appendChild(canvas);

  (frameDiv.getElementsByClassName('download')[0] as HTMLElement).onclick = () => {
    canvas.toBlob((blob) => { saveAs(blob!, (canvas as any).fileName); });
  };
  (frameDiv.getElementsByClassName('delete')[0] as HTMLElement).onclick = () => {
    frameDiv.setAttribute('class', 'frame-div flash-div');
    setTimeout(() => { deleteElement(frameDiv); }, 300);
  };

  const framesDiv = frameCaptureViewerDoc.getElementById('frames-div');
  framesDiv!.appendChild(frameDiv);
  flashMessage(`Captured frame: ${frameFileName}`, 'green');
}

export function getFrameCount(seconds: number) {
  const fps = getFPS(null);
  let frameNumber: number | string;
  let totalFrames: number | string;
  if (fps) {
    frameNumber = Math.floor(seconds * fps);
    totalFrames = Math.floor(getVideoDuration(getPlatform(), appState.video) * fps);
  } else {
    frameNumber = 'Unknown';
    totalFrames = 'Unknown';
  }
  return { frameNumber, totalFrames };
}

function canvasBlobToPromise(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => { resolve(blob!); });
  });
}

export function saveCapturedFrames() {
  if (isFrameCapturerZippingInProgress) {
    flashMessage(
      'Frame Capturer zipping already in progress. Please wait before trying to zip again.',
      'red'
    );
    return;
  }
  if (!frameCaptureViewerWindow || frameCaptureViewerWindow.closed || !frameCaptureViewerDoc) {
    flashMessage('Frame capturer not open. Please capture a frame before zipping.', 'olive');
    return;
  }
  const zip = new JSZip();
  const framesZip = zip.folder(appState.settings.titleSuffix)!.folder('frames');
  const frames = frameCaptureViewerDoc.getElementsByTagName('canvas');
  if (frames.length === 0) {
    flashMessage('No frames to zip.', 'olive');
    return;
  }

  isFrameCapturerZippingInProgress = true;
  Array.from(frames).forEach((frame) => {
    framesZip!.file((frame as any).fileName, canvasBlobToPromise(frame), { binary: true });
  });
  const progressDiv = injectProgressBar('green', 'Frame Capturer');
  const progressSpan = progressDiv.firstElementChild;
  zip
    .generateAsync({ type: 'blob' }, (metadata) => {
      const percent = metadata.percent.toFixed(2) + '%';
      progressSpan!.textContent = `Frame Capturer Zipping Progress: ${percent}`;
    })
    .then((blob) => {
      saveAs(blob, `${appState.settings.titleSuffix}-frames.zip`);
      progressDiv.dispatchEvent(new Event('done'));
      isFrameCapturerZippingInProgress = false;
    });
}
