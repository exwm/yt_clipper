import { html } from 'lit-html';
import { renderUIIcon } from '../../features/icons/glyphs';

// Sits next to the yt_clipper command-palette (scissors) button in
// whichever video player rail the host platform uses. All sizing,
// colour, and centering live in CSS — see the
// `#hintsBarToggleButton.yt-clipper-hints-bar-button` rules in
// `ui/css/yt-clipper.css` (shared base) and
// `platforms/css/yt_clipper.css` (overrides for the vjs control bar).
export const hintsBarToggleButtonTemplate = html`
  <button
    id="hintsBarToggleButton"
    class="ytp-button"
    title="Toggle yt_clipper Contextual Hints Bar (Alt+F)"
  >
    <span class="yt-clipper-hints-bar-icon-wrap">${renderUIIcon('hamburger', 26)}</span>
  </button>
`;
