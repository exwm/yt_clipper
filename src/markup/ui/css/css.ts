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

// Applied while the crop chart is open on YouTube so a tall (vertical)
// source video doesn't push the chart out of the viewport. Mirrors the
// height cap that `getRotatedVideoCSS` applies for rotated videos.
export const cropChartActiveVideoHeightCSS = `
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
