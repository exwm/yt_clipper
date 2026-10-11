// Platform selector tables use this for hooks that do not apply to them (e.g. a theater-mode
// indicator outside YouTube). It never matches, so it must not count as missing.
const NOT_APPLICABLE_SELECTOR = 'placeholder';

/** Names of the platform hooks whose selectors match nothing yet. Some platforms render the video
 *  before the rest of the page (YouTube's watch-page shell comes later), so a hook can be missing
 *  for a moment after the video is ready. */
export function missingHookSelectors(
  selectors: Record<string, string>,
  query: (selector: string) => unknown
): string[] {
  return Object.keys(selectors).filter(
    (name) => selectors[name] !== NOT_APPLICABLE_SELECTOR && query(selectors[name]) == null
  );
}
