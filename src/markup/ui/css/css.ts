export const autoHideUnselectedMarkerPairsCSS = `
    rect.marker {
      opacity: 0.25;
    }
    text.markerNumbering {
      opacity: 0.25;
      pointer-events: none;
    }

    rect.selected-marker {
      opacity: 1;
    }
    text.selectedMarkerNumbering {
      opacity: 1;
      pointer-events: visibleFill;
    }

    rect.marker.end-marker {
      pointer-events: none;
    }
    rect.selected-marker.end-marker {
      pointer-events: visibleFill;
    }
    `;

export const adjustRotatedVideoPositionCSS = `\
    @media (min-aspect-ratio: 29/18) {
      .yt-clipper-video {
        margin-left: 36%;
      }
    }
    @media (min-aspect-ratio: 40/18) {
      .yt-clipper-video {
        margin-left: 25%;
      }
    }
    @media (max-aspect-ratio: 29/18) {
      .yt-clipper-video {
        margin-left: 34%;
      }
    }
    @media (max-aspect-ratio: 13/9) {
      .yt-clipper-video {
        margin-left: 32%;
      }
    }
    @media (max-aspect-ratio: 23/18) {
      .yt-clipper-video {
        margin-left: 30%;
      }
    }
    @media (max-aspect-ratio: 10/9) {
      .yt-clipper-video {
        margin-left: 26%;
      }
    }
    @media (max-aspect-ratio: 17/18) {
      .yt-clipper-video {
        margin-left: 22%;
      }
    }
    @media (max-aspect-ratio: 7/9) {
      .yt-clipper-video {
        margin-left: 16%;
      }
    }
    @media (max-aspect-ratio: 6/9) {
      .yt-clipper-video {
        margin-left: 14%;
      }
    }
    @media (max-aspect-ratio: 11/18) {
      .yt-clipper-video {
        margin-left: 10%;
      }
    }
    @media (max-aspect-ratio: 5/9) {
      .yt-clipper-video {
        margin-left: 0%;
      }
    }
    `;

export function getRotatedVideoCSS(rotation: number) {
  return `
        .yt-clipper-video {
          transform: rotate(${rotation}deg) scale(2.2) !important;
          max-width: 45vh;
          max-height: 100vw;
        }
        #player-theater-container {
          height: 100vh !important;
          max-height: none !important;
        }
        #page-manager {
          margin-top: 0px !important;
        }
        #masthead #container {
          display: none !important;
        }
      `;
}
