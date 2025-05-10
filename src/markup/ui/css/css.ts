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

    `;

export function getRotatedVideoCSS(rotation: number) {
  return `
        .yt-clipper-video {
          transform: rotate(${rotation}deg) !important;
        }
        #full-bleed-container {
          height: 85vh !important;
          max-height: none !important;
        }
        #page-manager {
          margin-top: 0px !important;
        }
        #masthead {
          display: none !important;
        }
      `;
}
