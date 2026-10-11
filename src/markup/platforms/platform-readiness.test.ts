import { missingHookSelectors } from './platform-readiness';

describe('missingHookSelectors', () => {
  const selectors = {
    player: '#player',
    video: 'video',
    progressBar: '.bar',
    theaterModeIndicator: 'placeholder',
  };

  it.each([
    ['lists nothing when every applicable hook is present', ['#player', 'video', '.bar'], []],
    ['lists the hooks whose selectors match nothing', ['video'], ['player', 'progressBar']],
    ['lists every applicable hook on an empty page', [], ['player', 'video', 'progressBar']],
  ])('%s (never the not-applicable placeholder)', (_name, present, expected) => {
    const query = (selector: string) => (present.includes(selector) ? {} : null);
    expect(missingHookSelectors(selectors, query)).toEqual(expected);
  });
});
