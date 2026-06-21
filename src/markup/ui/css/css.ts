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

// Applied while the crop chart is open on YouTube so a tall video doesn't push
// the chart out of the viewport. Caps the player to 85vh in both layouts:
// theater caps #full-bleed-container; the default layout caps #player, which is
// the positioned (relative) containing block for the absolute player container,
// so capping it shrinks the whole player and centerVideo re-fits the video into
// it (capping a static descendant wouldn't resize the absolute child). max-height
// is a cap, not a force, so a video shorter than 85vh keeps its natural size and
// isn't stretched with black bars.
export const cropChartActiveVideoHeightCSS = `
        #full-bleed-container {
          max-height: 85vh !important;
        }
        ytd-watch-flexy:not([theater]) #player {
          max-height: 85vh !important;
          overflow: hidden !important;
        }
        #page-manager {
          margin-top: 0px !important;
        }
        #masthead {
          display: none !important;
        }
      `;

// The video's rotate transform is applied separately via applyVideoTransform()
// (video-transform.ts) so it can compose with the editor zoom; this only carries
// the layout adjustments a rotated (tall) video needs.
export function getRotatedVideoCSS() {
  return `
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
