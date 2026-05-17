/**
 * Icon registry + render helpers for the injected UI (hints bar chord pills,
 * toggle buttons, hover-bar controls).
 *
 * Almost all glyphs come from Blender's open-source icon set (via
 * ui.blender.org). Blender authors these specifically for dense UI
 * rendering at 16–18 px with strict pixel alignment — exactly the size
 * range our chord pills render at. Notable Blender coverage that's rare
 * elsewhere: explicit left / right / middle mouse button variants,
 * scroll-wheel, drag-with-button, AND key-cap glyphs for Ctrl / Shift /
 * Alt. Each entry carries a `// blender:<NAME>` comment for traceability.
 * Licensed CC BY-SA 4.0.
 *
 * The only custom glyph is **Meta** (the ⌘ Command key) — Blender is
 * platform-agnostic about Mac vs Windows and doesn't ship a Command-key
 * glyph, so we draw four filled squares ourselves.
 *
 * Adding a new Blender icon: find it on ui.blender.org's icon browser,
 * copy the SVG, paste it as a new template literal below with the
 * `// blender:<NAME>` comment, replace `fill="#fff"` (or any inline
 * fill style) with `fill="currentColor"` so CSS color inheritance works,
 * and surface a renderer helper if it's not already covered.
 */

import { html, svg, type TemplateResult } from 'lit-html';

interface GlyphData {
  /** Source ID (`blender:<NAME>` or `"custom"`) — kept for traceability. */
  readonly source: string;
  /** Inner SVG markup; the renderer adds the outer `<svg>` wrapper. */
  readonly body: TemplateResult;
  readonly viewBox: string;
}

// =============================================================================
// Blender icons — viewBox varies (1800x1800 for mouse/menu, 1000x800 for
// horizontal triangles, 800x1000 for vertical triangles). The renderer
// places them in a fixed-size box with SVG's default
// preserveAspectRatio="xMidYMid meet" — triangles end up centered with
// implicit padding on the short axis, which reads correctly in chord pills.
// =============================================================================

// blender:MOUSE_LMB — mouse outline with the left button highlighted.
const BLENDER_MOUSE_LMB: GlyphData = {
  source: 'blender:MOUSE_LMB',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m10.484375 450.98353c-.752 0-1.4538175.239-2.0234375.64453-.88567.63055-1.4609375 1.67061-1.4609375 2.83985v4.03209c.00003.27537.2226769.4989.4980469.5l4.0097651.008c.27613-.00003.49997-.22387.5-.5l-.007812-6.98931v-.002-.0352c-.001-.27524-.22466-.49793-.5-.49796zm2.515625 0v1h2.508368c1.38452 0 2.484375 1.09985 2.484375 2.48438v9.04771c0 1.38452-1.099855 2.48438-2.484375 2.48438h-5.023993c-1.38452 0-2.484375-1.09986-2.484375-2.48438v-3.51562h-1v3.51562c0 1.92123 1.563145 3.48438 3.484375 3.48438h5.023993c1.92123 0 3.484375-1.56314 3.484375-3.48438v-9.04771c0-1.92123-1.563145-3.48438-3.484375-3.48438z" transform="matrix(100 0 0 100 -599.6372 -44999.17700000001)"/></g>`,
};

// blender:MOUSE_RMB — mouse outline with the right button highlighted.
const BLENDER_MOUSE_RMB: GlyphData = {
  source: 'blender:MOUSE_RMB',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m57.512484 450.98438c.752 0 1.453818.239 2.023438.64453.88567.63055 1.460937 1.67061 1.460937 2.83985v4.03124c-.00003.27537-.222677.4989-.498047.5l-4.009765.008c-.27613-.00003-.49997-.22387-.5-.5l.0078-6.98846v-.002-.0352c.001-.27524.22466-.49793.5-.49796zm-2.515625 0v1h-2.512484c-1.38452 0-2.484375 1.09985-2.484375 2.48438v9.04686c0 1.38452 1.099855 2.48438 2.484375 2.48438h5.028109c1.38452 0 2.484375-1.09986 2.484375-2.48438v-3.51562h1v3.51562c0 1.92123-1.563145 3.48438-3.484375 3.48438h-5.028109c-1.92123 0-3.484375-1.56314-3.484375-3.48438v-9.04686c0-1.92123 1.563145-3.48438 3.484375-3.48438z" transform="matrix(100 0 0 100 -4799.843 -44999.219)"/></g>`,
};

// blender:MOUSE_MMB — mouse outline with the wheel/middle button highlighted.
const BLENDER_MOUSE_MMB: GlyphData = {
  source: 'blender:MOUSE_MMB',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m31.484375 450.99458c-1.92123 0-3.484375 1.56315-3.484375 3.48438v9.03666c0 1.92123 1.563145 3.48438 3.484375 3.48438h5.082348c1.92123 0 3.484375-1.56315 3.484375-3.48438v-9.03666c0-1.92123-1.563145-3.48438-3.484375-3.48438zm0 1h5.082348c1.38453 0 2.484375 1.09985 2.484375 2.48438v9.03666c0 1.38453-1.099845 2.48438-2.484375 2.48438h-5.082348c-1.38453 0-2.484375-1.09985-2.484375-2.48438v-9.03666c0-1.38453 1.099845-2.48438 2.484375-2.48438zm1.5625 1c-.57133 0-1.046875.47555-1.046875 1.04688v4.91166c0 .57133.475545 1.04688 1.046875 1.04688h1.973036c.57133 0 1.046875-.47555 1.046875-1.04688v-4.91166c0-.57133-.475545-1.04688-1.046875-1.04688z" transform="matrix(99.598235 0 0 100 -2688.8846 -44999.729)"/></g>`,
};

// blender:MOUSE_MMB_SCROLL — mouse outline with the wheel highlighted and
// up/down chevrons indicating scroll direction.
const BLENDER_MOUSE_MMB_SCROLL: GlyphData = {
  source: 'blender:MOUSE_MMB_SCROLL',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m31.484382 450.99458c-1.921226 0-3.484389 1.56316-3.484389 3.48439v9.03664c0 1.92123 1.563163 3.48439 3.484389 3.48439h1.988723c-.0023-.007-.986951-1-.986951-1h-1.001824c-1.384526 0-2.484376-1.09986-2.484376-2.48439v-9.03664c0-1.38453 1.09985-2.48439 2.484376-2.48439h1.034848s1.00328-.99586 1.00327-1.00003zm3.042928.00001 1.004566 1.00003h1.03478c1.384528 0 2.484376 1.09986 2.484376 2.48439v9.03664c0 1.38453-1.099848 2.48439-2.484376 2.48439h-1.011359l-1.002942 1.00004h2.014337c1.921226 0 3.484389-1.56316 3.484389-3.48439v-9.03664c0-1.92123-1.563163-3.4844-3.484389-3.4844zm-1.469324 5.01106c-.571325.003-1.046863.47556-1.046863 1.04689v3.89319c0 .57133.475533 1.04689 1.046863 1.04689h1.928585c.571328 0 1.046862-.47556 1.046862-1.04689v-3.89319c0-.57133-.473869-1.0621-1.045187-1.05863z" transform="matrix(99.598235 0 0 100 -2688.8846 -44999.729)"/><g fill-rule="evenodd" stroke-width="25"><path d="m700.0224 1600.3852-299.81007-300.3127 599.88877-.1344z"/><path d="m699.97151 200.01734 300.20149 299.92135-599.88879.13433z"/></g></g>`,
};

// blender:MOUSE_LMB_DRAG — left-button mouse glyph with a vertical drag
// indicator next to the mouse body. One glyph that reads as the whole
// click-and-drag gesture (used for the `drag` chord token, distinct from
// the plain `click` token which uses MOUSE_LMB).
const BLENDER_MOUSE_LMB_DRAG: GlyphData = {
  source: 'blender:MOUSE_LMB_DRAG',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m1347.9272 100.2289c-44.785 1.82-64.741 57.103-31.445 87.11 58.809 54.453 84.18 108.56 84.18 160.156l-.391 601.94086c-1 67.61594 100.6792 67.61594 99.7232 0l.4-601.95586c0-85.09-42.9022-165.971-115.9342-233.594-9.82-9.31-23.001-14.245998-36.524-13.672zm301.563 200.17924c-27.537.4-49.542 23.047-49.219 50.586v398.10992c-1 67.616 100.8176 67.616 99.8616 0v-398.10992c.3-28.15-22.4936-51.025-50.6426-50.586z" stroke-width="100"/><path d="m10.484375 450.98353c-.752 0-1.4538175.239-2.0234375.64453-.88567.63055-1.4609375 1.67061-1.4609375 2.83985v4.03209c.00003.27537.2226769.4989.4980469.5l4.0097651.008c.27613-.00003.49997-.22387.5-.5l-.007812-6.98931v-.002-.0352c-.001-.27524-.22466-.49793-.5-.49796zm2.515625 0v1h2.508368c1.38452 0 2.484375 1.09985 2.484375 2.48438v9.04771c0 1.38452-1.099855 2.48438-2.484375 2.48438h-5.023993c-1.38452 0-2.484375-1.09986-2.484375-2.48438v-3.51562h-1v3.51562c0 1.92123 1.563145 3.48438 3.484375 3.48438h5.023993c1.92123 0 3.484375-1.56314 3.484375-3.48438v-9.04771c0-1.92123-1.563145-3.48438-3.484375-3.48438z" transform="matrix(100 0 0 100 -599.6372 -44999.17700000001)"/></g>`,
};

// blender:MOUSE_MOVE — plain mouse outline (no button highlighted) plus a
// move/trail indicator. We use it for the `mouseover` chord token.
const BLENDER_MOUSE_MOVE: GlyphData = {
  source: 'blender:MOUSE_MOVE',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m1347.7138 101.47718c-44.785 1.82-64.741 57.103-31.445 87.11 58.809 54.453 84.18 108.56 84.18 160.156l-.391 600.571c-1 67.61622 100.956 67.61622 100 0l.4-600.586c0-85.09-43.179-165.971-116.211-233.594-9.82-9.31-23.001-14.246-36.524-13.672zm301.563 201.563c-27.537.4-49.542 23.047-49.219 50.586v405.859c-1 67.616 100.956 67.616 100 0v-405.859c.3-28.15-22.632-51.025-50.781-50.586z" stroke-width="100"/><path d="m31.484375 450.99458c-1.92123 0-3.484375 1.56315-3.484375 3.48438v9.03666c0 1.92123 1.563145 3.48438 3.484375 3.48438h5.082348c1.92123 0 3.484375-1.56315 3.484375-3.48438v-9.03666c0-1.92123-1.563145-3.48438-3.484375-3.48438zm0 1h5.082348c1.38453 0 2.484375 1.09985 2.484375 2.48438v9.03666c0 1.38453-1.099845 2.48438-2.484375 2.48438h-5.082348c-1.38453 0-2.484375-1.09985-2.484375-2.48438v-9.03666c0-1.38453 1.099845-2.48438 2.484375-2.48438z" transform="matrix(99.598235 0 0 100 -2688.8846 -44999.729)"/></g>`,
};

// blender:TRIA_UP — small upward-pointing triangle. Doubles as both the
// `up` arrow-key glyph in chord pills AND the chevron-up control on the
// hints-bar header (Blender doesn't ship a separate chevron; the triangle
// is the same shape we want).
const BLENDER_TRIA_UP: GlyphData = {
  source: 'blender:TRIA_UP',
  viewBox: '0 0 1000 800',
  body: svg`<path fill="currentColor" fill-rule="evenodd" d="m156 629.49414c0 .27842.2216.50584.5.50586h7c.4051.0006.6427-.45544.4102-.78711l-3.5-5c-.199-.28542-.6214-.28542-.8204 0l-3.5 5c-.058.0826-.089.1806-.09.28125z" transform="matrix(100 0 0 100 -15500 -62301.636)"/>`,
};

// blender:TRIA_DOWN — small downward-pointing triangle.
const BLENDER_TRIA_DOWN: GlyphData = {
  source: 'blender:TRIA_DOWN',
  viewBox: '0 0 1000 800',
  body: svg`<path fill="currentColor" fill-rule="evenodd" d="m113.9992 624.50586c0-.27842.2216-.50584.5-.50586h7c.4051-.0006.6427.45544.4102.78711l-3.5 5c-.199.28542-.6214.28542-.8204 0l-3.5-5c-.058-.0826-.089-.1806-.09-.28125z" transform="matrix(100 0 0 100 -11300 -62303.986)"/>`,
};

// blender:TRIA_LEFT
const BLENDER_TRIA_LEFT: GlyphData = {
  source: 'blender:TRIA_LEFT',
  viewBox: '0 0 800 1000',
  body: svg`<path fill="currentColor" fill-rule="evenodd" d="m141.49531 622.99926c.27843 0 .50584.2216.50587.5v7c.00059.4051-.45545.6427-.78712.4102l-5-3.5c-.28541-.199-.28541-.6214 0-.8204l5-3.5c.0826-.058.1806-.089.28125-.09z" transform="matrix(100 0 0 100 -13500 -62200)"/>`,
};

// blender:TRIA_RIGHT
const BLENDER_TRIA_RIGHT: GlyphData = {
  source: 'blender:TRIA_RIGHT',
  viewBox: '0 0 800 1000',
  body: svg`<path fill="currentColor" fill-rule="evenodd" d="m94.50586 623c-.27842 0-.50585.2216-.50586.5v7c-.00061.4051.45544.6427.78711.4102l5-3.5c.28542-.199.28542-.6214 0-.8204l-5-3.5c-.0826-.058-.1806-.089-.28125-.09z" transform="matrix(100 0 0 100 -9300 -62200)"/>`,
};

// blender:STATUSBAR — depicts a window/panel with a status bar at the
// bottom. Used as the hints-bar visibility toggle in the YouTube player
// rail because it directly suggests "toggle the bar at the bottom" — a
// much closer semantic match than the generic hamburger/menu glyph.
const BLENDER_STATUSBAR: GlyphData = {
  source: 'blender:STATUSBAR',
  viewBox: '0 0 1600 1600',
  body: svg`<g fill="currentColor"><g transform="matrix(-100 0 0 -100 56200.001 66499.99900000001)"><path opacity=".6" d="m7 654v8c0 .54532.45468 1 1 1h12c.54532 0 1-.45468 1-1v-8h-1v8h-12v-8z" transform="translate(540 1)"/><path d="m27 680v3c0 .54532.45468 1 1 1h12c.54532 0 1-.45468 1-1v-3h-1-12zm1 1h2v2h-2z" transform="matrix(1 0 0 -1 520 1334)"/></g></g>`,
};

// blender:PANEL_CLOSE — the close X. A `+` shape rotated 45° via the
// path's transform matrix (Blender's clever way of drawing an X with
// pixel-aligned arms).
const BLENDER_PANEL_CLOSE: GlyphData = {
  source: 'blender:PANEL_CLOSE',
  viewBox: '0 0 1000 1000',
  body: svg`<g fill="currentColor"><path d="m306.99023 241.72461a.66673335.66673335 0 0 0 -.65625.67578v5.93359h-5.93359a.66673335.66673335 0 1 0 0 1.33204h5.93359v5.93359a.66673335.66673335 0 1 0 1.33204 0v-5.93359h5.93359a.66673335.66673335 0 1 0 0-1.33204h-5.93359v-5.93359a.66673335.66673335 0 0 0 -.67579-.67578z" transform="matrix(-53.033 -53.033 -53.033 53.033 29986.348 3575.914)"/></g>`,
};

// =============================================================================
// Blender modifier glyphs — Ctrl and Alt render as a hollow rounded
// key-cap outline with the modifier symbol inside (Blender's unfilled
// `KEY_*` variants, not the heavier `KEY_*_FILLED` ones). The outline
// reads as a frame around the symbol rather than competing with it at
// 12–16 px. Shift is just the ⇧ silhouette — Blender's KEY_SHIFT ships
// without a surrounding cap.
//
// Note: Blender doesn't ship a Cmd/Meta key glyph (the app is keyboard-
// agnostic to Mac vs Windows), so MOD_META below stays custom.
// =============================================================================

// blender:KEY_CONTROL — hollow rounded key-cap outline with an up-chevron
// (⌃) inside. Outline style (not the FILLED variant) so the key-cap reads
// as a frame around the symbol rather than competing with it.
const MOD_CTRL: GlyphData = {
  source: 'blender:KEY_CONTROL',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m 31.484375,450.99731 c -1.92123,0 -3.483002,1.56042 -3.483002,3.48165 v 9.03666 c 0,1.92123 1.561772,3.48168 3.483002,3.48168 h 9.095609 c 1.92123,0 3.485856,-1.56045 3.485856,-3.48168 v -9.03666 c 0,-1.92123 -1.564626,-3.48165 -3.485856,-3.48165 z m 0,1.00001 h 9.095609 c 1.38453,0 2.481865,1.09711 2.481865,2.48164 v 9.03666 c 0,1.38453 -1.097335,2.48168 -2.481865,2.48168 h -9.095609 c -1.38453,0 -2.479002,-1.09715 -2.479002,-2.48168 v -9.03666 c 0,-1.38453 1.094472,-2.48164 2.479002,-2.48164 z" transform="matrix(99.598235,0,0,100,-2688.8846,-44999.729)"/><path d="m 879.41846,602.96175 a 78.941779,81.883008 0 0 0 -35.3845,21.1851 L 423.05843,1060.8127 a 78.933886,81.874821 0 0 0 3e-5,115.7883 78.933886,81.874821 0 0 0 111.62985,0 L 899.84886,797.83031 1265.017,1176.6033 a 78.933886,81.874821 0 0 0 111.6299,0 78.933886,81.874821 0 0 0 0,-115.7883 L 955.66366,624.14695 a 78.941779,81.883008 0 0 0 -76.2451,-21.18511 z"/></g>`,
};

// blender:KEY_SHIFT — bare shift-arrow shape, no key-cap outline. Blender's
// unfilled Shift glyph ships without the surrounding cap (unlike KEY_CONTROL
// / KEY_OPTION) — the ⇧ silhouette is iconic enough on its own.
const MOD_SHIFT: GlyphData = {
  source: 'blender:KEY_SHIFT',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor" transform="matrix(12.467986,0,0,12.464937,1320.2753,-785.84062)"><path d="m -25.683279,74.626271 c -4.763505,-4.754888 -11.429476,-4.750014 -16.058382,-0.142961 l -53.705667,53.45212 c -4.971712,4.94825 -1.523831,15.31529 4.084739,15.32468 l 13.56107,0.0227 c 2.645399,0.004 3.96329,1.14044 3.9697,3.97372 l 0.06278,27.75038 c 0.03316,14.65826 -0.07318,24.42133 16.000057,24.421 l 48.1253755,-0.001 c 16.0775186,-3.4e-4 16.089285,-10.02945 16.0621447,-24.15618 l -0.053859,-28.03397 c -0.00516,-2.68487 1.0092566,-4.00455 4.0075438,-3.99701 l 13.363106,0.0336 c 5.784713,0.0145 9.314969,-10.01974 4.072176,-15.25305 z M -1.5576726,175.45807 c -0.1016219,11.73412 0.040504,15.94652 -12.1147894,15.94652 h -40.25719 c -12.333562,0 -11.549723,-4.07533 -11.904873,-16.05426 l 0.03836,-32.16491 c 0.0052,-4.33348 -3.176402,-7.92303 -8.040291,-7.92427 l -11.802624,-0.003 c -4.129012,-0.001 -3.772884,-2.17478 -2.010777,-3.92528 l 48.895713,-48.573612 c 5.158669,-5.124687 5.482955,-4.617169 10.150274,0.05419 l 48.376803,48.418682 c 1.473459,1.47473 3.121303,4.0331 -1.671324,4.02984 l -11.7436716,-0.008 c -4.9812408,-0.003 -7.9748377,2.99718 -7.9820861,8.03481 z"/></g>`,
};

// blender:KEY_OPTION — rounded key-cap with the Mac ⌥ Option glyph
// inside (two stepped horizontal lines, the canonical Alt/Option shape).
const MOD_ALT: GlyphData = {
  source: 'blender:KEY_OPTION',
  viewBox: '0 0 1800 1800',
  body: svg`<g fill="currentColor"><path d="m 31.484375,450.99731 c -1.92123,0 -3.483002,1.56042 -3.483002,3.48165 v 9.03666 c 0,1.92123 1.561772,3.48168 3.483002,3.48168 h 9.095609 c 1.92123,0 3.485856,-1.56045 3.485856,-3.48168 v -9.03666 c 0,-1.92123 -1.564626,-3.48165 -3.485856,-3.48165 z m 0,1.00001 h 9.095609 c 1.38453,0 2.481865,1.09711 2.481865,2.48164 v 9.03666 c 0,1.38453 -1.097335,2.48168 -2.481865,2.48168 h -9.095609 c -1.38453,0 -2.479002,-1.09715 -2.479002,-2.48168 v -9.03666 c 0,-1.38453 1.094472,-2.48164 2.479002,-2.48164 z" transform="matrix(99.598235,0,0,100,-2688.8846,-44999.729)"/><path d="M 6.9468697 9.1231197 C 6.5326565 9.1231197 6.2287565 9.4320814 6.2287565 9.8462941 C 6.2287565 10.260507 6.5326565 10.558765 6.9468697 10.558765 L 10.066848 10.558765 L 11.808277 13.937178 C 11.924805 14.21611 12.166848 14.397848 12.469144 14.398131 L 17.010615 14.398131 C 17.424828 14.398131 17.74468 14.091888 17.74468 13.677675 C 17.74468 13.263462 17.419524 12.959824 17.00531 12.959824 L 12.944474 12.959824 L 11.188255 9.5867161 C 11.071727 9.307783 10.856733 9.1234018 10.554437 9.1231197 L 6.9468697 9.1231197 z M 13.66838 9.1255378 C 13.254166 9.1255378 12.946555 9.4346108 12.946555 9.8488246 C 12.946555 10.263038 13.254166 10.558765 13.66838 10.558765 L 17.007972 10.558765 C 17.422185 10.558765 17.742037 10.258237 17.742037 9.8440259 C 17.742037 9.4298123 17.422185 9.1255378 17.007972 9.1255378 L 13.66838 9.1255378 z" transform="matrix(104.19557,0,0,104.19557,-348.94242,-300.46171)"/></g>`,
};

// Meta — Blender doesn't ship a Cmd/Meta glyph. Keep the custom ⌘ shape
// (four filled squares) so chords with Meta still render unambiguously.
const MOD_META: GlyphData = {
  source: 'custom',
  viewBox: '0 0 14 14',
  body: svg`<path fill="currentColor" d="M2 2.4 L 6 2.4 L 6 6.4 L 2 6.4 Z M 8 2.4 L 12 2.4 L 12 6.4 L 8 6.4 Z M 2 7.8 L 6 7.8 L 6 11.8 L 2 11.8 Z M 8 7.8 L 12 7.8 L 12 11.8 L 8 11.8 Z"/>`,
};

// =============================================================================
// Public types + render helpers
// =============================================================================

export type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta';
export type ArrowDir = 'up' | 'down' | 'left' | 'right';
export type MouseToken =
  | 'click'
  | 'right-click'
  | 'mouseover'
  | 'drag'
  | 'mousewheel'
  | 'wheel-click';
export type UIIconName = 'close' | 'chevronUp' | 'chevronDown' | 'hamburger';

const MODIFIER_GLYPHS: Record<ModifierKey, { glyph: GlyphData; label: string }> = {
  ctrl: { glyph: MOD_CTRL, label: 'Control' },
  shift: { glyph: MOD_SHIFT, label: 'Shift' },
  alt: { glyph: MOD_ALT, label: 'Alt' },
  meta: { glyph: MOD_META, label: 'Meta' },
};

const ARROW_GLYPHS: Record<ArrowDir, GlyphData> = {
  up: BLENDER_TRIA_UP,
  down: BLENDER_TRIA_DOWN,
  left: BLENDER_TRIA_LEFT,
  right: BLENDER_TRIA_RIGHT,
};

const MOUSE_GLYPHS: Record<MouseToken, GlyphData> = {
  click: BLENDER_MOUSE_LMB,
  'right-click': BLENDER_MOUSE_RMB,
  'wheel-click': BLENDER_MOUSE_MMB,
  mousewheel: BLENDER_MOUSE_MMB_SCROLL,
  drag: BLENDER_MOUSE_LMB_DRAG,
  mouseover: BLENDER_MOUSE_MOVE,
};

const MOUSE_LABELS: Record<MouseToken, string> = {
  click: 'Click',
  'right-click': 'Right click',
  mouseover: 'Mouse hover',
  drag: 'Drag',
  mousewheel: 'Mouse wheel scroll',
  'wheel-click': 'Mouse wheel click',
};

const UI_GLYPHS: Record<UIIconName, GlyphData> = {
  close: BLENDER_PANEL_CLOSE,
  // chevron-up/down reuse the TRIA_UP/DOWN triangles — Blender's icon
  // language treats the small triangle as both an arrow indicator AND a
  // chevron-style direction cue, so one shape covers both uses.
  chevronUp: BLENDER_TRIA_UP,
  chevronDown: BLENDER_TRIA_DOWN,
  hamburger: BLENDER_STATUSBAR,
};

const UI_LABELS: Record<UIIconName, string> = {
  close: 'Close',
  chevronUp: 'Chevron up',
  chevronDown: 'Chevron down',
  hamburger: 'Hints bar',
};

/** Standard glyph render sizes inside the chord pill. Blender icons are
 *  authored at 18 px native; we render close to that so the path
 *  coordinates pixel-align cleanly and detail (button highlights, key-cap
 *  outlines, modifier symbols inside the cap) reads at chord-pill size.
 *  Non-square triangles preserve aspect via the SVG default
 *  `preserveAspectRatio` — they appear centered inside their outer box. */
const SIZE_MOD_PX = 16;
const SIZE_ARROW_PX = 14;
const SIZE_MOUSE_PX = 16;

export function renderModifierGlyph(mod: ModifierKey): TemplateResult {
  const { glyph, label } = MODIFIER_GLYPHS[mod];
  return html`<svg
    class="hints-bar-mod-icon"
    viewBox=${glyph.viewBox}
    width=${SIZE_MOD_PX}
    height=${SIZE_MOD_PX}
    role="img"
    aria-label=${label}
  >
    ${glyph.body}
  </svg>`;
}

export function renderArrowGlyph(dir: ArrowDir): TemplateResult {
  const glyph = ARROW_GLYPHS[dir];
  return html`<svg
    class="hints-bar-key-icon hints-bar-key-icon--arrow"
    viewBox=${glyph.viewBox}
    width=${SIZE_ARROW_PX}
    height=${SIZE_ARROW_PX}
    role="img"
    aria-label=${`Arrow ${dir}`}
  >
    ${glyph.body}
  </svg>`;
}

export function renderMouseGlyph(token: MouseToken): TemplateResult {
  const glyph = MOUSE_GLYPHS[token];
  return html`<svg
    class="hints-bar-key-icon hints-bar-key-icon--mouse"
    viewBox=${glyph.viewBox}
    width=${SIZE_MOUSE_PX}
    height=${SIZE_MOUSE_PX}
    role="img"
    aria-label=${MOUSE_LABELS[token]}
  >
    ${glyph.body}
  </svg>`;
}

/** Renders a non-chord UI icon (close button, flip chevron, toggle-button
 *  icons). Size is configurable since the toggle buttons render at ~24-40 px
 *  while the chord-bar controls render at 12-14 px. */
export function renderUIIcon(name: UIIconName, sizePx: number): TemplateResult {
  const glyph = UI_GLYPHS[name];
  return html`<svg
    viewBox=${glyph.viewBox}
    width=${sizePx}
    height=${sizePx}
    role="img"
    aria-label=${UI_LABELS[name]}
  >
    ${glyph.body}
  </svg>`;
}
