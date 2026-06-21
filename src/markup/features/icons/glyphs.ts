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

// =============================================================================
// Marker-pair toggle-section icons — Blender icons (ui.blender.org), inline
// fill swapped to `currentColor` so the active-state CSS can tint them. Each
// carries its `// blender:<NAME>` source comment. Licensed CC BY-SA 4.0.
// =============================================================================
export type ToggleIconName =
  | 'allPreviews'
  | 'speedPreview'
  | 'loop'
  | 'gamma'
  | 'speedChart'
  | 'cropChart'
  | 'focus'
  | 'overrides'
  | 'crosshair'
  | 'cropPreview'
  | 'reframe'
  | 'undo'
  | 'redo'
  | 'save'
  | 'load'
  | 'copy'
  | 'restore'
  | 'captureFrame'
  | 'cropDim'
  | 'rotate';

// Source glyphs that the preview icons composite: an eye + the previewed subject.
const PREVIEW_EYE: GlyphData = {
  source: 'blender:HIDE_OFF',
  viewBox: '0 0 1500 1100',
  body: svg`<g fill="currentColor"><path d="m432.49961 433c-3.27784-.00094-5.036 2.7211-6.36328 4.16211-.17644.19146-.17644.48627 0 .67773 1.3275 1.44124 3.08593 4.15993 6.36328 4.16211 3.27801.002 5.03608-2.72118 6.36328-4.16211.17644-.19146.17644-.48627 0-.67773-1.32741-1.44115-3.08573-4.16117-6.36328-4.16211zm0 1a3.4999952 3.4999933 0 0 1 3.5 3.5 3.4999952 3.4999933 0 0 1 -3.5 3.5 3.4999952 3.4999933 0 0 1 -3.5-3.5 3.4999952 3.4999933 0 0 1 3.5-3.5zm0 2a1.4999952 1.4999944 0 0 0 -1.5 1.5 1.4999952 1.4999944 0 0 0 1.5 1.5 1.4999952 1.4999944 0 0 0 1.5-1.5 1.4999952 1.4999944 0 0 0 -1.5-1.5z" transform="matrix(100 0 0 100 -42499.961 -43200.0975)"/></g>`,
};
const PREVIEW_SUBJECT_SPEED: GlyphData = {
  source: 'blender:FF',
  viewBox: '0 0 1200 1200',
  body: svg`<g fill="currentColor"><g><g><path d="m59.001212 223.36927.0025 9.27929c.000194.72168 1.997816.73494 1.997728-.008l-.0011-9.27146c-.000086-.72529-1.999325-.73042-1.999128.00017z" fill-rule="evenodd" transform="matrix(100 0 0 100 -5000.0633 -22200)"/></g></g><path d="m100.19477 301.67832-.0433 597.26982c.10822 70.76884 75.48985 129.20896 145.75984 86.9914l569.1155-354.61429c25.23786-15.7256 24.56947-52.36597-.3647-67.4918l-568.56644-344.90957c-80.05817-50.57876-145.96102 7.76917-145.9009 82.75444z" fill-rule="evenodd" stroke-width="85.8955"/></g>`,
};
const PREVIEW_SUBJECT_LOOP: GlyphData = {
  source: 'blender:FILE_REFRESH',
  viewBox: '0 0 1500 1500',
  body: svg`<g fill="currentColor"><g enable-background="new" stroke="none" transform="matrix(0 -100.17897 100 0 -57795.1844 41972.0971)"><path d="m405.46978 579.95581c-.0786.005 1.01466.006 2.75112.002-2.39046 1.17179-3.76136 4.49271-2.99824 7.27846s3.11603 4.49155 5.7784 4.71875l-.00084-1c-2.59859-.27264-4.17102-1.63685-4.81356-3.98242s.50423-5.20147 2.81719-6.15552c.009.80023-.0108 2.01265.00093 2.69464-.008.60881 1.01884.5718.99185-.0157-.002-.49551.001-3.60295.007-4.5362-1.4729.00082-2.81924-.00048-4.52617-.008-.62523.0109-.61936.99943-.009 1.00441z" transform="matrix(-1 0 0 -1 822.986 1170.90388)"/><path d="m405.45285 579.95581c-.0786.005 1.05365-.002 2.79011-.006-2.39046 1.17179-3.8662 4.53149-2.99824 7.28627.8992 2.85391 3.08617 4.49155 5.74854 4.71875l-.00084-1c-2.49653-.35216-4.00508-1.56869-4.7837-3.98242-.74659-2.31444.47303-5.20147 2.78599-6.15552.009.80023-.0108 2.01265.00093 2.69464-.008.60881 1.01884.5718.99185-.0157-.002-.49551.001-3.60295.007-4.5362-1.4729.00082-2.82703-.00048-4.53396-.008-.62523.0109-.61936.99943-.009 1.00441z"/></g></g>`,
};
const PREVIEW_SUBJECT_GAMMA: GlyphData = {
  source: 'blender:LIGHT_SUN',
  viewBox: '0 0 1600 1600',
  body: svg`<g fill="currentColor"><path d="m285.49219 388.99219c-.2763.004-.49651.23152-.49219.50781v2.6543c-.76567.19832-1.43883.61396-1.95508 1.18359l-2.1914-2.19141c-.0944-.0966-.22433-.15264-.35938-.15234-.4485.00024-.66889.54638-.34766.85938l2.32032 2.32031c-.28747.54952-.4655 1.16535-.4668 1.82617h-2.5c-.66693 0-.66693 1 0 1h2.64062c.19916.76891.61811 1.44388 1.19141 1.96094l-2.18555 2.18554c-.4717.4717.23534 1.17874.70704.70704l2.3164-2.31641c.54947.28561 1.16223.46289 1.82227.46289.003 0 .005.00001.008 0v2.5c0 .66693 1 .66693 1 0v-2.64648c.76569-.20169 1.4388-.6203 1.95312-1.19336l2.19336 2.19336c.47143.50593 1.2141-.23683.70704-.70704l-2.32422-2.32421c.28283-.54738.45703-1.15786.45703-1.81446 0-.003 0-.005 0-.008h2.51348c.66693 0 .66693-1 0-1h-2.66016c-.20083-.76245-.61615-1.43374-1.18554-1.94727l2.19922-2.19921c.32695-.31816.0927-.87325-.36329-.85938-.12999.004-.25338.0589-.34375.15234l-2.33007 2.33008c-.54727-.28427-1.15931-.46141-1.81641-.4627v-2.51367c.004-.28226-.22555-.51222-.50781-.50781zm.5 4.02148c1.65884 0 2.99414 1.3353 2.99414 2.99414 0 1.65885-1.3353 2.99219-2.99414 2.99219-1.65885 0-2.99219-1.33334-2.99219-2.99219 0-1.65884 1.33334-2.99414 2.99219-2.99414z" transform="matrix(100.000371795 0 0 100.000371795 -27800.1062664 -38799.76346438)"/></g>`,
};

// Compose a preview icon: the subject as the base, with the eye as a top-right
// badge. `strokeScale` thickens the subject's thin lines (fraction of its
// viewBox; 0 to skip); `rotate` spins it about its center (degrees).
function previewIcon(subject: GlyphData, strokeScale = 0.05, rotate = 0): GlyphData {
  const [minX, minY, vbW, vbH] = subject.viewBox.split(' ').map(Number);
  const strokeWidth = (vbW || 1600) * strokeScale;
  let subjectBody =
    strokeScale > 0
      ? svg`<g stroke="currentColor" stroke-width=${strokeWidth} stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${subject.body}</g>`
      : subject.body;
  if (rotate) {
    const transform = `rotate(${rotate} ${minX + vbW / 2} ${minY + vbH / 2})`;
    subjectBody = svg`<g transform=${transform}>${subjectBody}</g>`;
  }
  return {
    source: `composite:eye+${subject.source}`,
    viewBox: '0 0 16 16',
    // The disc (button background color) punches the eye's space out of the
    // subject so the badge reads cleanly instead of overlapping its lines.
    body: svg`<svg x="0" y="2" width="14" height="14" viewBox=${subject.viewBox}>${subjectBody}</svg><circle cx="11.6" cy="3" r="4.7" fill="var(--dark-grey)" /><svg x="6.9" y="0" width="9" height="9" viewBox="0 0 1500 900" preserveAspectRatio="xMidYMin meet">${PREVIEW_EYE.body}</svg>`,
  };
}

const TOGGLE_GLYPHS: Record<ToggleIconName, GlyphData> = {
  // The "all previews" master keeps the plain eye; the rest add their subject.
  allPreviews: PREVIEW_EYE,
  speedPreview: previewIcon(PREVIEW_SUBJECT_SPEED),
  loop: previewIcon(PREVIEW_SUBJECT_LOOP, 0.11, 90),
  gamma: previewIcon(PREVIEW_SUBJECT_GAMMA, 0),
  // blender:FCURVE — animation curve, used for the speed chart toggle.
  speedChart: {
    source: 'blender:FCURVE',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><g enable-background="new" transform="matrix(100 0 0 100 -6800 -47200)"><path d="m74 477c-.710648 0-1.272904.36437-1.621094.82227-.348189.45789-.546604.99437-.748047 1.49023-.201442.49586-.404614.94894-.65039 1.24023s-.488802.44727-.980469.44727h-1v1h1c.758333 0 1.359057-.34402 1.746094-.80273.387036-.45871.605739-1.00563.810547-1.50977.204807-.50414.397017-.96766.61914-1.25977.222123-.2921.409867-.42773.824219-.42773.376652 0 .584084.165.837891.55664.253806.39164.470672.98903.689453 1.61524.21878.6262.438752 1.28115.794922 1.82812s.933457 1.00595 1.68164 1c.673157-.005 1.209041-.26371 1.570313-.62109.361272-.35739.571027-.77752.771484-1.14649.200458-.36897.389328-.68586.623047-.89258.233719-.20671.505651-.33984 1.03125-.33984h1v-1h-1c-.724401 0-1.296219.23882-1.695312.5918-.399094.35298-.632099.78332-.837891 1.16211-.205793.37878-.386663.70727-.595703.91406-.209041.20679-.423157.32843-.875.33203-.376817.003-.58078-.15803-.833985-.54688-.253205-.38884-.470733-.98529-.689453-1.61132-.218719-.62603-.439353-1.28142-.794922-1.83008-.355568-.54866-.929386-1.01172-1.677734-1.01172z" opacity=".99"/><path d="m82.5 473-13 .004a.50005.50005 0 0 0 -.5.5v6.496h1v-5.99609l12-.00391v4h1v-4.5a.50005.50005 0 0 0 -.5-.5zm-.5 8v5h-12v-3h-1v3.5a.50005.50005 0 0 0 .5.5h13a.50005.50005 0 0 0 .5-.5v-5.5z" fill-rule="evenodd" opacity=".6"/></g></g>`,
  },
  // blender:NORMALIZE_FCURVES — bounded curve, used for the crop chart toggle.
  cropChart: {
    source: 'blender:NORMALIZE_FCURVES',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><g enable-background="new" transform="matrix(100 0 0 100 -44600.391 -19900.391)"><path d="m447.5 200a.50005.50005 0 0 0 -.5.5v4a.50005.50005 0 1 0 1 0v-3.5h3.5a.50005.50005 0 1 0 0-1zm9.00781 0a.50005.50005 0 1 0 0 1h3.5v3.5a.50005.50005 0 1 0 1 0v-4a.50005.50005 0 0 0 -.5-.5zm-9.01562 9a.50005.50005 0 0 0 -.49219.50781v4a.50005.50005 0 0 0 .5.5h4a.50005.50005 0 1 0 0-1h-3.5v-3.5a.50005.50005 0 0 0 -.50781-.50781zm13.00781 0a.50005.50005 0 0 0 -.49219.50781v3.5h-3.5a.50005.50005 0 1 0 0 1h4a.50005.50005 0 0 0 .5-.5v-4a.50005.50005 0 0 0 -.50781-.50781z" opacity=".6"/><path d="m449.5 203a.50005.50005 0 1 0 0 1h1c.39167 0 .74862.27445 1.13672.86719.3881.59273.74407 1.4462 1.08594 2.3164.34186.8702.67067 1.75605 1.06836 2.4668.19884.35538.41332.66981.68554.91797s.62761.43164 1.02344.43164c.625 0 1.13349-.27613 1.44727-.64648.31377-.37036.47247-.79704.61523-1.17774s.2723-.71757.41406-.91016c.14177-.19258.2288-.26562.52344-.26562a.50005.50005 0 1 0 0-1c-.58036 0-1.05583.30196-1.32812.67188-.2723.36991-.40839.78304-.54688 1.15234s-.27667.69262-.43945.88476c-.16279.19215-.31055.29102-.68555.29102-.10417 0-.20191-.0353-.34961-.16992-.1477-.13465-.31994-.3671-.48828-.66797-.33669-.60175-.66413-1.4659-1.00977-2.3457-.34563-.8798-.70841-1.77633-1.17968-2.4961-.47128-.71976-1.11433-1.32031-1.97266-1.32031z"/></g></g>`,
  },
  // blender:ZOOM_SELECTED — magnifier on selection, used for the focus toggle.
  focus: {
    source: 'blender:ZOOM_SELECTED',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor" transform="matrix(-1,0,0,1,1599.9998,0)"><g enable-background="new" transform="matrix(100,0,0,100,-15199.649,-57700.351)"><path d="m 161.5,578 c -3.02272,0 -5.5,2.47726 -5.5,5.5 0,1.3328 0.48165,2.55856 1.2793,3.51367 l -4.13282,4.13281 a 0.50005,0.50005 0 1 0 0.70704,0.70704 l 4.13281,-4.13282 C 158.94144,588.51835 160.1672,589 161.5,589 c 3.02273,0 5.5,-2.47727 5.5,-5.5 0,-3.02274 -2.47727,-5.5 -5.5,-5.5 z m 0,1 c 2.47727,0 4.5,2.02272 4.5,4.5 0,2.47727 -2.02273,4.5 -4.5,4.5 -2.47726,0 -4.5,-2.02273 -4.5,-4.5 0,-2.47728 2.02274,-4.5 4.5,-4.5 z"/><path d="m 159.5,583 c -0.27613,3e-5 -0.49997,0.22387 -0.5,0.5 v 2.2168 c -2.1e-4,0.14132 0.0594,0.27613 0.16406,0.37109 0.61652,0.55704 1.43526,0.91211 2.33594,0.91211 0.90068,0 1.71942,-0.35507 2.33594,-0.91211 0.10467,-0.095 0.16427,-0.22977 0.16406,-0.37109 V 583.5 c -3e-5,-0.27613 -0.22387,-0.49997 -0.5,-0.5 z m 0.97266,6.91992 c -0.2654,0.0146 -0.47303,0.2342 -0.47266,0.5 V 591.5 c 3e-5,0.27613 0.22387,0.49997 0.5,0.5 h 2 c 0.27613,-3e-5 0.49997,-0.22387 0.5,-0.5 v -1.08008 c -4.1e-4,-0.30465 -0.27082,-0.53814 -0.57227,-0.49414 -0.31225,0.0453 -0.61944,0.0742 -0.92773,0.0742 -0.30829,0 -0.61548,-0.0289 -0.92773,-0.0742 -0.0329,-0.005 -0.0663,-0.007 -0.0996,-0.006 z"/></g></g>`,
  },
  // blender:PREFERENCES — gear, used for the per-pair overrides toggle.
  overrides: {
    source: 'blender:PREFERENCES',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><path d="m285 536-.15625 1.90625c-.6231.14227-1.07677.25145-1.59375.59375l-1.75-1.5-1.5 1.5 1.5 1.75c-.34229.51699-.45148.97065-.59375 1.59375l-1.90625.15625v1 1l1.90625.15625c.14227.6231.25145 1.07677.59375 1.59375l-1.5 1.75 1.5 1.5 1.75-1.5c.51699.34229.97065.45148 1.59375.59375l.15625 1.90625h1 1l.15625-1.90625c.6231-.14227 1.07677-.25145 1.59375-.59375l1.75 1.5 1.5-1.5-1.5-1.75c.34229-.51699.45148-.97065.59375-1.59375l1.90625-.15625v-1-1l-1.90625-.15625c-.14227-.6231-.25145-1.07677-.59375-1.59375l1.5-1.75-1.5-1.5-1.75 1.5c-.51699-.34229-.97065-.45148-1.59375-.59375l-.15625-1.90625h-1zm1 5c1.11641 0 2 .88359 2 2s-.88359 2-2 2-2-.88359-2-2 .88359-2 2-2z" transform="matrix(100 0 0 100 -27800 -53500)"/></g>`,
  },
  // blender:SELECT_SET (dashed box) + a custom crosshair whose arms span the
  // full box edge-to-edge — matches what the crop crosshair feature draws.
  crosshair: {
    source: 'blender:SELECT_SET+custom-cross',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><path d="m447.00391 325.99805v2h1v-1h1v-1zm4 0v1h2v-1zm4 0v1h2v-1zm4 0v1h1v1h1v-2zm-12 4v2h1v-2zm13 0v2h1v-2zm-13 4v2h1v-2zm13 0v2h1v-2zm-13 4v2h2v-1h-1v-1zm13 0v1h-1v1h2v-2zm-9 1v1h2v-1zm4 0v1h2v-1z" transform="matrix(100 0 0 100 -44600.39099999999 -32499.805)"/><path d="M110 750 H1490 V850 H110 Z M750 110 H850 V1490 H750 Z"/></g>`,
  },
  // blender:IMAGE_PLANE — framed image, used for the crop preview toggle.
  cropPreview: {
    source: 'blender:IMAGE_PLANE',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><path d="m662.5-359a.50005.50005 0 0 1 .5.5v9a.50005.50005 0 0 1 -.5.5h-9a.50005.50005 0 0 1 -.5-.5v-9a.50005.50005 0 0 1 .5-.5zm-.5 1h-8v8h2.00029c-.0001-.07934.01823-.16072.06026-.23828l3-5.5c.08807-.16242.25857-.26272.44336-.26172.1882.00164.35956.10882.44336.27734l2.05273 4.10547zm-6 1c.54636 0 1 .45364 1 1s-.45364 1-1 1-1-.45364-1-1 .45364-1 1-1z" transform="matrix(-100 0 0 100 66600 36200)"/><path d="m27.5 347a.50005.50005 0 0 0 -.5.5v3.5h1v-3h3v-1zm9.5 0v1h3v3h1v-3.5a.50005.50005 0 0 0 -.5-.5zm-10 10v3.5a.50005.50005 0 0 0 .5.5h3.5v-1h-3v-3zm13 0v3h-3v1h3.5a.50005.50005 0 0 0 .5-.5v-3.5z" opacity=".6" transform="matrix(100 0 0 100 -2600 -34600)"/></g>`,
  },
  // blender:FULLSCREEN_EXIT — two diagonal arrows pulling inward with faint (0.5 opacity) corner
  // brackets: the "fit into the frame" metaphor. Distinct from the framed-picture cropPreview
  // (IMAGE_PLANE) icon. Used for the reframe toggle.
  reframe: {
    source: 'blender:FULLSCREEN_EXIT',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><g enable-background="new" transform="matrix(100 0 0 100 71399.517 9100.483)"><path d="m-699.50391-90.009766a.50005.50005 0 0 0 -.34375.150391l-4.14648 4.136719v-2.783203a.50005.50005 0 1 0 -1 0v4a.50005.50005 0 0 0 .5.5h4a.50005.50005 0 1 0 0-1h-2.80274l4.1543-4.144532a.50005.50005 0 0 0 -.36133-.859375zm-11.98828 8.001954a.50005.50005 0 1 0 0 1h2.78321l-4.13868 4.148437a.50005.50005 0 1 0 .70899.705078l4.14648-4.15625v2.802735a.50005.50005 0 1 0 1 0v-4a.50005.50005 0 0 0 -.5-.5z"/><path d="m-710.49414-88.007812a.50005.50005 0 0 0 -.5.5v4.501953h1v-4.001953h4v-1zm8.50195 5.001953v4h-4.00195v1h4.50195a.50005.50005 0 0 0 .5-.5v-4.5z" opacity=".5"/></g></g>`,
  },
  // blender:LOOP_BACK — curved left arrow, used for the undo pair-edit action.
  undo: {
    source: 'blender:LOOP_BACK',
    viewBox: '0 0 1400 1500',
    body: svg`<g fill="currentColor"><path d="m283.51233 53.990463c-.12976.0036-.25303.05754-.34375.15039l-3.00563 3.005631c-.19518.195265-.19518.511767 0 .707032l3.00563 2.983534c.47126.490506 1.19754-.235768.70704-.707032l-2.15212-2.130018h5.28213c2.21506 0 4 1.784939 4 4s-1.78494 4-4 4h-1.5c-.67616-.0096-.67616 1.009563 0 1h1.5c2.7555 0 5-2.244499 5-5s-2.2445-5-5-5h-5.28213l2.15212-2.152115c.32527-.318007.0914-.869901-.36329-.857422z" transform="matrix(100 0 0 100 -27901.11 -5299.516)"/></g>`,
  },
  // blender:LOOP_FORWARDS — curved right arrow, used for the redo pair-edit action.
  redo: {
    source: 'blender:LOOP_FORWARDS',
    viewBox: '0 0 1400 1500',
    body: svg`<g fill="currentColor"><path d="m309.47936 53.98851c-.44941.000088-.6706.546838-.34766.859375l2.13002 2.152115h-5.26172c-2.7555 0-5 2.244499-5 5s2.2445 5 5 5h1.5c.67616.0096.67616-1.009563 0-1h-1.5c-2.21506 0-4-1.784939-4-4s1.78494-4 4-4h5.26172l-2.13002 2.130018c-.4905.471264.23578 1.197538.70704.707032l2.98353-2.983534c.19518-.195265.19518-.511767 0-.707032l-2.98353-3.005631c-.0942-.09737-.2239-.152345-.35938-.152343z" transform="matrix(100 0 0 100 -29998.433 -5299.429)"/></g>`,
  },
  // blender:FILE_TICK — document with a save/floppy shape, used for save-markers.
  save: {
    source: 'blender:FILE_TICK',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><path d="m30.26575 431.92903c-.27613.00003-.49997.22387-.5.5v13c.00003.27613.22387.49997.5.5h13c.27613-.00003.49997-.22387.5-.5v-9.99219c-.00003-.1326-.0527-.25975-.14648-.35351l-3-3.00782c-.0938-.0938-.22092-.14646-.35352-.14648zm.5 1h2v4.5c.00003.27613.22387.49997.5.5h6c.27613-.00003.49997-.22387.5-.5v-4.5h.29297l2.70703 2.71484v9.28516h-12zm6 0h2v4h-2z" fill-rule="evenodd" transform="matrix(100 0 0 100 -2876.575 -43092.903)"/></g>`,
  },
  // blender:FILE_FOLDER — folder, used for the load-markers action.
  load: {
    source: 'blender:FILE_FOLDER',
    viewBox: '0 0 1600 1500',
    body: svg`<g fill="currentColor"><g enable-background="new" transform="matrix(100 0 0 100 -36200 -9400)"><path d="m363.5 95c-.27613.00003-.49997.22387-.5.5v3.5h14v-1.5c-.00003-.27613-.22387-.49997-.5-.5h-8.5v-1.5c-.00003-.27613-.22387-.49997-.5-.5z"/><path d="m363.5 100c-.27613.00003-.49997.22387-.5.5v7c.00003.27613.22387.49997.5.5h13c.27613-.00003.49997-.22387.5-.5v-7c-.00003-.27613-.22387-.49997-.5-.5z"/></g></g>`,
  },
  // blender:RECOVER_LAST — recover/restore arrow, used for the restore action.
  restore: {
    source: 'blender:RECOVER_LAST',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><path d="m447.49414 577.99023a.50005.50005 0 0 0 -.49219.50782v4a.50005.50005 0 0 0 .5.5h4a.50005.50005 0 1 0 0-1h-2.6875c1.48423-2.56389 4.60739-3.65907 7.36719-2.58008 2.762 1.07985 4.31643 4.00744 3.66406 6.90039s-3.31139 4.87021-6.26953 4.66016c-2.95814-.21006-5.31375-2.5439-5.55078-5.5a.50005.50005 0 1 0 -.99609.0801c.27595 3.44157 3.03067 6.17147 6.47461 6.41602 3.44393.24455 6.55885-2.06751 7.31836-5.43555.7595-3.36803-1.05982-6.79554-4.27539-8.05273-.8039-.3143-1.63664-.46878-2.45899-.47852-2.43307-.0288-4.77966 1.22272-6.08594 3.40821v-2.91797a.50005.50005 0 0 0 -.50781-.50782zm8.98828 3.00391a.50005.50005 0 0 0 -.38281.20508l-3 4a.50005.50005 0 0 0 -.0156.57812l2 3a.50005.50005 0 1 0 .83204-.55468l-1.80274-2.70508 2.78711-3.7168a.50005.50005 0 0 0 .10352-.3125.50005.50005 0 0 0 -.52149-.49414z" opacity=".99" transform="matrix(100 0 0 100 -44599.795 -57699.128)"/></g>`,
  },
  // blender:COPYDOWN — clipboard with an arrow, used for the copy-markers action.
  copy: {
    source: 'blender:COPYDOWN',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><g enable-background="new" transform="matrix(100 0 0 100 16598.796 -13600.362)"><path d="m-156.48438 137c-.27612.00003-.49996.22387-.5.5v.5h-1.5c-.32865.005-.51562.25232-.51562.5v.5h2.51562 1 2.48438v-.5c0-.25267-.14909-.49526-.48438-.5h-1.5v-.5c-.00003-.27613-.22387-.49997-.5-.5zm3.48438 2 .0156.5v.5h-6v-.5l-.0156-.5h-1.48438c-.27612.00003-.49996.22387-.5.5v3.5h2.3086a1.50015 1.50015 0 0 1 .16211-.0137 1.50015 1.50015 0 0 1 1.52929 1.69726v4.31644h5.5c.27613-.00003.49997-.22387.5-.5v-9c-.00003-.27613-.22387-.49997-.5-.5z" opacity=".5"/><path d="m-158.49414 143.99609a.50005.50005 0 0 0 -.0508.004h-3.93946a.50005.50005 0 1 0 0 1h2.79297l-5.14648 5.14648a.50005.50005 0 1 0 .70703.70704l5.14648-5.14649v2.79288a.50005.50005 0 1 0 1 0v-3.94336a.50005.50005 0 0 0 -.50976-.56055z"/></g></g>`,
  },
  // blender:RESTRICT_RENDER_OFF — camera, used for the capture-frame action.
  captureFrame: {
    source: 'blender:RESTRICT_RENDER_OFF',
    viewBox: '0 0 1500 1300',
    body: svg`<g fill="currentColor"><path d="m515.5 432c-.1326.00002-.25976.0527-.35352.14647l-1.85351 1.85353h-2.79297c-.27613.00003-.49997.22387-.5.5v8c.00003.27613.22387.49997.5.5h6.45312.004c.0131-.00082.0261-.002.0391-.004.004.00005.008.00005.0117 0 .0143.002.0286.003.043.004h.006 5.44336c.27613-.00003.49997-.22387.5-.5v-8c-.00003-.27613-.22387-.49997-.5-.5h-1.79297l-1.85351-1.85353c-.0938-.09379-.2211-.14652-.3538-.14647zm1.49781 1.99804c2.21589-.00032 4.00185 1.7855 4.00195 4.00196-.0009 2.19736-1.75841 3.97457-3.95508 4-.0131.00082-.0261.002-.0391.004-.0149-.002-.0299-.003-.0449-.004-.001 0-.003 0-.004 0-2.19824-.0228-3.95803-1.80057-3.95898-4 .00009-2.21578 1.78479-4.00131 4-4.00196zm.00024 1.00196c-1.65063 0-2.99805 1.34922-2.99805 3 0 1.65079 1.34742 3 2.99805 3s3-1.34921 3-3c0-1.65078-1.34937-3-3-3zm0 1c1.11009 0 2 .88955 2 2s-.88991 2-2 2-1.99805-.88955-1.99805-2 .88796-2 1.99805-2z" transform="matrix(100 0 0 100 -50900.014 -43100)"/></g>`,
  },
  // blender:XRAY — see-through square, used for the cycle-crop-dim-opacity action.
  cropDim: {
    source: 'blender:XRAY',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><g enable-background="new" transform="matrix(100 0 0 100 -15200 -11500)"><path d="m153.5 119a.50005.50005 0 0 0 -.5.5v10a.50005.50005 0 0 0 .5.5h10a.50005.50005 0 0 0 .5-.5v-10a.50005.50005 0 0 0 -.5-.5zm.5 1h9v9h-9z"/><path d="m157 121v2h1v-2zm0 3v1.5c.00003.27613.22387.49997.5.5h1.5v-1h-1v-1zm3 1v1h2v-1z" opacity=".75"/><path d="m157.5 116a.50005.50005 0 0 0 -.5.5v1.5h1v-1h8v8h-1v1h1.5a.50005.50005 0 0 0 .5-.5v-9a.50005.50005 0 0 0 -.5-.5z" opacity=".75"/></g></g>`,
  },
  // blender:RENDER_SWAP_DIMENSIONS — a landscape frame with a diagonal swap
  // arrow: Blender's literal swap-render-dimensions (landscape <-> portrait)
  // icon, exactly the orientation-change metaphor. Two-tone (0.6/0.8 opacity)
  // like the rest of the set. Used for cycle-preview-rotation; the signed angle
  // on the badge gives the exact direction.
  rotate: {
    source: 'blender:RENDER_SWAP_DIMENSIONS',
    viewBox: '0 0 1600 1600',
    body: svg`<g fill="currentColor"><g transform="matrix(100,0,0,100,-8899.3611,-28199.235)"><path style="opacity:0.6" d="m 90.494295,287.99235 c -0.276958,0 -0.5,0.22386 -0.5,0.5 v 1.5 h 1 v -1 h 4.999316 v 1 h 1 v -1.5 c 0,-0.29409 -0.224165,-0.5 -0.5,-0.5 z" /><path style="opacity:0.8" d="m 99.99361,291.49235 c 0,-0.2761 -0.22386,-0.5 -0.5,-0.5 h -9.010649 c -0.2761,0 -0.5,0.2239 -0.5,0.5 v 5 c 0,0.2761 0.2239,0.5 0.5,0.5 h 9.010649 c 0.27614,0 0.5,-0.2239 0.5,-0.5 z m -0.999999,0.5 v 4 h -8.01065 v -4 z" /></g><g transform="matrix(0.707107,0.707107,0.707107,-0.707107,411.0892,1075.003)"><path d="m -330.62438,1030.6539 2.33231,-196.67699 c -0.60432,-28.10904 22.22687,-50.03822 51.11703,-48.87234 l 203.566647,0.57962 c 65.6786821,-3.95385 68.0988721,100.76836 2.53823,102.12986 l -79.784797,2.01621 129.67157,129.67164 c 53.72708,53.2384 131.57747,65.3432 190.5748,6.3459 59.4893,-58.97429 82.37316,-81.15539 141.81761,-140.17694 l -79.79122,-0.51514 c -68.01192,1.08971 -67.60212,-101.61929 0.39906,-99.98786 l 200.49516,0.99438 c 27.60842,0.11582 49.89961,22.58506 49.79587,50.19355 l -1.81617,198.27021 c 0.49406,64.795 -101.02299,67.2233 -99.98934,-0.3977 l 0.51515,-78.38529 -162.11924,162.11919 c -96.72862,79.1538 -228.2248516,53.8982 -311.457191,-28.6145 l -130.771169,-130.77119 -3.00972,75.77489 c -2.8156,65.1928 -107.50174,56.6381 -104.08459,-3.6975 z" /></g></g>`,
  },
};

const TOGGLE_LABELS: Record<ToggleIconName, string> = {
  allPreviews: 'All previews',
  speedPreview: 'Speed preview',
  loop: 'Loop pair',
  gamma: 'Gamma preview',
  speedChart: 'Speed chart',
  cropChart: 'Crop chart',
  focus: 'Focus selected pair',
  overrides: 'Overrides',
  crosshair: 'Crop crosshair',
  cropPreview: 'Crop preview',
  reframe: 'Reframe',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save markers',
  load: 'Load markers',
  copy: 'Copy markers',
  restore: 'Restore markers',
  captureFrame: 'Capture frame',
  cropDim: 'Cycle crop dim opacity',
  rotate: 'Rotate video',
};

export function renderToggleIcon(name: ToggleIconName, sizePx: number): TemplateResult {
  const glyph = TOGGLE_GLYPHS[name];
  return html`<svg
    viewBox=${glyph.viewBox}
    width=${sizePx}
    height=${sizePx}
    role="img"
    aria-label=${TOGGLE_LABELS[name]}
  >
    ${glyph.body}
  </svg>`;
}
